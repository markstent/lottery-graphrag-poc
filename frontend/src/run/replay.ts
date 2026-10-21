/**
 * The replay clock: a pure position over a recorded run. No React, no real
 * timers of its own - the clock and scheduler are injected, so tests drive it
 * deterministically.
 *
 * Timeline definition. Every event's `t_ms` is read from one process-wide
 * monotonic clock, so it is comparable across the A, B and C tracks and the
 * run-level events (fixtures/run-abc.json: `t_ms` never decreases in
 * `sequence` order, and the first and last events are 18016.2 ms apart by
 * `t_ms` and 18016.17 ms apart by wall-clock `timestamp`). The timeline is
 * therefore the events in `sequence` order at offset `t_ms - first t_ms`.
 * Every gap on it, including the pauses between pipelines, is a recorded
 * difference; nothing is added or shortened. If a `t_ms` ever stepped back the
 * offset would hold at the previous one (a zero gap, never an invented one).
 *
 * The position is `count`, the number of events applied, with `cursor` as its
 * time in ms. Events that share an offset are applied together by `seek` and
 * playback, but `step` moves one event, so the cursor can stay put for a step.
 * `state(cursor)` is always `reduceAll` of the events at or before `cursor`.
 */

import { reduceAll, type RunEvent, type RunState } from './reduce'

export type Speed = 0.5 | 1 | 2 | 4

export interface Scheduler {
  setTimeout: (callback: () => void, ms: number) => unknown
  clearTimeout: (handle: unknown) => void
}

export interface ReplayOptions {
  reducedMotion: boolean
  /** Milliseconds from any monotonic clock. Defaults to `performance.now`. */
  now?: () => number
  /** Defaults to the global timers. */
  scheduler?: Scheduler
}

export interface ReplaySnapshot {
  state: RunState
  /** Events applied. */
  count: number
  /** Time of the position in ms from the first event. */
  cursor: number
  playing: boolean
  speed: Speed
}

export interface Replay {
  /** Offset of the last event in ms from the first. */
  readonly duration: number
  /** Offset of each event in ms from the first, in `sequence` order. */
  readonly offsets: readonly number[]
  snapshot: () => ReplaySnapshot
  subscribe: (listener: () => void) => () => void
  state: (cursor: number) => RunState
  play: () => void
  pause: () => void
  step: (direction: 1 | -1) => void
  seek: (ms: number) => void
  speed: (speed: Speed) => void
  reset: () => void
}

const globalScheduler: Scheduler = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) =>
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export function createReplay(
  recorded: RunEvent[],
  {
    reducedMotion,
    now = () => performance.now(),
    scheduler = globalScheduler,
  }: ReplayOptions,
): Replay {
  const events = [...recorded].sort((a, b) => a.sequence - b.sequence)
  const origin = events[0]?.t_ms ?? 0
  const offsets = events.reduce<number[]>((acc, event) => {
    acc.push(Math.max(acc.at(-1) ?? 0, event.t_ms - origin))
    return acc
  }, [])
  const duration = offsets.at(-1) ?? 0

  /** Events at or before `ms`. */
  const countAt = (ms: number): number => {
    let count = 0
    while (count < offsets.length && offsets[count] <= ms) count += 1
    return count
  }
  const cursorOf = (count: number): number =>
    count === 0 ? 0 : offsets[count - 1]

  let count = 0
  let cursor = 0
  let playing = false
  let speedFactor: Speed = 1
  let timer: unknown = null
  let anchorNow = 0
  let anchorCursor = 0
  const listeners = new Set<() => void>()

  const build = (): ReplaySnapshot => ({
    state: reduceAll(events.slice(0, count)),
    count,
    cursor,
    playing,
    speed: speedFactor,
  })
  let current = build()
  const publish = () => {
    current = build()
    listeners.forEach((listener) => listener())
  }

  const cancel = () => {
    if (timer !== null) scheduler.clearTimeout(timer)
    timer = null
  }

  /** Where playback has reached by the clock, between applied events. */
  const position = (): number =>
    playing
      ? Math.min(duration, anchorCursor + (now() - anchorNow) * speedFactor)
      : cursor

  /** Waits for the next event, then re-anchors to the real elapsed time. */
  const arm = () => {
    cancel()
    if (count >= events.length) {
      playing = false
      return
    }
    anchorNow = now()
    anchorCursor = cursor
    const wait = (offsets[count] - cursor) / speedFactor
    timer = scheduler.setTimeout(
      () => {
        timer = null
        cursor = Math.min(duration, Math.max(position(), offsets[count]))
        count = countAt(cursor)
        arm()
        publish()
      },
      Math.max(0, wait),
    )
  }

  const moveTo = (nextCount: number, nextCursor: number) => {
    count = nextCount
    cursor = nextCursor
    if (playing) arm()
    publish()
  }

  return {
    duration,
    offsets,
    snapshot: () => current,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    state: (ms) => reduceAll(events.slice(0, countAt(ms))),
    play: () => {
      if (events.length === 0) return
      if (reducedMotion) {
        cancel()
        playing = false
        moveTo(events.length, duration)
        return
      }
      if (count >= events.length) {
        count = 0
        cursor = 0
      }
      playing = true
      arm()
      publish()
    },
    pause: () => {
      cancel()
      if (!playing) return
      cursor = position()
      playing = false
      publish()
    },
    step: (direction) => {
      cancel()
      playing = false
      const next = Math.min(events.length, Math.max(0, count + direction))
      moveTo(next, cursorOf(next))
    },
    seek: (ms) => {
      const target = Math.min(duration, Math.max(0, ms))
      moveTo(countAt(target), target)
    },
    speed: (next) => {
      cursor = position()
      speedFactor = next
      if (playing) arm()
      publish()
    },
    reset: () => {
      cancel()
      playing = false
      moveTo(0, 0)
    },
  }
}
