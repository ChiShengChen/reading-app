export type OcrLanguage = 'en' | 'ja'

export interface RecognitionOutput {
  text: string
  /** Confidence in [0,1]. For manga-ocr (no native score) this is a proxy. */
  score: number
}

/** Download / load progress for a recognizer's weights. */
export interface ModelLoadProgress {
  /** 0..1 aggregate across all files, when known. */
  ratio?: number
  message?: string
}

export type LoadProgressCallback = (p: ModelLoadProgress) => void
