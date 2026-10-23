/**
 * The replay reduces each event once while the position only moves forward,
 * and starts over only when it moves back.
 */

import { describe, expect, it, vi } from 'vitest'

import fixture from './fixtures/run-abc.json'
import * as reducer from './reduce'
import { createReplay } from './replay'

const recorded = fixture.events as unknown as reducer.RunEvent[]

vi.mock('./reduce', async (importActual) => {
  const actual = await importActual<typeof import('./reduce')>()
  return { ...actual, reduce: vi.fn(actual.reduce) }
})

const reduceCalls = () => vi.mocked(reducer.reduce).mock.calls.length

describe('replay reduction', () => {
  it('reduces each event once going forward and again only after a step back', () => {
    const replay = createReplay(recorded, { reducedMotion: false })
    vi.mocked(reducer.reduce).mockClear()

    for (let i = 1; i <= 10; i += 1) replay.step(1)
    expect(reduceCalls()).toBe(10)

    replay.seek(replay.offsets[29])
    expect(replay.snapshot().count).toBeGreaterThanOrEqual(30)
    const reached = replay.snapshot().count
    expect(reduceCalls()).toBe(reached)

    replay.pause()
    replay.speed(2)
    expect(reduceCalls()).toBe(reached)

    replay.seek(replay.offsets[4])
    const back = replay.snapshot().count
    expect(back).toBeLessThan(reached)
    expect(reduceCalls()).toBe(reached + back)
    expect(replay.snapshot().state).toEqual(
      reducer.reduceAll(recorded.slice(0, back)),
    )
  })
})
