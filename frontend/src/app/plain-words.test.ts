import { describe, expect, it } from 'vitest'

import {
  datasetName,
  distinctFields,
  plainName,
  plainValue,
} from './plain-words'

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

  it('says passage where the data says chunk', () => {
    expect(plainName('document_chunks')).toBe('document passages')
    expect(plainName('chunk_id')).toBe('passage id')
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

describe('distinctFields', () => {
  it('keeps one key where several hold the same value, preferring the id', () => {
    expect(
      distinctFields({
        game_id: 'GAME_UK_01',
        id: 'GAME_UK_01',
        name: 'Albion Millions',
        source_record_id: 'GAME_UK_01',
      }),
    ).toEqual([
      ['id', 'GAME_UK_01'],
      ['name', 'Albion Millions'],
    ])
  })

  it('keeps the first key when none is the id, and keeps the order of the rest', () => {
    expect(
      distinctFields({
        market_id: 'MKT_UK',
        region: 'South',
        home_market: 'MKT_UK',
      }),
    ).toEqual([
      ['market_id', 'MKT_UK'],
      ['region', 'South'],
    ])
  })

  it('never drops a field because an empty or boolean value repeats', () => {
    expect(
      distinctFields({ a: true, b: true, c: null, d: null, e: 0, f: 0 }),
    ).toHaveLength(6)
  })
})
