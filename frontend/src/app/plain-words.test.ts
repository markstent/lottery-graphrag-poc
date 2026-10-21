import { describe, expect, it } from 'vitest'

import { datasetName, plainName, plainValue } from './plain-words'

describe('plain words', () => {
  it('turns a dataset id into a name', () => {
    expect(datasetName('dev-seed2026')).toBe('dev world, 2026')
    expect(datasetName('official-seed7')).toBe('official world, 7')
  })

  it('reads an id of another shape as words', () => {
    expect(datasetName('my_world')).toBe('my world')
  })

  it('turns field names into words', () => {
    expect(plainName('affected_systems')).toBe('affected systems')
    expect(plainName('affectedSystems')).toBe('affected systems')
    expect(plainName('title')).toBe('title')
  })

  it('shows lists as comma lists, nothing as none, and nested fields as pairs', () => {
    expect(plainValue(['checkout', 'wallet'])).toBe('checkout, wallet')
    expect(plainValue([])).toBe('')
    expect(plainValue(null)).toBe('none')
    expect(plainValue(3)).toBe('3')
    expect(plainValue(false)).toBe('false')
    expect(plainValue({ open_date: '2026-03-02', tags: ['a', 'b'] })).toBe(
      'open date: 2026-03-02; tags: a, b',
    )
  })
})
