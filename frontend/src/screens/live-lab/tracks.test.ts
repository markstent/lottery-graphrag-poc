import { describe, expect, it } from 'vitest'

import fixture from '../../run/fixtures/run-abc.json'
import { createReplay } from '../../run/replay'
import { reduceAll, type RunEvent } from '../../run/reduce'
import { trackSegments } from './tracks'

const events = fixture.events as unknown as RunEvent[]
const origin = events[0].t_ms

describe('trackSegments', () => {
  it('has three empty tracks before anything runs', () => {
    expect(trackSegments(reduceAll([]), origin, 0)).toEqual({
      A: [],
      B: [],
      C: [],
    })
  })

  it('draws each step from its recorded start to its recorded end', () => {
    const state = reduceAll(events)
    const duration = events.at(-1)!.t_ms - origin
    const tracks = trackSegments(state, origin, duration)
    for (const id of ['A', 'B', 'C'] as const) {
      expect(tracks[id].length).toBeGreaterThanOrEqual(4)
      for (const { from, to } of tracks[id]) {
        expect(from).toBeGreaterThanOrEqual(0)
        expect(to).toBeGreaterThanOrEqual(from)
        expect(to).toBeLessThanOrEqual(duration)
      }
    }
    const generation = state.pipelines.A.stages.generation!
    expect(tracks.A.at(-1)).toMatchObject({
      stage: 'generation',
      from: generation.startedMs - origin,
      to: generation.endedMs! - origin,
      status: 'completed',
    })
  })

  it('runs three tracks one after another because the pipelines ran one after another', () => {
    const state = reduceAll(events)
    const tracks = trackSegments(state, origin, events.at(-1)!.t_ms - origin)
    expect(tracks.B[0].from).toBeGreaterThanOrEqual(tracks.A.at(-1)!.to)
    expect(tracks.C[0].from).toBeGreaterThanOrEqual(tracks.B.at(-1)!.to)
  })

  it('stretches a step that is still running up to the cursor', () => {
    const replay = createReplay(events, { reducedMotion: false })
    const started = events.findIndex(
      (event) => event.event_type === 'rag.vector_search.started',
    )
    replay.seek(replay.offsets[started])
    const { state, cursor } = replay.snapshot()
    const running = trackSegments(state, origin, cursor).A.find(
      (segment) => segment.status === 'running',
    )
    expect(running?.to).toBe(cursor)
  })
})
