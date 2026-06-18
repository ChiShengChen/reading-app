/**
 * Recognizer dispatch by language + shared lifecycle/cache helpers.
 *   en -> Tesseract.js     ja -> manga-ocr (Transformers.js)
 */
import type { ComputeBackend } from '../../capabilities'
import { recognizeEng, disposeTesseract } from './tesseractEng'
import {
  recognizeJpn,
  loadMangaOcr,
  disposeMangaOcr,
  getMangaOcrModelId,
} from './mangaOcr'
import type { OcrLanguage, RecognitionOutput, LoadProgressCallback } from './types'

export type { OcrLanguage, RecognitionOutput, LoadProgressCallback } from './types'
export { setMangaOcrModel, getMangaOcrModelId, loadMangaOcr } from './mangaOcr'

export { recognizeEng } from './tesseractEng'

export async function recognizeRegion(
  canvas: HTMLCanvasElement,
  lang: OcrLanguage,
  detScore: number,
  backend: ComputeBackend,
): Promise<RecognitionOutput> {
  return lang === 'ja' ? recognizeJpn(canvas, detScore, backend) : recognizeEng(canvas)
}

/** Warm up the recognizer for a language (so download progress is visible). */
export async function preloadRecognizer(
  lang: OcrLanguage,
  backend: ComputeBackend,
  onProgress?: LoadProgressCallback,
): Promise<void> {
  if (lang === 'ja') {
    await loadMangaOcr(backend, onProgress)
  }
  // English warms up implicitly on first recognize() — fast + small.
}

export async function disposeRecognizers() {
  await Promise.all([disposeTesseract(), disposeMangaOcr()])
}

/**
 * Best-effort check whether manga-ocr weights are already in the Transformers.js
 * Cache API store, so the UI can warn before a ~440MB download.
 */
export async function isMangaOcrCached(): Promise<boolean> {
  if (!('caches' in self)) return false
  try {
    const cache = await caches.open('transformers-cache')
    const keys = await cache.keys()
    const id = getMangaOcrModelId()
    return keys.some((req) => req.url.includes(id) && req.url.endsWith('.onnx'))
  } catch {
    return false
  }
}
