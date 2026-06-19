/**
 * OCR pipeline orchestration (Phase 1 + 2):
 *   enhance -> [detect] PaddleOCR -> [recognize] per region -> split sentences
 *
 * Recognizer is chosen by language: en -> Tesseract, ja -> manga-ocr.
 *
 * Degradation: if detection can't load (404 / CORS / no network) or finds
 * nothing, we fall back to a single full-page pass and flag it. The fallback is
 * the one place we relax Critical Rule #1 — and it is ONLY allowed for English
 * (Tesseract). For Japanese we never full-page manga-ocr, because it
 * hallucinates (Critical Rule #2); instead we report that detection is required.
 */
import type { ComputeBackend } from '../capabilities'
import { errorMessage } from '../errorMessage'
import { enhanceForOcr, cropCanvas } from '../image/preprocess'
import { splitSentences } from '../text/sentences'
import { detect } from './detector'
import { recognizeRegion, recognizeEng, preloadRecognizer } from './recognizers'
import type { OcrLanguage } from './recognizers/types'
import type { Box, PipelineResult, ProgressCallback, RecognizedRegion } from './types'

/** Drop recognized regions that are empty or below this recognition score. */
const MIN_REC_SCORE = 0.4

export async function runOcr(
  cropped: HTMLCanvasElement,
  lang: OcrLanguage,
  backend: ComputeBackend,
  onProgress?: ProgressCallback,
): Promise<PipelineResult> {
  onProgress?.({ stage: 'preprocess', message: '影像強化中…' })
  const enhanced = enhanceForOcr(cropped, { deskew: false })

  let detected: { box: Box; detScore: number }[] = []
  let detectionFailed = false
  let detectError: string | undefined

  try {
    onProgress?.({ stage: 'loading-detector', message: '載入偵測模型…' })
    onProgress?.({ stage: 'detecting', message: '偵測文字區域…' })
    detected = await detect(enhanced, backend)
    // WebGPU sometimes loads the session but yields an empty/garbage map on
    // some GPUs; retry once on WASM before giving up.
    if (detected.length === 0 && backend === 'webgpu') {
      onProgress?.({ stage: 'detecting', message: '偵測無結果，改用 WASM 重試…' })
      try {
        detected = await detect(enhanced, 'wasm')
      } catch (err2) {
        console.warn('[pipeline] wasm detection retry failed:', err2)
      }
    }
  } catch (err) {
    console.warn('[pipeline] detection unavailable:', err)
    detectionFailed = true
    detectError = errorMessage(err)
    // Try WASM as a fallback execution provider.
    try {
      onProgress?.({ stage: 'detecting', message: '偵測（WebGPU）失敗，改用 WASM 重試…' })
      detected = await detect(enhanced, 'wasm')
      detectionFailed = false
      detectError = undefined
    } catch (err2) {
      console.warn('[pipeline] wasm detection retry failed:', err2)
      detectError = errorMessage(err2)
    }
  }

  // For Japanese, manga-ocr MUST run on detected regions only. If detection is
  // unavailable, refuse rather than full-page hallucinate.
  if (lang === 'ja' && (detectionFailed || detected.length === 0)) {
    throw new Error(
      detectionFailed
        ? '日文辨識需要偵測模型，但偵測模型載入失敗。請確認偵測模型 URL，或先用英文驗證。'
        : '未偵測到文字區域；日文不使用整頁後備（manga-ocr 會幻覺）。請調整裁切或前處理。',
    )
  }

  const fallback = lang === 'en' && (detectionFailed || detected.length === 0)
  const regions: RecognizedRegion[] = []

  if (fallback) {
    onProgress?.({
      stage: 'recognizing',
      engine: 'fallback-fullpage',
      message: '偵測未啟用，改為整頁辨識（僅英文）…',
    })
    const out = await recognizeEng(enhanced)
    if (out.text) {
      regions.push({
        box: { x: 0, y: 0, w: enhanced.width, h: enhanced.height },
        detScore: 1,
        text: out.text,
        recScore: out.score,
        sentences: splitSentences(out.text, lang),
      })
    }
  } else {
    // Warm up the recognizer first so model-download progress is visible.
    if (lang === 'ja') {
      onProgress?.({ stage: 'loading-recognizer', engine: 'manga-ocr', message: '準備日文模型…' })
      await preloadRecognizer('ja', backend, (p) =>
        onProgress?.({
          stage: 'loading-recognizer',
          engine: 'manga-ocr',
          ratio: p.ratio,
          message: p.message,
        }),
      )
    }

    const total = detected.length
    const engine = lang === 'ja' ? 'manga-ocr' : 'tesseract-eng'
    for (let i = 0; i < total; i++) {
      const region = detected[i]
      onProgress?.({
        stage: 'recognizing',
        engine,
        ratio: i / total,
        message: `辨識區域 ${i + 1} / ${total}`,
      })
      const regionCanvas = cropCanvas(enhanced, region.box)
      const out = await recognizeRegion(regionCanvas, lang, region.detScore, backend)
      // Critical Rule #2: discard empty / low-confidence regions.
      if (!out.text || out.score < MIN_REC_SCORE) continue
      regions.push({
        ...region,
        text: out.text,
        recScore: out.score,
        sentences: splitSentences(out.text, lang),
      })
    }
  }

  const fullText = regions.map((r) => r.text).join('\n')
  const sentences = regions.flatMap((r) => r.sentences)
  onProgress?.({ stage: 'done', ratio: 1, message: `完成，取得 ${regions.length} 個區域` })

  return {
    lang,
    regions,
    fullText,
    sentences,
    usedFullPageFallback: fallback,
    detectError,
    processed: enhanced,
  }
}
