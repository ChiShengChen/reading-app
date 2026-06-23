/**
 * Recognizer dispatch by language + shared lifecycle/cache helpers.
 *   en -> Tesseract.js     ja -> manga-ocr (Transformers.js)
 */
import type { ComputeBackend } from '../../capabilities'
import { recognizeEng, disposeTesseract } from './tesseractEng'
import { recognizePaddleEn, disposePaddleRec } from './paddleRec'
import {
  recognizeJpn,
  loadMangaOcr,
  disposeMangaOcr,
  getMangaOcrModelId,
} from './mangaOcr'
import type { OcrLanguage, RecognitionOutput, LoadProgressCallback } from './types'

export type { OcrLanguage, RecognitionOutput, LoadProgressCallback } from './types'
export { setMangaOcrModel, getMangaOcrModelId, loadMangaOcr } from './mangaOcr'
export {
  getPaddleRecUrl,
  setPaddleRecUrl,
  getPaddleDictUrl,
  setPaddleDictUrl,
} from './paddleRec'
export { recognizeEng } from './tesseractEng'

// Which engine recognizes English line crops. PaddleOCR PP-OCRv5 (CTC) is the
// default — faster + usually more accurate on printed text than Tesseract.
export type EnglishRecognizer = 'paddle' | 'tesseract'
const LS_EN = 'englishRecognizer'

export function getEnglishRecognizer(): EnglishRecognizer {
  try {
    return localStorage.getItem(LS_EN) === 'tesseract' ? 'tesseract' : 'paddle'
  } catch {
    return 'paddle'
  }
}
export function setEnglishRecognizer(v: EnglishRecognizer) {
  try {
    localStorage.setItem(LS_EN, v)
  } catch {
    /* ignore */
  }
}

export async function recognizeRegion(
  canvas: HTMLCanvasElement,
  lang: OcrLanguage,
  detScore: number,
  backend: ComputeBackend,
): Promise<RecognitionOutput> {
  if (lang === 'ja') return recognizeJpn(canvas, detScore, backend)
  return getEnglishRecognizer() === 'paddle'
    ? recognizePaddleEn(canvas, backend)
    : recognizeEng(canvas)
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
  await Promise.all([disposeTesseract(), disposeMangaOcr(), disposePaddleRec()])
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
