import type { OcrLanguage } from '../ocr/recognizers/types'

/**
 * Split recognized region text into sentences for per-sentence translation
 * (Phase 3). Language-aware: JP uses 。！？… and full-width marks; EN uses
 * ./!/? with a space/EOL lookahead to avoid splitting abbreviations mid-word.
 * Newlines are treated as soft breaks and joined within a region first.
 */
/**
 * Merge detected LINE texts (reading order) into a continuous block before
 * sentence-splitting. A sentence usually spans several detection-box lines, so
 * translating each box separately cuts sentences mid-way. JP joins with no
 * space; EN joins with a space and de-hyphenates line-end breaks
 * ("expedi-" + "tion" -> "expedition").
 */
export function mergeLines(lines: string[], lang: OcrLanguage): string {
  const parts = lines.map((l) => l.trim()).filter(Boolean)
  if (lang === 'ja') return parts.join('')
  let out = ''
  for (const t of parts) {
    if (!out) {
      out = t
    } else if (/[A-Za-z]-$/.test(out) && /^[a-z]/.test(t)) {
      out = out.slice(0, -1) + t // de-hyphenate a hard line break
    } else {
      out += ' ' + t
    }
  }
  return out
}

export function splitSentences(text: string, lang: OcrLanguage): string[] {
  const normalized = text
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join(lang === 'ja' ? '' : ' ')
    .trim()
  if (!normalized) return []

  if (lang === 'ja') {
    // Keep the terminator with its sentence.
    return normalized
      .split(/(?<=[。．！？!?…])/)
      .map((s) => s.trim())
      .filter(Boolean)
  }

  // English: split after . ! ? when followed by whitespace+capital or end.
  return normalized
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)
    .map((s) => s.trim())
    .filter(Boolean)
}
