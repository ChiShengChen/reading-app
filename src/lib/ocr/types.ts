import type { OcrRegion } from '../../db/db'
import type { OcrLanguage } from './recognizers/types'

export type { OcrRegion }
export type { OcrLanguage } from './recognizers/types'

/** Axis-aligned box in source-image pixel coordinates. */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface DetectedRegion {
  box: Box
  /** Detection confidence in [0,1] (mean probability inside the box). */
  detScore: number
}

export interface RecognizedRegion extends DetectedRegion {
  text: string
  /** Recognition confidence in [0,1]. */
  recScore: number
  /** Region text split into sentences (for per-sentence translation, Phase 3). */
  sentences: string[]
}

export type PipelineStage =
  | 'idle'
  | 'preprocess'
  | 'loading-detector'
  | 'detecting'
  | 'loading-recognizer'
  | 'recognizing'
  | 'done'
  | 'error'

export interface PipelineProgress {
  stage: PipelineStage
  /** 0..1 within the current stage, when known. */
  ratio?: number
  message?: string
  /** Which recognition engine actually ran. */
  engine?: 'tesseract-eng' | 'manga-ocr' | 'fallback-fullpage'
}

export interface PipelineResult {
  lang: OcrLanguage
  regions: RecognizedRegion[]
  fullText: string
  /** Flat, ordered list of sentences across all regions (Phase-3 input). */
  sentences: string[]
  /** True when detection was skipped and we OCR'd the whole image. */
  usedFullPageFallback: boolean
  /** Detection error message (load/run failure), when detection didn't run. */
  detectError?: string
  /** The enhanced canvas the region boxes are expressed in (for overlay). */
  processed: HTMLCanvasElement
}

export type ProgressCallback = (p: PipelineProgress) => void
