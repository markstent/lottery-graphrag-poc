import { describe, expect, it } from 'vitest'

import type { Schemas } from '../../api/client'
import { RECORDINGS } from '../../test/recordings'
import { otherWorldNotice, pathPosition, sourceFor } from './evidence-open'

type Results = Schemas['QueryResults']

const h1 = RECORDINGS.find((run) => run.stratum === 'H1')!.results
const h2 = RECORDINGS.find((run) => run.stratum === 'H2')!.results

const withResults = (pipelines: Record<string, unknown>): Results =>
  ({ results: pipelines }) as unknown as Results

const chunk = (over: Record<string, unknown>) => ({
  chunk_id: 'CHNK_1',
  document_id: 'DOC_1',
  document_type: 'runbook',
  kind: 'chunk',
  language_code: 'en',
  market_id: 'MKT_GR',
  source_system: 'wiki',
  title: 'Runbook',
  text: 'Restart the service. Then check.',
  selected: true,
  ...over,
})

describe('sourceFor', () => {
  it('opens a graph node by its node id', () => {
    expect(sourceFor(h1, 'B', 'INC_037', 'dev-seed2026')).toEqual({
      kind: 'node',
      nodeId: 'INC_037',
    })
  })

  it('opens a table record on its table and row in the given dataset', () => {
    expect(sourceFor(h1, 'A', 'REC_incidents_INC_017', 'dev-seed2026')).toEqual(
      {
        kind: 'record',
        datasetId: 'dev-seed2026',
        table: 'incidents',
        rowId: 'INC_017',
      },
    )
  })

  it('opens a passage from the passage text the results carry', () => {
    const results = withResults({ A: { evidence: [chunk({})] } })
    expect(sourceFor(results, 'A', 'CHNK_1', 'dev-seed2026')).toEqual({
      kind: 'passage',
      title: 'Runbook',
      text: 'Restart the service. Then check.',
      facts: [
        ['Document', 'DOC_1'],
        ['Kind of document', 'runbook'],
        ['Market', 'Greece'],
        ['Language', 'en'],
        ['Source system', 'wiki'],
      ],
    })
  })

  it('falls back to the passage text for a record when no dataset is known', () => {
    const source = sourceFor(h1, 'A', 'REC_incidents_INC_017', null)
    expect(source?.kind).toBe('passage')
  })

  it('finds a passage of a graph pipeline in its document evidence', () => {
    const passage = h2.results!.B
    const id = (
      passage as { document_evidence: { chunk_id: string; kind: string }[] }
    ).document_evidence.find((c) => c.kind === 'chunk')!.chunk_id
    expect(sourceFor(h2, 'B', id, 'dev-seed2026')?.kind).toBe('passage')
  })

  it('is null for an id the results do not hold, never a guess', () => {
    expect(sourceFor(h1, 'B', 'NOT_THERE', 'dev-seed2026')).toBeNull()
    expect(sourceFor(null, 'B', 'INC_037', 'dev-seed2026')).toBeNull()
  })
})

describe('pathPosition', () => {
  it('gives the first recorded path that holds the node, and the step in it', () => {
    expect(pathPosition(h1, 'B', 'SUP_00113', true)).toEqual({
      path: 2,
      step: 2,
      of: 2,
    })
    expect(pathPosition(h1, 'B', 'INC_037', true)).toEqual({
      path: 1,
      step: 1,
      of: 1,
    })
  })

  it('is null for a node on no path', () => {
    expect(pathPosition(h1, 'B', 'NOT_ON_A_PATH', true)).toBeNull()
  })

  it('is null before the path is recorded, and for pipeline A', () => {
    expect(pathPosition(h1, 'B', 'SUP_00113', false)).toBeNull()
    expect(pathPosition(h1, 'A', 'SUP_00113', true)).toBeNull()
    expect(pathPosition(null, 'B', 'SUP_00113', true)).toBeNull()
  })
})

describe('otherWorldNotice', () => {
  it('names both worlds in plain words when a recording is not on the active one', () => {
    expect(otherWorldNotice('dev-seed2026', 'dev-seed2027')).toBe(
      'This run was recorded on dev world, 2026. The active dataset is dev world, 2027, so its records cannot be opened here.',
    )
  })

  it('says nothing for a live run or the same world', () => {
    expect(otherWorldNotice(null, 'dev-seed2027')).toBeNull()
    expect(otherWorldNotice('dev-seed2026', 'dev-seed2026')).toBeNull()
  })

  it("holds a recording's record back until the active dataset is known", () => {
    expect(otherWorldNotice('dev-seed2026', null)).toBe(
      'The active dataset is still loading, so this record cannot be opened yet.',
    )
  })
})
