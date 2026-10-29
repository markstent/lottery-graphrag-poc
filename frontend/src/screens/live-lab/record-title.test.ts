import { describe, expect, it } from 'vitest'

import { RECORDINGS } from '../../test/recordings'
import { recordTitle } from './record-title'

const h1 = RECORDINGS.find((run) => run.stratum === 'H1')!

describe('recordTitle', () => {
  it('is null while the run has no results', () => {
    expect(recordTitle(null, 'A', 'REC_incidents_INC_037')).toBeNull()
  })

  it('uses the first clause of the passage text, as recorded', () => {
    expect(recordTitle(h1.results, 'A', 'REC_incidents_INC_037')).toBe(
      'Incident INC_037 in United Kingdom: Identity service latency causing timeouts',
    )
    expect(recordTitle(h1.results, 'C', 'REC_support_cases_SUP_01211')).toMatch(
      /^Support case SUP_01211 in Austria/,
    )
  })

  it('uses a graph node record summary, and nothing for a node without one', () => {
    expect(recordTitle(h1.results, 'C', 'INC_024')).toBe(
      'Identity service latency causing timeouts',
    )
    // The starting record is set aside as the question's own, so it carries no summary.
    expect(recordTitle(h1.results, 'C', 'INC_037')).toBeNull()
    expect(recordTitle(h1.results, 'C', 'CONCEPT_INCIDENT')).toBeNull()
  })

  it('does not invent a title for an id it has no record of', () => {
    expect(recordTitle(h1.results, 'A', 'NOT_A_RECORD')).toBeNull()
    expect(recordTitle(h1.results, 'B', 'NOT_A_RECORD')).toBeNull()
  })

  it('falls back to the recorded title when a passage has no text', () => {
    const results = structuredClone(h1.results)
    const chunk = results.results!.A as { evidence: { text: string }[] }
    chunk.evidence[0].text = ''
    const id = (results.results!.A as { evidence: { chunk_id: string }[] })
      .evidence[0].chunk_id
    expect(recordTitle(results, 'A', id)).toMatch(/^[a-z_]+: /)
  })
})
