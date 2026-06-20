import { describe, it, expect } from 'vitest'
import { candidates } from './ecdict'

describe('ecdict candidates (de-inflection)', () => {
  it('includes the lowercased word itself', () => {
    expect(candidates('Running')).toContain('running')
  })
  it('handles plurals', () => {
    expect(candidates('books')).toContain('book')
    expect(candidates('cities')).toContain('city')
    expect(candidates('boxes')).toContain('box')
  })
  it('handles -ing / -ed', () => {
    expect(candidates('making')).toContain('make')
    expect(candidates('running')).toContain('run')
    expect(candidates('stopped')).toContain('stop')
  })
  it('handles -ly adverbs', () => {
    expect(candidates('quickly')).toContain('quick')
  })
  it('strips possessive', () => {
    expect(candidates("dog's")).toContain('dog')
  })
})
