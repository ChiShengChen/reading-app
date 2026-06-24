/**
 * Opus-MT translation via Transformers.js (MarianMT) — the cross-platform,
 * fully-local, offline-capable translation path (WebGPU, WASM fallback).
 *
 * Opus-MT *-zh models output **Simplified** Chinese; callers post-convert to
 * zh-Hant via OpenCC (see translate/index.ts).
 *
 * There is no verified direct ja→zh ONNX repo, so Japanese is translated by a
 * PIVOT chain ja→en→zh using two verified repos:
 *   Xenova/opus-mt-ja-en  →  Xenova/opus-mt-en-zh
 * English is the single hop Xenova/opus-mt-en-zh (confirmed working on-device).
 * Override a chain via setOpusChain(); on load failure the UI surfaces it.
 */
import { pipeline, type TranslationPipeline } from '@huggingface/transformers'
import type { ComputeBackend } from '../capabilities'
import type { OcrLanguage, TranslateProgressCallback } from './types'

// Narrow the (very wide) pipeline() overload union to the one signature we use.
type TranslationFactory = (
  task: 'translation',
  model: string,
  options: Record<string, unknown>,
) => Promise<TranslationPipeline>
const createTranslator = pipeline as unknown as TranslationFactory

// Ordered model chains; each hop feeds the next. Final hop outputs Chinese.
const CHAINS: Record<OcrLanguage, string[]> = {
  en: ['Xenova/opus-mt-en-zh'],
  ja: ['Xenova/opus-mt-ja-en', 'Xenova/opus-mt-en-zh'],
}

export function setOpusChain(lang: OcrLanguage, modelIds: string[]) {
  CHAINS[lang] = modelIds
  cache.clear()
}

export function getOpusChain(lang: OcrLanguage): string[] {
  return CHAINS[lang]
}

interface Entry {
  pipe: Promise<TranslationPipeline>
  backend: ComputeBackend
}
const cache = new Map<string, Entry>() // keyed by modelId

export async function loadOpusModel(
  modelId: string,
  _backend: ComputeBackend,
  onProgress?: TranslateProgressCallback,
): Promise<TranslationPipeline> {
  // MT runs on WASM even when OCR uses WebGPU. MarianMT models are tiny (q8,
  // ~30–50MB) and translate sentence-by-sentence, so WebGPU buys almost
  // nothing — but allocating GPU buffers for the encoder/decoder + KV cache on
  // a phone, stacked behind the OCR pipeline, is what OOM-crashes the tab
  // ("Aw, Snap"). Keep MT off the GPU. `backend` is kept for the cache key /
  // signature but no longer selects the device.
  const device: ComputeBackend = 'wasm'
  const existing = cache.get(modelId)
  if (existing && existing.backend === device) return existing.pipe

  const files = new Map<string, { loaded: number; total: number }>()
  const pipe = createTranslator('translation', modelId, {
    device: 'wasm',
    // Always q8: fp32 on a phone (on top of the OCR engines) blows memory and
    // crashes the tab. q8 is ~1/4 the size and plenty for MT quality.
    dtype: 'q8',
    progress_callback: onProgress
      ? (p: unknown) => {
          const e = p as { file?: string; loaded?: number; total?: number }
          if (e.file && typeof e.total === 'number' && e.total > 0) {
            files.set(e.file, { loaded: e.loaded ?? 0, total: e.total })
          }
          let loaded = 0
          let total = 0
          for (const f of files.values()) {
            loaded += f.loaded
            total += f.total
          }
          onProgress({
            phase: 'loading',
            engine: 'opus-mt',
            ratio: total > 0 ? Math.min(1, loaded / total) : undefined,
            message: '下載翻譯模型權重…',
          })
        }
      : undefined,
  })
  cache.set(modelId, { pipe, backend: device })
  return pipe
}

// MarianMT attention is O(n²) in token count, so one very long input line
// (e.g. an OCR'd paragraph that never got sentence-split) can spike memory and
// crash the tab. Cap each single inference at ~MAX_CHARS by splitting overly
// long inputs at clause boundaries, then rejoin the translated pieces.
const MAX_CHARS = 140

export function chunkLong(text: string): string[] {
  if (text.length <= MAX_CHARS) return [text]
  const chunks: string[] = []
  let rest = text.trim()
  while (rest.length > MAX_CHARS) {
    // Prefer to break after a clause boundary within the window; else at the
    // last space; else hard-cut at the limit (CJK has no spaces).
    const window = rest.slice(0, MAX_CHARS)
    let cut = Math.max(
      window.lastIndexOf('、'),
      window.lastIndexOf('，'),
      window.lastIndexOf(','),
      window.lastIndexOf('；'),
      window.lastIndexOf(';'),
    )
    if (cut < MAX_CHARS * 0.5) cut = window.lastIndexOf(' ')
    if (cut < MAX_CHARS * 0.5) cut = MAX_CHARS - 1
    chunks.push(rest.slice(0, cut + 1).trim())
    rest = rest.slice(cut + 1).trim()
  }
  if (rest) chunks.push(rest)
  return chunks
}

async function translateOne(pipe: TranslationPipeline, text: string): Promise<string> {
  // Greedy decoding (num_beams=1). Opus-MT ships a generation_config with beam
  // search (num_beams 4–6); beams keep several hypotheses + KV caches resident
  // at once, multiplying memory by the beam count — enough to OOM-crash the tab
  // on WASM even for short sentences. Greedy cuts peak to ~1/beam_count.
  // max_new_tokens + no_repeat_ngram_size also cap runaway/degenerate output.
  const res = (await pipe(text, {
    num_beams: 1,
    do_sample: false,
    max_new_tokens: 200,
    no_repeat_ngram_size: 3,
  } as unknown as Parameters<TranslationPipeline>[1])) as
    | Array<{ translation_text: string }>
    | { translation_text: string }
  return ((Array.isArray(res) ? res[0]?.translation_text : res.translation_text) ?? '').trim()
}

async function runHop(
  pipe: TranslationPipeline,
  inputs: string[],
  joinSep: string,
): Promise<string[]> {
  const out: string[] = []
  for (const text of inputs) {
    const parts: string[] = []
    for (const chunk of chunkLong(text)) {
      if (chunk) parts.push(await translateOne(pipe, chunk))
    }
    out.push(parts.join(joinSep))
  }
  return out
}

export async function translateOpus(
  sentences: string[],
  lang: OcrLanguage,
  backend: ComputeBackend,
  onProgress?: TranslateProgressCallback,
): Promise<string[]> {
  const chain = CHAINS[lang]
  let current = sentences
  let prevModel: string | null = null
  for (let hop = 0; hop < chain.length; hop++) {
    // Pivot chains (ja→en→zh) run hops strictly in sequence, so free the
    // previous hop's model BEFORE loading the next — keeping both MarianMT
    // sessions resident doubles peak memory and OOM-crashes phones.
    if (prevModel && prevModel !== chain[hop]) await disposeModel(prevModel)
    const pipe = await loadOpusModel(chain[hop], backend, onProgress)
    prevModel = chain[hop]
    const label = chain.length > 1 ? `（第 ${hop + 1}/${chain.length} 段）` : ''
    // Chinese output has no inter-clause spaces; English (pivot) output does.
    const joinSep = chain[hop].endsWith('-zh') ? '' : ' '
    const next: string[] = []
    for (let i = 0; i < current.length; i++) {
      onProgress?.({
        phase: 'translating',
        engine: 'opus-mt',
        ratio: i / current.length,
        message: `翻譯 ${i + 1} / ${current.length}${label}`,
      })
      next.push(...(await runHop(pipe, [current[i]], joinSep)))
    }
    current = next
  }
  return current
}

/** Await a cached pipeline and actually release its ORT session / GPU buffers. */
async function disposeModel(modelId: string) {
  const entry = cache.get(modelId)
  if (!entry) return
  cache.delete(modelId)
  try {
    const pipe = (await entry.pipe) as unknown as { dispose?: () => unknown }
    await pipe.dispose?.()
  } catch {
    // Loading may have failed; nothing to release.
  }
}

export async function disposeOpus() {
  await Promise.allSettled([...cache.keys()].map((id) => disposeModel(id)))
}
