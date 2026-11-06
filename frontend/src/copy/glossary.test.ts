import { describe, expect, it } from 'vitest'

import { GLOSSARY_TERMS } from './glossary'

// The banned-word scan of terms and plain definitions is in banned-words.test.ts ("generated copy").
describe('glossary terms', () => {
  it('every glossary term has a plain definition', () => {
    expect(GLOSSARY_TERMS.length).toBeGreaterThan(30)
    for (const { term, meaning } of GLOSSARY_TERMS) {
      const words = meaning.split(/\s+/).filter(Boolean).length
      expect(words, term).toBeGreaterThanOrEqual(5)
      // Plain definitions stay short; the technical one carries the detail.
      expect(words, term).toBeLessThanOrEqual(35)
    }
  })

  it('explains the words a newcomer meets first', () => {
    const names = GLOSSARY_TERMS.map(({ term }) => term)
    for (const term of [
      'World',
      'Retrieval',
      'Benchmark',
      'Run',
      'Approach',
      'Precision',
      'Multi-hop',
    ])
      expect(names, term).toContain(term)
  })

  it('has a technical definition only where it adds to the plain one', () => {
    for (const { term, meaning, technical } of GLOSSARY_TERMS)
      if (technical !== undefined) {
        expect(technical, term).not.toBe(meaning)
        expect(technical.length, term).toBeGreaterThan(20)
      }
  })

  it('are listed once each, in alphabetical order', () => {
    const names = GLOSSARY_TERMS.map(({ term }) => term)
    expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(
      names.length,
    )
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
  })
})
