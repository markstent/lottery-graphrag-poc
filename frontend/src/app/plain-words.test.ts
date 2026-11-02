import { describe, expect, it } from 'vitest'

import {
  datasetName,
  distinctFields,
  FAILURE_WORDS,
  failureWords,
  marketsInWords,
  plainName,
  plainValue,
} from './plain-words'

describe('plain words', () => {
  it('writes market codes as countries, with "the" where a country takes it', () => {
    expect(
      marketsInWords(
        'Incidents on the same platform version as INC_042 were seen in MKT_AT and MKT_CZ, and MKT_UK was unaffected.',
      ),
    ).toBe(
      'Incidents on the same platform version as INC_042 were seen in Austria and the Czech Republic, and the United Kingdom was unaffected.',
    )
    expect(marketsInWords('MKT_UK deferred it; MKT_GR did not.')).toBe(
      'The United Kingdom deferred it; Greece did not.',
    )
    // Other ids, and a market code the app does not know, stay as written.
    expect(marketsInWords('GAME_AT_02 in MKT_XX')).toBe('GAME_AT_02 in MKT_XX')
  })

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

describe('failureWords', () => {
  it('has words for every class the backend scorer names', () => {
    expect(Object.keys(FAILURE_WORDS).sort()).toEqual([
      'entity_resolution_failure',
      'generation_failure',
      'retrieval_failure',
    ])
  })
  it('says what each class means in plain words', () => {
    expect(failureWords('retrieval_failure')).toBe(
      'the needed evidence was not retrieved',
    )
    expect(failureWords('entity_resolution_failure')).toBe(
      'the starting record was not found',
    )
    expect(failureWords('generation_failure')).toBe(
      'the evidence was retrieved but the answer was wrong',
    )
  })
  it('reads a class from a newer backend as its own words, and no class as null', () => {
    expect(failureWords('new_kind_of_failure')).toBe('new kind of failure')
    expect(failureWords(null)).toBeNull()
  })
})
