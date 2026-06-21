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
import { enhanceForOcr, cropCanvas, deskewCanvas, rotate90 } from '../image/preprocess'
import { splitSentences, mergeLines } from '../text/sentences'
import { detect } from './detector'
import { recognizeRegion, recognizeEng, preloadRecognizer } from './recognizers'
import type { OcrLanguage } from './recognizers/types'
import type { Box, PipelineResult, ProgressCallback, RecognizedRegion } from './types'

/**
 * Confidence gate. Japanese (manga-ocr) hallucinates, so low-confidence regions
 * are dropped. English (Tesseract) does NOT hallucinate, so we keep all
 * non-empty text — dropping low-confidence lines was silently losing whole
 * paragraphs. Empty text is always dropped.
 */
const MIN_REC_SCORE_JA = 0.4

export type JpOrientation = 'auto' | 'horizontal' | 'vertical'

export async function runOcr(
  cropped: HTMLCanvasElement,
  lang: OcrLanguage,
  backend: ComputeBackend,
  onProgress?: ProgressCallback,
  jpOrientation: JpOrientation = 'auto',
): Promise<PipelineResult> {
  onProgress?.({ stage: 'preprocess', message: '影像強化中…' })
  let enhanced = enhanceForOcr(cropped, { deskew: false })

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

  // Auto-orientation (English): if the detected line boxes are mostly "portrait"
  // (taller than wide) the page was shot sideways; find the rotation whose
  // sample line recognizes most confidently and use it.
  if (lang === 'en' && !detectionFailed && detected.length >= 2) {
    onProgress?.({ stage: 'detecting', message: '判斷頁面方向…' })
    const oriented = await autoOrientEn(enhanced, detected, backend)
    enhanced = oriented.enhanced
    detected = oriented.detected
  }

  // Japanese vertical (直書) handling: detect tall-narrow column boxes, reorder
  // right-to-left + top-to-bottom (vertical reading order), and skip the
  // horizontal de-skew (manga-ocr reads vertical column crops natively).
  let vertical = false
  if (lang === 'ja' && !detectionFailed && detected.length >= 1) {
    if (jpOrientation === 'vertical') vertical = true
    else if (jpOrientation === 'auto') {
      const portrait = detected.filter((d) => d.box.h > d.box.w * 1.3).length / detected.length
      vertical = portrait > 0.5
    }
    if (vertical) {
      detected = [...detected].sort((a, b) => {
        const dx = b.box.x - a.box.x // rightmost column first
        if (Math.abs(dx) > Math.min(a.box.w, b.box.w) * 0.6) return dx
        return a.box.y - b.box.y // within a column, top first
      })
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
    const out = await recognizeEng(enhanced, false) // whole-page layout analysis
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
      // Crop the line, then micro-deskew it level before recognition. Vertical
      // columns are not horizontal text lines, so skip the horizontal de-skew
      // (manga-ocr reads vertical column crops natively).
      const cropped = cropCanvas(enhanced, region.box)
      const regionCanvas = vertical ? cropped : deskewCanvas(cropped)
      const out = await recognizeRegion(regionCanvas, lang, region.detScore, backend)
      // Drop empty always; drop low-confidence only for hallucination-prone JP.
      if (!out.text) continue
      if (lang === 'ja' && out.score < MIN_REC_SCORE_JA) continue
      regions.push({
        ...region,
        text: out.text,
        recScore: out.score,
        sentences: splitSentences(out.text, lang),
      })
    }
  }

  // Merge detected lines into reading-order text, then sentence-split — so a
  // sentence spanning several line-boxes translates as one unit.
  const merged = mergeLines(
    regions.map((r) => r.text),
    lang,
  )
  const fullText = merged || regions.map((r) => r.text).join('\n')
  const sentences = splitSentences(merged, lang)
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

interface Oriented {
  enhanced: HTMLCanvasElement
  detected: { box: Box; detScore: number }[]
}

/** Recognize the widest detected line as a confidence sample for orientation. */
async function sampleConfidence(
  img: HTMLCanvasElement,
  boxes: { box: Box; detScore: number }[],
  backend: ComputeBackend,
): Promise<number> {
  if (boxes.length === 0) return 0
  const widest = boxes.reduce((a, b) => (b.box.w > a.box.w ? b : a))
  // Use the selected English engine (PaddleOCR/Tesseract) so paddle-only mode
  // doesn't also spin up Tesseract just for the orientation probe.
  const out = await recognizeRegion(deskewCanvas(cropCanvas(img, widest.box)), 'en', 1, backend)
  return out.score
}

/**
 * Pick page orientation for English. Upright pages (wide line boxes, confident
 * sample) are kept as-is cheaply; only when boxes look "portrait" do we test
 * ±90° rotations and keep whichever sample recognizes best.
 */
async function autoOrientEn(
  enhanced: HTMLCanvasElement,
  detected: { box: Box; detScore: number }[],
  backend: ComputeBackend,
): Promise<Oriented> {
  const portraitFrac =
    detected.filter((d) => d.box.h > d.box.w * 1.3).length / detected.length
  const baseScore = await sampleConfidence(enhanced, detected, backend)

  // Looks upright and reads well — keep it (1 sample call, no rotation).
  if (portraitFrac < 0.5 && baseScore >= 0.55) return { enhanced, detected }

  let best: Oriented & { score: number } = { enhanced, detected, score: baseScore }
  for (const clockwise of [true, false]) {
    try {
      const rot = rotate90(enhanced, clockwise)
      const boxes = await detect(rot, backend)
      if (boxes.length === 0) continue
      const score = await sampleConfidence(rot, boxes, backend)
      if (score > best.score) best = { enhanced: rot, detected: boxes, score }
    } catch (err) {
      console.warn('[pipeline] orientation probe failed:', err)
    }
  }
  return { enhanced: best.enhanced, detected: best.detected }
}
