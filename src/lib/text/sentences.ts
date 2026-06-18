import type { OcrLanguage } from '../ocr/recognizers/types'

/**
 * Split recognized region text into sentences for per-sentence translation
 * (Phase 3). Language-aware: JP uses 。！？… and full-width marks; EN uses
 * ./!/? with a space/EOL lookahead to avoid splitting abbreviations mid-word.
 * Newlines are treated as soft breaks and joined within a region first.
 */
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
