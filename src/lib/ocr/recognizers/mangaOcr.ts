/**
 * Japanese recognition — manga-ocr (VisionEncoderDecoder) via Transformers.js.
 *
 * Critical Rule #2: manga-ocr HALLUCINATES — it emits plausible text even for
 * blank input and can loop. We mitigate in three layers:
 *   1. Upstream: only already-detected, confidence-gated regions reach it.
 *   2. Generation: short max_new_tokens + no_repeat_ngram to curb loops.
 *   3. Output: heuristic rejection of empty / degenerate / repetitive strings.
 *
 * Weights are ~440MB (Critical Rule #5) and downloaded lazily on first JP use,
 * cached by Transformers.js in the browser Cache API (offline afterwards).
 *
 * The public manga-ocr ONNX repos were incomplete for Transformers.js (no
 * decoder_model_merged, and only a MeCab BertJapaneseTokenizer with no fast
 * tokenizer.json). We built a complete export — see scripts/convert-manga-ocr.py
 * + scripts/add-manga-ocr-tokenizer.py — hosted at the default below. Override
 * with your own via setMangaOcrModel() / 設定→進階.
 */
import { pipeline, RawImage, env, type ImageToTextPipeline } from '@huggingface/transformers'
import type { ComputeBackend } from '../../capabilities'
import type { RecognitionOutput, LoadProgressCallback } from './types'

// The full pipeline() overload set produces a union too complex for tsc when we
// pass options inline; narrow it to the one task signature we actually use.
type PipelineFactory = (
  task: 'image-to-text',
  model: string,
  options: Record<string, unknown>,
) => Promise<ImageToTextPipeline>
const createImageToText = pipeline as unknown as PipelineFactory

// We always fetch from the hub; cache lives in the browser Cache API.
env.allowLocalModels = false

// Complete export (encoder + decoder_model_merged + q8 + tokenizer.json +
// preprocessor). Override via setMangaOcrModel() / 設定→進階.
const FALLBACK_MANGA_OCR_MODEL = 'ms57rd/manga-ocr-base-ONNX'
const LS_KEY = 'mangaOcrModelId'

export function getMangaOcrModelId(): string {
  try {
    return localStorage.getItem(LS_KEY) || FALLBACK_MANGA_OCR_MODEL
  } catch {
    return FALLBACK_MANGA_OCR_MODEL
  }
}

/** Persisted across reloads via localStorage; empty string resets to default. */
export function setMangaOcrModel(id: string) {
  try {
    if (id.trim()) localStorage.setItem(LS_KEY, id.trim())
    else localStorage.removeItem(LS_KEY)
  } catch {
    /* ignore */
  }
  pipePromise = null // force reload with the new id
}

let pipePromise: Promise<ImageToTextPipeline> | null = null
let pipeBackend: ComputeBackend | null = null

export async function loadMangaOcr(
  backend: ComputeBackend,
  onProgress?: LoadProgressCallback,
): Promise<ImageToTextPipeline> {
  if (pipePromise && pipeBackend === backend) return pipePromise
  pipeBackend = backend

  // Aggregate per-file download progress into a single 0..1 ratio.
  const files = new Map<string, { loaded: number; total: number }>()

  pipePromise = createImageToText('image-to-text', getMangaOcrModelId(), {
    device: backend === 'webgpu' ? 'webgpu' : 'wasm',
    // fp32 on WebGPU for quality; quantized on the WASM fallback for size/speed.
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
            ratio: total > 0 ? Math.min(1, loaded / total) : undefined,
            message: e.status === 'ready' ? '模型就緒' : '下載日文模型權重…',
          })
        }
      : undefined,
  })

  return pipePromise
}

/** Reject obviously degenerate / hallucinated output. */
function looksHallucinated(text: string): boolean {
  const t = text.trim()
  if (!t) return true
  // Single character repeated many times (classic blank-input loop).
  const chars = [...t]
  const unique = new Set(chars)
  if (chars.length >= 6 && unique.size <= 2) return true
  // A short repeating unit filling the whole string, e.g. "ありがとうありがとう…".
  for (let unit = 1; unit <= 4; unit++) {
    if (chars.length >= unit * 4) {
      const head = t.slice(0, unit)
      if (head.repeat(Math.floor(t.length / unit)).startsWith(t.slice(0, unit * 4))) {
        const repeated = head.repeat(Math.ceil(t.length / unit)).slice(0, t.length)
        if (repeated === t) return true
      }
    }
  }
  return false
}

export async function recognizeJpn(
  canvas: HTMLCanvasElement,
  detScore: number,
  backend: ComputeBackend,
): Promise<RecognitionOutput> {
  const pipe = await loadMangaOcr(backend)
  const image = RawImage.fromCanvas(canvas)
  const out = (await pipe(image, {
    max_new_tokens: 64,
    no_repeat_ngram_size: 3,
  } as Record<string, unknown>)) as Array<{ generated_text: string }> | { generated_text: string }

  const generated = Array.isArray(out) ? out[0]?.generated_text : out.generated_text
  const text = (generated ?? '').trim()

  if (looksHallucinated(text)) {
    return { text: '', score: 0 }
  }
  // manga-ocr exposes no token-level confidence; use detection score as proxy.
  return { text, score: detScore }
}

export async function disposeMangaOcr() {
  if (pipePromise) {
    const p = await pipePromise
    await p.dispose?.()
    pipePromise = null
  }
}
