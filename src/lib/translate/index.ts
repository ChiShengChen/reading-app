/**
 * Translation dispatch + engine selection.
 *
 * Unified path = Opus-MT (works everywhere, offline). Chrome Translator API is
 * an additive desktop upgrade: preferred when available because it targets
 * zh-Hant directly (Opus-MT outputs Simplified). 'auto' resolves accordingly.
 */
import type { ComputeBackend } from '../capabilities'
import { translateOpus } from './opusMt'
import { translatorAvailable, translateWithApi } from './translatorApi'
import { toTraditional } from './opencc'
import type {
  EnginePreference,
  OcrLanguage,
  TranslateProgressCallback,
  TranslateResult,
  TranslationEngine,
} from './types'

export type {
  EnginePreference,
  TranslationEngine,
  TranslationPair,
  TranslateProgress,
  TranslateResult,
} from './types'
export { hasTranslatorApi, translatorAvailable } from './translatorApi'
export { getOpusChain, setOpusChain, loadOpusModel } from './opusMt'

/** Resolve which engine to actually use given preference + availability. */
export async function resolveEngine(
  preference: EnginePreference,
  lang: OcrLanguage,
): Promise<TranslationEngine> {
  if (preference === 'opus-mt') return 'opus-mt'
  const apiOk = await translatorAvailable(lang)
  if (preference === 'translator-api') {
    if (!apiOk) throw new Error('此瀏覽器的 Translator API 不支援所選語言對。')
    return 'translator-api'
  }
  // auto
  return apiOk ? 'translator-api' : 'opus-mt'
}

export async function translateSentences(
  sentences: string[],
  lang: OcrLanguage,
  preference: EnginePreference,
  backend: ComputeBackend,
  onProgress?: TranslateProgressCallback,
): Promise<TranslateResult> {
  const engine = await resolveEngine(preference, lang)
  let targets =
    engine === 'translator-api'
      ? await translateWithApi(sentences, lang, onProgress)
      : await translateOpus(sentences, lang, backend, onProgress)

  // Opus-MT outputs Simplified; post-convert to zh-Hant (Traditional).
  let convertedFromSimplified = false
  if (engine === 'opus-mt') {
    onProgress?.({ phase: 'translating', engine, message: '簡→繁轉換（OpenCC）…' })
    targets = await toTraditional(targets)
    convertedFromSimplified = true
  }

  return {
    engine,
    pairs: sentences.map((source, i) => ({ source, target: targets[i] ?? '' })),
    isSimplified: false,
    convertedFromSimplified,
  }
}
