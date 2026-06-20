import { describe, it, expect } from 'vitest'
import { mergeLines, splitSentences } from './sentences'

describe('mergeLines', () => {
  it('de-hyphenates English line breaks', () => {
    expect(mergeLines(['an expedi-', 'tion which'], 'en')).toBe('an expedition which')
  })
  it('joins English lines with a space', () => {
    expect(mergeLines(['Hello there.', 'How are you?'], 'en')).toBe('Hello there. How are you?')
  })
  it('joins Japanese lines without a space', () => {
    expect(mergeLines(['これは', 'ペンです'], 'ja')).toBe('これはペンです')
  })
  it('drops blank lines', () => {
    expect(mergeLines(['a', '  ', 'b'], 'en')).toBe('a b')
  })
})

describe('splitSentences', () => {
  it('splits English on sentence punctuation', () => {
    expect(splitSentences('It works. Does it? Yes!', 'en')).toEqual([
      'It works.',
      'Does it?',
      'Yes!',
    ])
  })
  it('splits Japanese on 。！？', () => {
    expect(splitSentences('これはペンです。あれは本です。', 'ja')).toEqual([
      'これはペンです。',
      'あれは本です。',
    ])
  })
})
