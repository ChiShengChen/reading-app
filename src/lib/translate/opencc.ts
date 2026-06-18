/**
 * Simplified -> Traditional (zh-Hant) conversion via opencc-js.
 *
 * Opus-MT *-zh models emit Simplified Chinese, but our Hard Constraint target
 * is zh-Hant (Traditional, Taiwan). We post-convert Opus-MT output here.
 * (The Chrome Translator API already returns zh-Hant, so it skips this.)
 *
 * Loaded lazily via dynamic import so the OpenCC dictionaries are code-split
 * out of the main bundle and only fetched when local translation is used.
 * Uses the `cn2t`-only subpath (Simplified->Traditional dicts only, smaller).
 */
import type { ConverterFunction } from 'opencc-js'

let converterPromise: Promise<ConverterFunction> | null = null

async function getConverter(): Promise<ConverterFunction> {
  if (!converterPromise) {
    converterPromise = import('opencc-js/cn2t').then((OpenCC) =>
      // from 'cn' (Simplified) -> to 'tw' (Traditional, Taiwan)
      OpenCC.Converter({ from: 'cn', to: 'tw' }),
    )
  }
  return converterPromise
}

export async function toTraditional(texts: string[]): Promise<string[]> {
  const convert = await getConverter()
  return texts.map((t) => convert(t))
}
