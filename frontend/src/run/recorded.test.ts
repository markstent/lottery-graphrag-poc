import { describe, expect, it } from 'vitest'

import { RECORDED_RUNS } from './recorded'
import { reduceAll } from './reduce'

describe('RECORDED_RUNS', () => {
  it('every recorded run is a real API capture with all three pipelines', () => {
    for (const run of RECORDED_RUNS) {
      expect(new Set(run.events.map((e) => e.pipeline))).toEqual(
        new Set(['run', 'A', 'B', 'C']),
      )
      expect(reduceAll(run.events).status).toBe('completed')
      expect(run.model).not.toMatch(/fake/i)
    }
  })

  it('no recorded run carries answer-key content', () => {
    for (const run of RECORDED_RUNS) {
      expect(JSON.stringify(run)).not.toMatch(
        /expected_answer|required_evidence|truth|ledger/,
      )
    }
  })

  it('each demo stratum has one recorded run', () => {
    expect(RECORDED_RUNS.map((r) => r.stratum).sort()).toEqual([
      'H1',
      'H2',
      'H3',
      'H5',
    ])
  })
})
