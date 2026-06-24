import { describe, it, expect } from 'vitest'
import { chunkLong } from './opusMt'

const MAX = 140

describe('chunkLong (bound MarianMT inference length)', () => {
  it('leaves short text as a single chunk', () => {
    expect(chunkLong('hello world')).toEqual(['hello world'])
  })

  it('caps every chunk at the limit', () => {
    const long = 'x'.repeat(500)
    const chunks = chunkLong(long)
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(MAX)
    expect(chunks.join('')).toBe(long)
  })

  it('prefers clause boundaries for CJK', () => {
    const s = 'あ'.repeat(100) + '、' + 'い'.repeat(100)
    const chunks = chunkLong(s)
    expect(chunks.length).toBe(2)
    expect(chunks[0].endsWith('、')).toBe(true)
  })

  it('breaks English at spaces, not mid-word', () => {
    const word = 'lorem '
    const chunks = chunkLong(word.repeat(40))
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(MAX)
    // no chunk should start or end inside a word fragment
    for (const c of chunks) expect(c.trim()).not.toMatch(/^lore$|lo$/)
  })
})
