/**
 * Opus-MT translation via Transformers.js (MarianMT) — the cross-platform,
 * fully-local, offline-capable translation path (WebGPU, WASM fallback).
 *
 * IMPORTANT: Opus-MT *-zh models output **Simplified** Chinese. Our target is
 * zh-Hant (Traditional) per Hard Constraints, so callers should treat this
 * output as Simplified (isSimplified=true). Traditional conversion (e.g.
 * OpenCC) is a follow-up; the Chrome Translator API path already yields zh-Hant.
 *
 * NOTE: model ids below are the assumed Xenova ONNX repos and are not yet
 * verified end-to-end. ja→zh in particular may be unavailable directly; if so,
 * override via setOpusModel(), or pivot ja→en→zh (future). On load failure the
 * UI surfaces it; nothing else breaks.
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

const MODELS: Record<OcrLanguage, string> = {
  en: 'Xenova/opus-mt-en-zh',
  ja: 'Xenova/opus-mt-ja-zh',
}

export function setOpusModel(lang: OcrLanguage, id: string) {
  MODELS[lang] = id
  cache.delete(lang)
}

export function getOpusModelId(lang: OcrLanguage): string {
  return MODELS[lang]
}

interface Entry {
  pipe: Promise<TranslationPipeline>
  backend: ComputeBackend
}
const cache = new Map<OcrLanguage, Entry>()

export async function loadOpus(
  lang: OcrLanguage,
  backend: ComputeBackend,
  onProgress?: TranslateProgressCallback,
): Promise<TranslationPipeline> {
  const existing = cache.get(lang)
  if (existing && existing.backend === backend) return existing.pipe

  const files = new Map<string, { loaded: number; total: number }>()
  const pipe = createTranslator('translation', MODELS[lang], {
    device: backend === 'webgpu' ? 'webgpu' : 'wasm',
    dtype: backend === 'webgpu' ? 'fp32' : 'q8',
    progress_callback: onProgress
      ? (p: unknown) => {
          const e = p as { status?: string; file?: string; loaded?: number; total?: number }
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
  cache.set(lang, { pipe, backend })
  return pipe
}

export async function translateOpus(
  sentences: string[],
  lang: OcrLanguage,
  backend: ComputeBackend,
  onProgress?: TranslateProgressCallback,
): Promise<string[]> {
  const pipe = await loadOpus(lang, backend, onProgress)
  const out: string[] = []
  // Translate sequentially so progress is meaningful and memory stays bounded.
  for (let i = 0; i < sentences.length; i++) {
    onProgress?.({
      phase: 'translating',
      engine: 'opus-mt',
      ratio: i / sentences.length,
      message: `翻譯 ${i + 1} / ${sentences.length}`,
    })
    const res = (await pipe(sentences[i])) as
      | Array<{ translation_text: string }>
      | { translation_text: string }
    const text = Array.isArray(res) ? res[0]?.translation_text : res.translation_text
    out.push((text ?? '').trim())
  }
  return out
}

export function disposeOpus() {
  cache.clear()
}
