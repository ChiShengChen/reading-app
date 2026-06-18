/**
 * Chrome built-in Translator API — DESKTOP quality upgrade only (Hard
 * Constraint / architecture: additive, never required). It targets zh-Hant
 * directly (Traditional), unlike Opus-MT. We feature-detect and gracefully
 * decline when unavailable so the unified Opus-MT path always works.
 *
 * Note: Gemini Nano does NOT support Chinese — the Translator API is a separate
 * on-device MT model and IS used for Chinese; we never ask Nano for zh output.
 */
import { TARGET_LANG, type OcrLanguage, type TranslateProgressCallback } from './types'

// Minimal ambient typings for the (non-standard) Translator API.
interface TranslatorInstance {
  translate(input: string): Promise<string>
  ready?: Promise<void>
  destroy?: () => void
}
interface TranslatorMonitor {
  addEventListener(type: 'downloadprogress', cb: (e: { loaded: number }) => void): void
}
interface TranslatorCtor {
  availability(opts: { sourceLanguage: string; targetLanguage: string }): Promise<string>
  create(opts: {
    sourceLanguage: string
    targetLanguage: string
    monitor?: (m: TranslatorMonitor) => void
  }): Promise<TranslatorInstance>
}

function getCtor(): TranslatorCtor | null {
  const g = self as unknown as { Translator?: TranslatorCtor }
  return g.Translator ?? null
}

export function hasTranslatorApi(): boolean {
  return getCtor() !== null
}

/** Whether the en/ja -> zh-Hant pair is usable (available or downloadable). */
export async function translatorAvailable(lang: OcrLanguage): Promise<boolean> {
  const ctor = getCtor()
  if (!ctor) return false
  try {
    const status = await ctor.availability({ sourceLanguage: lang, targetLanguage: TARGET_LANG })
    return status === 'available' || status === 'downloadable' || status === 'downloading'
  } catch {
    return false
  }
}

const instances = new Map<OcrLanguage, Promise<TranslatorInstance>>()

async function getInstance(
  lang: OcrLanguage,
  onProgress?: TranslateProgressCallback,
): Promise<TranslatorInstance> {
  const cached = instances.get(lang)
  if (cached) return cached
  const ctor = getCtor()
  if (!ctor) throw new Error('Translator API 不可用')
  const p = ctor.create({
    sourceLanguage: lang,
    targetLanguage: TARGET_LANG,
    monitor: onProgress
      ? (m) =>
          m.addEventListener('downloadprogress', (e) =>
            onProgress({
              phase: 'loading',
              engine: 'translator-api',
              ratio: e.loaded,
              message: '下載瀏覽器翻譯模型…',
            }),
          )
      : undefined,
  })
  instances.set(lang, p)
  return p
}

export async function translateWithApi(
  sentences: string[],
  lang: OcrLanguage,
  onProgress?: TranslateProgressCallback,
): Promise<string[]> {
  const translator = await getInstance(lang, onProgress)
  await translator.ready
  const out: string[] = []
  for (let i = 0; i < sentences.length; i++) {
    onProgress?.({
      phase: 'translating',
      engine: 'translator-api',
      ratio: i / sentences.length,
      message: `翻譯 ${i + 1} / ${sentences.length}`,
    })
    out.push((await translator.translate(sentences[i])).trim())
  }
  return out
}

export function disposeTranslatorApi() {
  instances.clear()
}
