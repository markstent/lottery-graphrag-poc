import { describe, expect, it } from 'vitest'

import { loadRecording, RECORDED_INDEX } from './recorded'
import { reduceAll } from './reduce'
import { RECORDINGS } from '../test/recordings'

describe('recorded runs', () => {
  it('every recorded run is an API capture with all three pipelines', () => {
    for (const run of RECORDINGS) {
      expect(new Set(run.events.map((e) => e.pipeline))).toEqual(
        new Set(['run', 'A', 'B', 'C']),
      )
      expect(reduceAll(run.events).status).toBe('completed')
      expect(run.model).not.toMatch(/fake/i)
    }
  })

  it('no recorded run carries answer-key content', () => {
    for (const run of RECORDINGS) {
      expect(JSON.stringify(run)).not.toMatch(
        /expected_answer|required_evidence|truth|ledger/,
      )
    }
  })

  it('each demo stratum has one recorded run', () => {
    expect(RECORDED_INDEX.map((r) => r.stratum).sort()).toEqual([
      'H1',
      'H2',
      'H3',
      'H5',
    ])
  })

  it('has an index that matches the details in every recording', () => {
    const details = (run: object) =>
      Object.fromEntries(
        Object.entries(run).filter(
          ([key]) => !['results', 'events'].includes(key),
        ),
      )
    expect(RECORDINGS.map(details)).toEqual([...RECORDED_INDEX])
  })

  it('loads a recording by its question, and refuses one it does not have', async () => {
    const [first] = RECORDED_INDEX
    expect((await loadRecording(first.instance_id)).run_id).toBe(first.run_id)
    await expect(loadRecording('L99-unknown')).rejects.toThrow(
      'No recording for L99-unknown.',
    )
  })
})
