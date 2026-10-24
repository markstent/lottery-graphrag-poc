import { describe, expect, it } from 'vitest'

import type { Schemas } from '../api/client'
import { RECORDINGS } from '../test/recordings'
import { coverage, MARKETS } from './coverage'

type Results = Schemas['QueryResults']

const chunk = (id: string, market: string, selected: boolean) => ({
  chunk_id: id,
  market_id: market,
  selected,
})
const node = (
  id: string,
  selected: boolean,
  authoritative: Record<string, string> | null,
) => ({ node_id: id, selected, authoritative })
const answer = { text: '', citations: [] }

/** Results holding only the fields `coverage` may read. */
const results = (pipelines: Record<string, unknown>): Results =>
  ({ results: pipelines }) as unknown as Results

describe('MARKETS', () => {
  it('lists the four markets in a fixed order with plain names', () => {
    expect(MARKETS).toEqual([
      { id: 'MKT_UK', name: 'United Kingdom' },
      { id: 'MKT_GR', name: 'Greece' },
      { id: 'MKT_AT', name: 'Austria' },
      { id: 'MKT_CZ', name: 'Czech Republic' },
    ])
  })
})

describe('coverage', () => {
  it('reads the market of each used passage or record, in the fixed order', () => {
    const found = coverage(
      results({
        A: {
          answer,
          evidence: [
            chunk('c1', 'MKT_CZ', true),
            chunk('c2', 'MKT_UK', true),
            chunk('c3', 'MKT_UK', true),
          ],
        },
      }),
    )
    expect(found.A).toEqual(['MKT_UK', 'MKT_CZ'])
  })

  it('ignores evidence that was set aside', () => {
    const found = coverage(
      results({
        A: {
          answer,
          evidence: [chunk('c1', 'MKT_AT', false), chunk('c2', 'MKT_GR', true)],
        },
      }),
    )
    expect(found.A).toEqual(['MKT_GR'])
  })

  it('does not count an item with no market, or a market that is not one of the four', () => {
    const found = coverage(
      results({
        A: {
          answer,
          evidence: [chunk('c1', '', true), chunk('c2', 'MKT_XX', true)],
        },
      }),
    )
    expect(found.A).toEqual([])
  })

  it('reads a used graph node from its authoritative market, and only that', () => {
    const found = coverage(
      results({
        B: {
          answer,
          document_evidence: [chunk('c1', 'MKT_AT', true)],
          node_evidence: [
            node('GAME_GR_01', true, { market_id: 'MKT_GR' }),
            node('GAME_CZ_01', true, { name: 'no market field here' }),
            node('GAME_UK_01', true, null),
            node('INC_9', false, { market_id: 'MKT_UK' }),
          ],
        },
      }),
    )
    // Ids such as GAME_CZ_01 are not parsed: only the carried fields count.
    expect(found.B).toEqual(['MKT_GR', 'MKT_AT'])
  })

  it('leaves out a pipeline with no result, so it differs from one that reached none', () => {
    const found = coverage(results({ A: { answer, evidence: [] } }))
    expect(found.A).toEqual([])
    expect(found.B).toBeUndefined()
    expect(found.C).toBeUndefined()
    expect(coverage(null)).toEqual({})
    expect(coverage({} as Results)).toEqual({})
  })

  it('never reads the question text', () => {
    const found = coverage({
      question: 'Which incidents hit Greece and Austria?',
      market_scope: ['MKT_GR', 'MKT_AT'],
      results: { A: { answer, evidence: [] } },
    } as unknown as Results)
    expect(found.A).toEqual([])
  })

  it('matches the markets of the used evidence in a recorded run', () => {
    const h1 = RECORDINGS.find((run) => run.stratum === 'H1')!
    const found = coverage(h1.results)
    // B's used passages and records name these markets; no node carries one that they do not.
    for (const id of ['A', 'B', 'C'] as const) {
      const result = h1.results.results![id]
      const used = new Set<string>()
      const chunks =
        'evidence' in result ? result.evidence : result.document_evidence
      for (const c of chunks) if (c.selected) used.add(c.market_id)
      if ('node_evidence' in result)
        for (const n of result.node_evidence)
          if (n.selected && n.authoritative?.market_id)
            used.add(n.authoritative.market_id)
      expect(found[id]).toEqual(
        MARKETS.map((m) => m.id).filter((m) => used.has(m)),
      )
    }
  })
})
