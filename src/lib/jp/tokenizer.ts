/**
 * Japanese tokenization for click-to-look-up.
 *
 * Primary: kuromoji.js — gives surface form + reading + dictionary base form +
 * POS, which we need to query JMdict. Dictionary files live in /public/dict
 * (copied by scripts/sync-assets.mjs) and are fetched lazily (~15MB, cached).
 *
 * Fallback: Intl.Segmenter (granularity 'word', ja) when kuromoji can't load —
 * gives clickable word boundaries but no reading/base form. Lookups then fall
 * back to surface-form search.
 */
import kuromoji, { type IpadicFeatures, type Tokenizer } from 'kuromoji'

export interface JpToken {
  surface: string
  /** Reading in hiragana, when known. */
  reading?: string
  /** Dictionary (base/lemma) form for lookup, when known. */
  base?: string
  pos?: string
  /** Clickable content word (not punctuation/space). */
  isWord: boolean
}

const DICT_PATH = '/dict'

let tokenizerPromise: Promise<Tokenizer<IpadicFeatures> | null> | null = null

/** Lazy-build kuromoji; resolves null (not throws) if the dict can't load. */
export function loadTokenizer(): Promise<Tokenizer<IpadicFeatures> | null> {
  if (tokenizerPromise) return tokenizerPromise
  tokenizerPromise = new Promise((resolve) => {
    try {
      kuromoji.builder({ dicPath: DICT_PATH }).build((err, tokenizer) => {
        if (err) {
          console.warn('[tokenizer] kuromoji failed, will use Intl.Segmenter:', err)
          resolve(null)
        } else {
          resolve(tokenizer)
        }
      })
    } catch (err) {
      console.warn('[tokenizer] kuromoji threw, will use Intl.Segmenter:', err)
      resolve(null)
    }
  })
  return tokenizerPromise
}

const KATA_TO_HIRA_OFFSET = 0x60
function kataToHira(s: string): string {
  return s.replace(/[ァ-ヶ]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - KATA_TO_HIRA_OFFSET),
  )
}

function clean(v: string | undefined): string | undefined {
  return v && v !== '*' ? v : undefined
}

export async function tokenize(text: string): Promise<JpToken[]> {
  const tokenizer = await loadTokenizer()
  if (tokenizer) {
    return tokenizer.tokenize(text).map((t) => {
      const reading = clean(t.reading)
      return {
        surface: t.surface_form,
        reading: reading ? kataToHira(reading) : undefined,
        base: clean(t.basic_form),
        pos: clean(t.pos),
        isWord: t.pos !== '記号' && t.surface_form.trim().length > 0,
      }
    })
  }
  return segmentFallback(text)
}

function segmentFallback(text: string): JpToken[] {
  const Seg = (Intl as unknown as { Segmenter?: typeof Intl.Segmenter }).Segmenter
  if (!Seg) {
    // Last resort: one token for the whole string.
    return [{ surface: text, isWord: true }]
  }
  const seg = new Seg('ja', { granularity: 'word' })
  const out: JpToken[] = []
  for (const s of seg.segment(text)) {
    out.push({ surface: s.segment, isWord: Boolean(s.isWordLike) })
  }
  return out
}

export async function isKuromojiAvailable(): Promise<boolean> {
  return (await loadTokenizer()) !== null
}
