/**
 * subscribeRun over a fake EventSource passed in as a parameter: frames,
 * resume after a lost connection, the terminal close, duplicate replay and
 * the give-up after five failed reconnects.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from './http'
import {
  CONNECTION_LOST_MESSAGE,
  MAX_RECONNECTS,
  RECONNECT_DELAY_MS,
  subscribeRun,
  type EventSourceLike,
} from './stream'

class FakeEventSource implements EventSourceLike {
  static instances: FakeEventSource[] = []
  readyState = 0
  closed = false
  private listeners = new Map<
    string,
    ((event: MessageEvent<string>) => void)[]
  >()

  readonly url: string

  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }

  addEventListener(
    type: string,
    listener: (event: MessageEvent<string>) => void,
  ) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  close() {
    this.closed = true
    this.readyState = 2
  }

  frame(sequence: number, type: string, payload: object = {}) {
    const data = JSON.stringify({ sequence, event_type: type, payload })
    this.dispatch(type, new MessageEvent(type, { data }))
  }

  raw(type: string, data: string) {
    this.dispatch(type, new MessageEvent(type, { data }))
  }

  /** The browser's own retry: the connection drops but the source stays open. */
  drop() {
    this.dispatch('error', new MessageEvent('error'))
  }

  /** A failed connection the browser gives up on (HTTP error): the source is closed. */
  fail() {
    this.readyState = 2
    this.dispatch('error', new MessageEvent('error'))
  }

  private dispatch(type: string, event: MessageEvent<string>) {
    this.listeners.get(type)?.forEach((listener) => listener(event))
  }
}

const latest = () => FakeEventSource.instances.at(-1) as FakeEventSource

function subscribe(after?: number) {
  const seen: number[] = []
  const handlers = {
    onEvent: vi.fn((event: { sequence: number }) => seen.push(event.sequence)),
    onEnd: vi.fn(),
    onError: vi.fn(),
  }
  const stop = subscribeRun('RUN-1', handlers as never, {
    after,
    eventSource: FakeEventSource,
  })
  return { handlers, seen, stop }
}

beforeEach(() => {
  FakeEventSource.instances = []
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('subscribeRun', () => {
  it('opens the run stream and passes each frame on as an event', () => {
    const { handlers, seen } = subscribe()
    expect(latest().url).toBe('/api/v1/queries/RUN-1/events/stream')
    latest().frame(1, 'run.started')
    latest().frame(2, 'pipeline.started')
    expect(seen).toEqual([1, 2])
    expect(handlers.onEnd).not.toHaveBeenCalled()
  })

  it('starts after a given sequence', () => {
    subscribe(9)
    expect(latest().url).toBe('/api/v1/queries/RUN-1/events/stream?after=9')
  })

  it('resumes with after= the last sequence and closes on run.completed', () => {
    const { handlers, seen } = subscribe()
    latest().frame(1, 'run.started')
    latest().frame(2, 'pipeline.started')
    const first = latest()
    first.fail()
    expect(first.closed).toBe(true)
    vi.advanceTimersByTime(RECONNECT_DELAY_MS)
    expect(FakeEventSource.instances).toHaveLength(2)
    expect(latest().url).toBe('/api/v1/queries/RUN-1/events/stream?after=2')

    latest().frame(2, 'pipeline.started') // a replayed overlap is not delivered twice
    latest().frame(3, 'run.completed')
    expect(seen).toEqual([1, 2, 3])
    expect(handlers.onEnd).toHaveBeenCalledTimes(1)
    expect(latest().closed).toBe(true)
    expect(handlers.onError).not.toHaveBeenCalled()
  })

  it('leaves a retry the browser makes itself alone', () => {
    const { handlers } = subscribe()
    latest().frame(1, 'run.started')
    latest().drop()
    vi.advanceTimersByTime(RECONNECT_DELAY_MS * 2)
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(latest().closed).toBe(false)
    expect(handlers.onError).not.toHaveBeenCalled()
  })

  it.each(['run.failed', 'run.cancelled'])('closes on %s', (type) => {
    const { handlers } = subscribe()
    latest().frame(1, type)
    expect(handlers.onEnd).toHaveBeenCalledTimes(1)
    expect(latest().closed).toBe(true)
  })

  it('gives up after five failed reconnects with an ApiError', () => {
    const { handlers } = subscribe()
    latest().frame(1, 'run.started')
    latest().fail() // the connection is lost
    for (let attempt = 1; attempt <= MAX_RECONNECTS; attempt++) {
      vi.advanceTimersByTime(RECONNECT_DELAY_MS)
      expect(FakeEventSource.instances).toHaveLength(attempt + 1)
      expect(handlers.onError).not.toHaveBeenCalled()
      latest().fail() // the reconnect fails
    }
    vi.advanceTimersByTime(RECONNECT_DELAY_MS * 10)
    expect(FakeEventSource.instances).toHaveLength(MAX_RECONNECTS + 1)
    expect(handlers.onError).toHaveBeenCalledTimes(1)
    const error = handlers.onError.mock.calls[0][0] as ApiError
    expect(error).toBeInstanceOf(ApiError)
    expect(error.code).toBe('RUN_ERROR')
    expect(error.message).toBe(CONNECTION_LOST_MESSAGE)
    expect(CONNECTION_LOST_MESSAGE).toBe('The live connection was lost.')
    expect(handlers.onEnd).not.toHaveBeenCalled()
  })

  it('counts only consecutive failures: a delivered event resets the count', () => {
    const { handlers } = subscribe()
    for (let round = 0; round < 3; round++) {
      latest().frame(round + 1, 'pipeline.started')
      for (let failure = 0; failure < MAX_RECONNECTS; failure++) {
        latest().fail()
        vi.advanceTimersByTime(RECONNECT_DELAY_MS)
      }
    }
    expect(handlers.onError).not.toHaveBeenCalled()
  })

  it('stops for good when the caller closes it', () => {
    const { handlers, seen, stop } = subscribe()
    latest().frame(1, 'run.started')
    latest().fail()
    stop()
    vi.advanceTimersByTime(RECONNECT_DELAY_MS * 10)
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(latest().closed).toBe(true)
    expect(seen).toEqual([1])
    expect(handlers.onError).not.toHaveBeenCalled()
  })

  it('reports a frame it cannot read instead of dropping it', () => {
    const { handlers } = subscribe()
    latest().raw('run.started', '{not json')
    expect(latest().closed).toBe(true)
    const error = handlers.onError.mock.calls[0][0] as ApiError
    expect(error).toBeInstanceOf(ApiError)
    expect(error.retryable).toBe(false)
    expect(handlers.onEvent).not.toHaveBeenCalled()
  })
})
