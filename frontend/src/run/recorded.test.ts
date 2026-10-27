import { describe, expect, it } from 'vitest'

import {
  checkRecording,
  loadRecording,
  RECORDED_INDEX,
  recordingNote,
  UnknownEventTypeError,
} from './recorded'
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

  it('names the world each recording was captured on, in the index and the recording', () => {
    expect(RECORDED_INDEX.map((r) => r.dataset_id)).toEqual(
      Array(4).fill('dev-seed2026'),
    )
    expect(RECORDINGS.map((r) => r.dataset_id)).toEqual(
      RECORDED_INDEX.map((r) => r.dataset_id),
    )
  })

  it('reads all four recordings, which name no method, as made under the old method', () => {
    expect(RECORDED_INDEX.map((r) => r.method)).toEqual(
      Array(4).fill(undefined),
    )
    for (const run of RECORDED_INDEX)
      expect(recordingNote(run.instance_id)).toBe(
        'recorded under the old method (v0.2)',
      )
    expect(recordingNote('L99-unknown')).toBeNull()
  })

  it('loads a recording by its question, and refuses one it does not have', async () => {
    const [first] = RECORDED_INDEX
    expect((await loadRecording(first.instance_id)).run_id).toBe(first.run_id)
    await expect(loadRecording('L99-unknown')).rejects.toThrow(
      'No recording for L99-unknown.',
    )
  })

  it('a recording with an unknown event type is refused', () => {
    const [first] = RECORDINGS
    expect(checkRecording(first)).toBe(first)
    const forged = {
      ...first,
      events: [
        ...first.events.slice(0, 2),
        { ...first.events[2], event_type: 'graph.teleported' },
      ],
    }
    expect(() => checkRecording(forged as never)).toThrow(UnknownEventTypeError)
    expect(() => checkRecording(forged as never)).toThrow(
      `Recording ${first.instance_id} has an event of unknown type "graph.teleported" at position 2.`,
    )
  })
})
