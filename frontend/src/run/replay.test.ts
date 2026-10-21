/**
 * The replay clock over the recorded A, B, C run, with a hand-driven clock
 * and scheduler so no real timer is involved.
 */

import { describe, expect, it } from 'vitest'

import fixture from './fixtures/run-abc.json'
import { reduceAll, type RunEvent } from './reduce'
import { createReplay, type Scheduler } from './replay'

const recorded = fixture.events as unknown as RunEvent[]

function fakeTime() {
  let time = 0
  let next = 0
  const timers = new Map<number, { at: number; run: () => void }>()
  const scheduler: Scheduler = {
    setTimeout: (run, ms) => {
      next += 1
      timers.set(next, { at: time + ms, run })
      return next
    },
    clearTimeout: (handle) => {
      timers.delete(handle as number)
    },
  }
  const advance = (ms: number) => {
    const end = time + ms
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= end)
        .sort(([, a], [, b]) => a.at - b.at)[0]
      if (!due) break
      timers.delete(due[0])
      time = Math.max(time, due[1].at)
      due[1].run()
    }
    time = end
  }
  return { now: () => time, scheduler, advance, pending: () => timers.size }
}

const make = (reducedMotion = false, events = recorded) => {
  const time = fakeTime()
  const replay = createReplay(events, { reducedMotion, ...time })
  return { replay, ...time }
}

const upTo = (ms: number): RunEvent[] => {
  const origin = recorded[0].t_ms
  return recorded.filter((event) => event.t_ms - origin <= ms)
}

describe('timeline', () => {
  it('lays the fixture out at its recorded t_ms offsets, gaps included', () => {
    const { replay } = make()
    const origin = recorded[0].t_ms
    expect(replay.offsets).toHaveLength(recorded.length)
    expect(replay.offsets[0]).toBe(0)
    recorded.forEach((event, i) => {
      expect(replay.offsets[i]).toBeCloseTo(event.t_ms - origin, 6)
    })
    expect(replay.duration).toBeCloseTo(17191.6, 1)
  })

  it('orders events by sequence whatever order they arrive in', () => {
    const { replay } = make(false, [...recorded].reverse())
    expect(replay.state(replay.duration)).toEqual(reduceAll(recorded))
  })
})

describe('state(cursor)', () => {
  it('equals reduceAll of the events up to the cursor at every event boundary', () => {
    const { replay } = make()
    const origin = recorded[0].t_ms
    recorded.forEach((event, i) => {
      const cursor = event.t_ms - origin
      const expected = reduceAll(upTo(cursor))
      expect(replay.state(cursor), `event ${i + 1}`).toEqual(expected)
      // Just before an event the state excludes it (unless it shares a time).
      if (i > 0 && recorded[i - 1].t_ms < event.t_ms) {
        expect(replay.state(cursor - 1e-6), `before event ${i + 1}`).toEqual(
          reduceAll(upTo(cursor - 1e-6)),
        )
      }
    })
  })

  it('is empty before the first event is applied and complete at the end', () => {
    const { replay } = make()
    expect(replay.snapshot().state).toEqual(reduceAll([]))
    replay.seek(Number.MAX_SAFE_INTEGER)
    expect(replay.snapshot().state).toEqual(reduceAll(recorded))
    expect(replay.snapshot().cursor).toBe(replay.duration)
  })
})

describe('step and seek', () => {
  it('step moves one event and matches reduceAll of that prefix, forward and back', () => {
    const { replay } = make()
    for (let i = 1; i <= 40; i += 1) {
      replay.step(1)
      expect(replay.snapshot().count).toBe(i)
      expect(replay.snapshot().state).toEqual(reduceAll(recorded.slice(0, i)))
    }
    replay.step(-1)
    expect(replay.snapshot().state).toEqual(reduceAll(recorded.slice(0, 39)))
    expect(replay.snapshot().cursor).toBeCloseTo(
      recorded[38].t_ms - recorded[0].t_ms,
      6,
    )
  })

  it('steps one event even when two share a recorded time', () => {
    const origin = recorded[0].t_ms
    const tied = recorded.findIndex(
      (event, i) => i > 0 && event.t_ms === recorded[i - 1].t_ms,
    )
    expect(tied).toBeGreaterThan(0)
    const { replay } = make()
    replay.seek(recorded[tied - 1].t_ms - origin - 1e-6)
    replay.step(1)
    replay.step(1)
    expect(replay.snapshot().count).toBe(tied + 1)
    expect(replay.snapshot().state).toEqual(
      reduceAll(recorded.slice(0, tied + 1)),
    )
  })

  it('does not step past either end', () => {
    const { replay } = make()
    replay.step(-1)
    expect(replay.snapshot().count).toBe(0)
    replay.seek(replay.duration)
    replay.step(1)
    expect(replay.snapshot().count).toBe(recorded.length)
  })

  it('seek lands on the prefix at that time and clamps out-of-range times', () => {
    const { replay } = make()
    replay.seek(6000)
    expect(replay.snapshot().state).toEqual(reduceAll(upTo(6000)))
    expect(replay.snapshot().cursor).toBe(6000)
    replay.seek(-5)
    expect(replay.snapshot().state).toEqual(reduceAll(upTo(0)))
    expect(replay.snapshot().cursor).toBe(0)
  })
})

describe('playback', () => {
  it('applies events as their recorded gaps elapse and no sooner', () => {
    const { replay, advance } = make()
    replay.play()
    expect(replay.snapshot().playing).toBe(true)
    advance(1000)
    expect(replay.snapshot().state).toEqual(reduceAll(upTo(1000)))
    advance(5000)
    expect(replay.snapshot().state).toEqual(reduceAll(upTo(6000)))
    expect(replay.snapshot().cursor).toBeLessThanOrEqual(6000)
  })

  it('speed scales elapsed time', () => {
    const slow = make()
    slow.replay.speed(0.5)
    slow.replay.play()
    slow.advance(4000)
    expect(slow.replay.snapshot().state).toEqual(reduceAll(upTo(2000)))

    const fast = make()
    fast.replay.speed(4)
    fast.replay.play()
    fast.advance(1500)
    expect(fast.replay.snapshot().state).toEqual(reduceAll(upTo(6000)))
  })

  it('accepts only the four speeds', () => {
    const { replay } = make()
    // @ts-expect-error 3 is not one of 0.5, 1, 2 or 4
    replay.speed(3)
  })

  it('a speed change mid-play applies from that moment', () => {
    const { replay, advance } = make()
    replay.play()
    advance(1000)
    replay.speed(2)
    advance(1000)
    expect(replay.snapshot().state).toEqual(reduceAll(upTo(3000)))
  })

  it('finishes at the end state and stops playing', () => {
    const { replay, advance, pending } = make()
    replay.play()
    advance(replay.duration + 1)
    expect(replay.snapshot().state).toEqual(reduceAll(recorded))
    expect(replay.snapshot().playing).toBe(false)
    expect(pending()).toBe(0)
  })

  it('play at the end starts again from the beginning', () => {
    const { replay, advance } = make()
    replay.seek(replay.duration)
    replay.play()
    expect(replay.snapshot().count).toBe(0)
    advance(1000)
    expect(replay.snapshot().state).toEqual(reduceAll(upTo(1000)))
  })

  it('play while already playing keeps the clock where it is', () => {
    const { replay, advance } = make()
    replay.play()
    advance(8000) // inside the recorded pause after the event at 5154
    replay.play()
    expect(replay.snapshot().playing).toBe(true)
    advance(3000)
    expect(replay.snapshot().state).toEqual(reduceAll(upTo(11000)))
  })

  it('pause stops the clock and leaves no timer', () => {
    const { replay, advance, pending } = make()
    replay.play()
    advance(1000)
    replay.pause()
    const paused = replay.snapshot()
    advance(10000)
    expect(replay.snapshot()).toBe(paused)
    expect(paused.playing).toBe(false)
    expect(pending()).toBe(0)
  })

  it('step and seek while playing pause or re-anchor as expected', () => {
    const { replay, advance } = make()
    replay.play()
    advance(500)
    replay.step(1)
    expect(replay.snapshot().playing).toBe(false)
    replay.play()
    replay.seek(6000)
    advance(1000)
    expect(replay.snapshot().state).toEqual(reduceAll(upTo(7000)))
  })

  it('reset returns to the start and stops', () => {
    const { replay, advance, pending } = make()
    replay.play()
    advance(3000)
    replay.reset()
    expect(replay.snapshot().state).toEqual(reduceAll([]))
    expect(replay.snapshot().count).toBe(0)
    expect(replay.snapshot().cursor).toBe(0)
    expect(replay.snapshot().playing).toBe(false)
    expect(pending()).toBe(0)
  })

  it('notifies subscribers on every change until they unsubscribe', () => {
    const { replay } = make()
    let calls = 0
    const unsubscribe = replay.subscribe(() => {
      calls += 1
    })
    replay.step(1)
    replay.step(1)
    expect(calls).toBe(2)
    unsubscribe()
    replay.step(1)
    expect(calls).toBe(2)
  })

  it('an empty run stays at the start', () => {
    const { replay } = make(false, [])
    replay.play()
    expect(replay.snapshot().playing).toBe(false)
    expect(replay.duration).toBe(0)
  })
})

describe('reduced motion', () => {
  it('play jumps straight to the end state with nothing scheduled', () => {
    const { replay, pending } = make(true)
    replay.play()
    expect(replay.snapshot().state).toEqual(reduceAll(recorded))
    expect(replay.snapshot().playing).toBe(false)
    expect(pending()).toBe(0)
  })

  it('step still moves one event', () => {
    const { replay } = make(true)
    replay.step(1)
    replay.step(1)
    expect(replay.snapshot().count).toBe(2)
    expect(replay.snapshot().state).toEqual(reduceAll(recorded.slice(0, 2)))
  })
})
