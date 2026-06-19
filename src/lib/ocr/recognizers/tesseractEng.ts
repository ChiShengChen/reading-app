/**
 * English recognition — Tesseract.js (WASM). Mature, no hallucination, ships
 * its own segmentation; used as the verified Phase-1 baseline and the English
 * path. Reads an already-detected, tightly-cropped region.
 *
 * Phase 5: worker + core are self-hosted from /public/tesseract (copied by
 * scripts/sync-assets.mjs) for offline use. Only eng.traineddata still comes
 * from a CDN on first use (configurable via LANG_PATH; cached by the service
 * worker afterwards so it works offline thereafter).
 */
import { createWorker, PSM, type Worker } from 'tesseract.js'
import type { RecognitionOutput, LoadProgressCallback } from './types'

// Self-hosted worker + core (honour Vite base path, e.g. '/reading-app/').
const BASE = import.meta.env.BASE_URL
const WORKER_PATH = `${BASE}tesseract/worker.min.js`
const CORE_PATH = `${BASE}tesseract/core`
let LANG_PATH = 'https://tessdata.projectnaptha.com/4.0.0'

export function setTesseractLangPath(url: string) {
  LANG_PATH = url
}

let workerPromise: Promise<Worker> | null = null

export async function loadTesseract(onProgress?: LoadProgressCallback): Promise<Worker> {
  if (workerPromise) return workerPromise
  workerPromise = createWorker('eng', 1, {
    workerPath: WORKER_PATH,
    corePath: CORE_PATH,
    langPath: LANG_PATH,
    logger: onProgress
      ? (m) => {
          if (typeof m.progress === 'number') {
            onProgress({ ratio: m.progress, message: m.status })
          }
        }
      : undefined,
  })
  return workerPromise
}

let currentPsm: PSM | null = null

/**
 * Recognize English. `singleLine` picks the page-segmentation mode:
 *   - true  (PSM 7, SINGLE_LINE): for detected line crops — far more accurate
 *     than full-page layout analysis on a one-line image.
 *   - false (PSM 3, AUTO): for the whole-page fallback.
 */
export async function recognizeEng(
  canvas: HTMLCanvasElement,
  singleLine = true,
): Promise<RecognitionOutput> {
  const worker = await loadTesseract()
  const psm = singleLine ? PSM.SINGLE_LINE : PSM.AUTO
  if (psm !== currentPsm) {
    await worker.setParameters({ tessedit_pageseg_mode: psm })
    currentPsm = psm
  }
  const { data } = await worker.recognize(canvas)
  return {
    text: data.text.trim(),
    score: Math.max(0, Math.min(1, (data.confidence ?? 0) / 100)),
  }
}

export async function disposeTesseract() {
  if (workerPromise) {
    const w = await workerPromise
    await w.terminate()
    workerPromise = null
  }
}
