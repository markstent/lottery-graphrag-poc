import { describe, expect, it } from 'vitest'

import { GLOSSARY_TERMS } from './glossary'

describe('glossary terms', () => {
  it('are twelve, each with a plain meaning of about twelve words', () => {
    expect(GLOSSARY_TERMS).toHaveLength(12)
    for (const { term, meaning } of GLOSSARY_TERMS) {
      const words = meaning.split(/\s+/).length
      expect(words, term).toBeGreaterThanOrEqual(8)
      expect(words, term).toBeLessThanOrEqual(16)
    }
  })

  it('are listed once each, in alphabetical order', () => {
    const names = GLOSSARY_TERMS.map(({ term }) => term)
    expect(new Set(names).size).toBe(12)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
  })
})
