/**
 * The live run stream: `GET /api/v1/queries/{id}/events/stream` over
 * EventSource. Frames are `id: <sequence>`, `event: <type>`, `data: <envelope>`
 * and the stream closes after the run's terminal event.
 *
 * EventSource only resumes by itself (with `Last-Event-ID`) while it is
 * retrying a dropped connection. A connection the browser gives up on (an HTTP
 * error) is closed, so the subscription opens a new one with `?after=<last
 * sequence>`. Events at or below the last sequence are not delivered twice.
 *
 * A frame whose sequence skips ahead means events were not delivered to a
 * listener (a type this contract does not know, or a lost frame). The missing
 * range is read from the replay route and handed on in order before the frame,
 * so nothing is dropped silently.
 *
 * A named SSE event reaches a listener only if one is registered for its name,
 * so the listeners come from the contract's event types, and a type the
 * contract does not know is not delivered here.
 */

import { getRunEvents } from './client'
import { ApiError } from './http'
import { EVENT_TYPES } from './event-types'
import type { components } from './schema'

export type RunEvent = components['schemas']['RecordedEvent']

export const MAX_RECONNECTS = 5
export const RECONNECT_DELAY_MS = 1_000
export const CONNECTION_LOST_MESSAGE = 'The live connection was lost.'
export const INTERNAL_MESSAGE = 'The run view stopped after an internal error.'
export const UNREADABLE_MESSAGE =
  'The live connection sent an event that could not be read.'

/** `EventSource.readyState` of a connection that will not retry. */
const CLOSED = 2

const TERMINAL: readonly string[] = [
  'run.completed',
  'run.failed',
  'run.cancelled',
]

/** The part of EventSource the subscription uses; tests pass a fake. */
export interface EventSourceLike {
  readonly readyState: number
  addEventListener(
    type: string,
    listener: (event: MessageEvent<string>) => void,
  ): void
  close(): void
}

export interface RunStreamHandlers {
  onEvent(event: RunEvent): void
  /** The run reached its terminal event; no more events follow. */
  onEnd(): void
  onError(error: ApiError): void
}

export interface RunStreamOptions {
  /** Resume after this sequence (default: from the first event). */
  after?: number
  eventSource?: new (url: string) => EventSourceLike
  /** Reads a run's stored events to fill a gap (default: the replay route). */
  loadEvents?: (runId: string) => Promise<{ events: RunEvent[] }>
}

const streamUrl = (runId: string, after: number) =>
  `/api/v1/queries/${encodeURIComponent(runId)}/events/stream` +
  (after > 0 ? `?after=${after}` : '')

/** Subscribes to a run's events; the returned function closes the subscription. */
export function subscribeRun(
  runId: string,
  handlers: RunStreamHandlers,
  {
    after = 0,
    eventSource = EventSource,
    loadEvents = (id) => getRunEvents(id),
  }: RunStreamOptions = {},
): () => void {
  let last = after
  let failures = 0
  let stopped = false
  let source: EventSourceLike | undefined
  let retry: ReturnType<typeof setTimeout> | undefined

  const stop = () => {
    stopped = true
    clearTimeout(retry)
    source?.close()
  }

  let reported = false
  const fail = (error: ApiError) => {
    stop()
    if (reported) return
    reported = true
    handlers.onError(error)
  }
  const internalFailure = () =>
    fail(new ApiError('RUN_ERROR', INTERNAL_MESSAGE, false, 0))

  /**
   * Hand one event on; a replay at or below the last sequence is ignored. A
   * handler that throws ends the subscription with one internal error: it is
   * not a connection failure, and a throw must never escape into the queue.
   */
  const deliver = (event: RunEvent) => {
    if (stopped || event.sequence <= last) return
    last = event.sequence
    try {
      handlers.onEvent(event)
      if (TERMINAL.includes(event.event_type)) {
        stop()
        handlers.onEnd()
      }
    } catch {
      internalFailure()
    }
  }

  /** Frames that wait behind a gap read run in arrival order after it. */
  let queued = 0
  let tail: Promise<void> = Promise.resolve()

  const fillGapThen = async (event: RunEvent) => {
    if (stopped) return
    if (event.sequence > last + 1) {
      let stored: { events: RunEvent[] }
      try {
        stored = await loadEvents(runId)
      } catch (error) {
        fail(
          error instanceof ApiError
            ? error
            : new ApiError('RUN_ERROR', CONNECTION_LOST_MESSAGE, true, 0),
        )
        return
      }
      for (const missing of stored.events) {
        if (missing.sequence < event.sequence) deliver(missing)
      }
    }
    deliver(event)
  }

  const onFrame = (message: MessageEvent<string>) => {
    let event: RunEvent
    try {
      event = JSON.parse(message.data) as RunEvent
    } catch {
      fail(new ApiError('RUN_ERROR', UNREADABLE_MESSAGE, false, 0))
      return
    }
    // The failure count resets only here, when a frame arrives. An `open`
    // alone proves nothing: a server that accepts the connection and closes it
    // at once (a run whose final write failed) would otherwise reset the count
    // on every cycle and the subscription would reconnect for ever. Only
    // delivered data shows that the connection works.
    failures = 0
    if (queued === 0 && event.sequence <= last + 1) {
      deliver(event)
      return
    }
    queued += 1
    tail = tail
      .then(() => fillGapThen(event))
      .catch(internalFailure) // never leave the chain rejected
      .finally(() => (queued -= 1))
  }

  const onError = () => {
    if (stopped) return
    failures += 1
    if (failures > MAX_RECONNECTS) {
      fail(new ApiError('RUN_ERROR', CONNECTION_LOST_MESSAGE, true, 0))
      return
    }
    // While readyState is CONNECTING the browser retries and resumes itself.
    if (source?.readyState === CLOSED) {
      source.close()
      retry = setTimeout(open, RECONNECT_DELAY_MS)
    }
  }

  function open() {
    if (stopped) return
    const opened = new eventSource(streamUrl(runId, last))
    source = opened
    for (const type of Object.keys(EVENT_TYPES)) {
      opened.addEventListener(type, onFrame)
    }
    opened.addEventListener('error', onError)
  }

  open()
  return stop
}
