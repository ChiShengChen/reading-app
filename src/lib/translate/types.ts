import type { OcrLanguage } from '../ocr/recognizers/types'

export type { OcrLanguage }

/** Always Traditional Chinese per Hard Constraints. */
export const TARGET_LANG = 'zh-Hant' as const
export type TargetLang = typeof TARGET_LANG

export type TranslationEngine = 'translator-api' | 'opus-mt'

/** 'auto' resolves to translator-api when available (desktop), else opus-mt. */
export type EnginePreference = TranslationEngine | 'auto'

export interface TranslationPair {
  source: string
  target: string
}

export interface TranslateProgress {
  phase: 'loading' | 'translating'
  /** 0..1 when known. */
  ratio?: number
  message?: string
  engine?: TranslationEngine
}

export type TranslateProgressCallback = (p: TranslateProgress) => void

export interface TranslateResult {
  engine: TranslationEngine
  pairs: TranslationPair[]
  /** True when output is still Simplified (should be false after OpenCC). */
  isSimplified: boolean
  /** True when Opus-MT output was post-converted Simplified -> Traditional. */
  convertedFromSimplified: boolean
}
