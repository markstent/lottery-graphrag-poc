import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '../../api/http'
import type { RunStreamHandlers } from '../../api/stream'
import cancelledFixture from '../../run/fixtures/run-cancelled.json'
import fixture from '../../run/fixtures/run-abc.json'
import { RECORDED_RUNS, type RecordedRun } from '../../run/recorded'
import { initialRunState, reduceAll, type RunEvent } from '../../run/reduce'
import { useLiveRun } from './use-live-run'

const client = vi.hoisted(() => ({
  startQuery: vi.fn(),
  cancelRun: vi.fn(),
  getRun: vi.fn(),
}))
const stream = vi.hoisted(() => ({ subscribeRun: vi.fn() }))
vi.mock('../../api/client', () => client)
vi.mock('../../api/stream', () => stream)

const h1 = RECORDED_RUNS.find((run) => run.stratum === 'H1')!
const live = fixture.events as unknown as RunEvent[]
const BODY = {
  benchmark_instance_id: 'L05-2026-INC_037',
  configurations: ['A', 'B', 'C'] satisfies ('A' | 'B' | 'C')[],
}

let handlers: RunStreamHandlers
const unsubscribe = vi.fn()

beforeEach(() => {
  vi.useFakeTimers()
  client.startQuery.mockResolvedValue({ run_id: 'RUN-T' })
  client.cancelRun.mockResolvedValue({})
  client.getRun.mockResolvedValue(h1.results)
  stream.subscribeRun.mockImplementation(
    (_id: string, next: RunStreamHandlers) => {
      handlers = next
      return unsubscribe
    },
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

/** Starts a live run and waits for the stream to be opened. */
async function startLive(result: { current: ReturnType<typeof useLiveRun> }) {
  await act(async () => {
    result.current.start({ source: 'live', body: BODY })
  })
}

describe('useLiveRun, recorded source', () => {
  it('plays a recording to its end and matches reduceAll of its events', () => {
    const { result } = renderHook(() => useLiveRun({ reducedMotion: false }))
    expect(result.current.phase).toBe('idle')
    expect(result.current.source).toBeNull()
    expect(result.current.state).toEqual(initialRunState())

    act(() => result.current.start({ source: 'recorded', recording: h1 }))
    expect(result.current.phase).toBe('running')
    expect(result.current.source).toBe('recorded')
    act(() => {
      vi.advanceTimersByTime(result.current.timeline.duration + 1000)
    })
    expect(result.current.phase).toBe('finished')
    expect(result.current.state).toEqual(reduceAll(h1.events))
  })

  it('jumps to the end state under reduced motion', () => {
    const { result } = renderHook(() => useLiveRun({ reducedMotion: true }))
    act(() => result.current.start({ source: 'recorded', recording: h1 }))
    expect(result.current.phase).toBe('finished')
    expect(result.current.state).toEqual(reduceAll(h1.events))
  })

  it('cancelled run replays as recorded', () => {
    const recording = {
      ...h1,
      run_id: cancelledFixture.run_id,
      events: cancelledFixture.events as unknown as RunEvent[],
    } satisfies RecordedRun
    const { result } = renderHook(() => useLiveRun({ reducedMotion: true }))
    act(() => result.current.start({ source: 'recorded', recording }))
    const { state } = result.current
    expect(state.status).toBe('cancelled')
    expect(state.pipelines.A.status).toBe('completed')
    expect(state.pipelines.B.status).toBe('cancelled')
    expect(state.pipelines.C.status).toBe('skipped')
    expect(state).toEqual(reduceAll(recording.events))
    expect(cancelledFixture.results.score).toBeNull()
  })

  it('rewinds to the start and plays again', () => {
    const { result } = renderHook(() => useLiveRun({ reducedMotion: false }))
    act(() => result.current.start({ source: 'recorded', recording: h1 }))
    act(() => {
      vi.advanceTimersByTime(result.current.timeline.duration + 1000)
    })
    act(() => result.current.controls.rewind())
    expect(result.current.state).toEqual(initialRunState())
    act(() => result.current.controls.play())
    act(() => {
      vi.advanceTimersByTime(result.current.timeline.duration + 1000)
    })
    expect(result.current.state).toEqual(reduceAll(h1.events))
  })
})

describe('useLiveRun, live source', () => {
  it('starts a run, follows its stream event by event and ends with it', async () => {
    const { result } = renderHook(() => useLiveRun({ reducedMotion: false }))
    await startLive(result)
    expect(client.startQuery).toHaveBeenCalledWith(BODY, expect.anything())
    expect(stream.subscribeRun).toHaveBeenCalledWith(
      'RUN-T',
      expect.anything(),
      expect.anything(),
    )
    expect(result.current.runId).toBe('RUN-T')
    expect(result.current.source).toBe('live')

    let applied = 0
    for (const count of [1, 20, 60]) {
      act(() => {
        for (const event of live.slice(applied, count)) handlers.onEvent(event)
      })
      applied = count
      expect(result.current.state).toEqual(reduceAll(live.slice(0, count)))
      expect(result.current.phase).toBe('running')
    }

    act(() => {
      for (const event of live.slice(60)) handlers.onEvent(event)
      handlers.onEnd()
    })
    expect(result.current.phase).toBe('finished')
    expect(result.current.state).toEqual(reduceAll(live))
  })

  it('can be rewound and replayed once it has finished, without a new request', async () => {
    const { result } = renderHook(() => useLiveRun({ reducedMotion: false }))
    await startLive(result)
    act(() => {
      for (const event of live) handlers.onEvent(event)
      handlers.onEnd()
    })
    expect(result.current.timeline.enabled).toBe(true)
    act(() => result.current.controls.rewind())
    expect(result.current.state).toEqual(initialRunState())
    act(() => result.current.controls.seek(result.current.timeline.duration))
    expect(result.current.state).toEqual(reduceAll(live))
    expect(client.startQuery).toHaveBeenCalledTimes(1)
  })

  it('does not offer the timeline while the run is still arriving', async () => {
    const { result } = renderHook(() => useLiveRun({ reducedMotion: false }))
    await startLive(result)
    act(() => handlers.onEvent(live[0]))
    expect(result.current.timeline.enabled).toBe(false)
  })

  it('shows the 409 message and retries the start', async () => {
    client.startQuery.mockRejectedValueOnce(
      new ApiError('CONFLICT', 'Another run is using the graph.', true, 409),
    )
    const { result } = renderHook(() => useLiveRun({ reducedMotion: false }))
    await startLive(result)
    expect(result.current.phase).toBe('idle')
    expect(result.current.error?.message).toBe(
      'Another run is using the graph.',
    )
    await act(async () => {
      result.current.error?.retry?.()
    })
    expect(client.startQuery).toHaveBeenCalledTimes(2)
    expect(result.current.error).toBeNull()
    expect(result.current.phase).toBe('running')
  })

  it('offers no retry for an error that retrying cannot fix', async () => {
    client.startQuery.mockRejectedValueOnce(
      new ApiError('VALIDATION_ERROR', 'The question is empty.', false, 422),
    )
    const { result } = renderHook(() => useLiveRun({ reducedMotion: false }))
    await startLive(result)
    expect(result.current.error).toEqual({
      message: 'The question is empty.',
      retry: null,
    })
  })

  it('cancels through the API and shows a 409 from it with its message', async () => {
    const { result } = renderHook(() => useLiveRun({ reducedMotion: false }))
    await startLive(result)
    act(() => handlers.onEvent(live[0]))
    await act(async () => result.current.cancel())
    expect(client.cancelRun).toHaveBeenCalledWith('RUN-T', expect.anything())

    client.cancelRun.mockRejectedValueOnce(
      new ApiError('CONFLICT', 'The run has already ended.', false, 409),
    )
    await act(async () => result.current.cancel())
    expect(result.current.error?.message).toBe('The run has already ended.')
  })

  it('shows a lost connection and resumes from the last event on retry', async () => {
    const { result } = renderHook(() => useLiveRun({ reducedMotion: false }))
    await startLive(result)
    act(() => {
      for (const event of live.slice(0, 5)) handlers.onEvent(event)
      handlers.onError(
        new ApiError('RUN_ERROR', 'The live connection was lost.', true, 0),
      )
    })
    expect(result.current.phase).toBe('interrupted')
    expect(result.current.error?.message).toBe('The live connection was lost.')
    act(() => result.current.error?.retry?.())
    expect(stream.subscribeRun).toHaveBeenLastCalledWith(
      'RUN-T',
      expect.anything(),
      { after: live[4].sequence },
    )
    expect(result.current.error).toBeNull()
  })

  it('closes the stream when the screen unmounts', async () => {
    const { result, unmount } = renderHook(() =>
      useLiveRun({ reducedMotion: false }),
    )
    await startLive(result)
    unmount()
    expect(unsubscribe).toHaveBeenCalled()
  })
})

describe('useLiveRun, busy and re-run', () => {
  it('is not busy for a paused or rewound recording, and is for a live run in progress', async () => {
    const { result } = renderHook(() => useLiveRun({ reducedMotion: false }))
    expect(result.current.busy).toBe(false)
    act(() => result.current.start({ source: 'recorded', recording: h1 }))
    act(() => result.current.controls.pause())
    expect(result.current.busy).toBe(false)
    act(() => result.current.controls.rewind())
    expect(result.current.busy).toBe(false)

    await startLive(result)
    expect(result.current.busy).toBe(true)
    act(() => {
      for (const event of live) handlers.onEvent(event)
      handlers.onEnd()
    })
    expect(result.current.busy).toBe(false)
  })

  it('starting the same recording again resets it and plays it from the start', () => {
    const { result } = renderHook(() => useLiveRun({ reducedMotion: false }))
    act(() => result.current.start({ source: 'recorded', recording: h1 }))
    act(() => {
      vi.advanceTimersByTime(result.current.timeline.duration + 1000)
    })
    expect(result.current.phase).toBe('finished')

    act(() => result.current.start({ source: 'recorded', recording: h1 }))
    expect(result.current.phase).toBe('running')
    expect(result.current.state).toEqual(initialRunState())
    expect(result.current.timeline.playing).toBe(true)
    act(() => {
      vi.advanceTimersByTime(result.current.timeline.duration + 1000)
    })
    expect(result.current.state).toEqual(reduceAll(h1.events))
  })

  it('starting the same recording again while paused restarts it too', () => {
    const { result } = renderHook(() => useLiveRun({ reducedMotion: false }))
    act(() => result.current.start({ source: 'recorded', recording: h1 }))
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    act(() => result.current.controls.pause())
    act(() => result.current.start({ source: 'recorded', recording: h1 }))
    expect(result.current.timeline.cursor).toBe(0)
    expect(result.current.timeline.playing).toBe(true)
  })
})

describe('useLiveRun, results', () => {
  it('has the recording results at once', () => {
    const { result } = renderHook(() => useLiveRun({ reducedMotion: true }))
    expect(result.current.results).toBeNull()
    act(() => result.current.start({ source: 'recorded', recording: h1 }))
    expect(result.current.results).toBe(h1.results)
  })

  it('fetches the results of a live run when it ends, not before', async () => {
    const { result } = renderHook(() => useLiveRun({ reducedMotion: false }))
    await startLive(result)
    act(() => handlers.onEvent(live[0]))
    expect(client.getRun).not.toHaveBeenCalled()
    await act(async () => {
      for (const event of live.slice(1)) handlers.onEvent(event)
      handlers.onEnd()
    })
    expect(client.getRun).toHaveBeenCalledWith('RUN-T', expect.anything())
    expect(result.current.results).toBe(h1.results)
  })

  it('shows why the results could not be read, with a retry', async () => {
    client.getRun.mockRejectedValueOnce(
      new ApiError('RUN_ERROR', 'The server did not answer.', true, 503),
    )
    const { result } = renderHook(() => useLiveRun({ reducedMotion: false }))
    await startLive(result)
    await act(async () => {
      for (const event of live) handlers.onEvent(event)
      handlers.onEnd()
    })
    expect(result.current.results).toBeNull()
    expect(result.current.error?.message).toBe('The server did not answer.')
    await act(async () => result.current.error?.retry?.())
    expect(result.current.results).toBe(h1.results)
    expect(result.current.error).toBeNull()
  })
})

describe('useLiveRun, races', () => {
  it('ignores the stream of an earlier run once a new one has started', async () => {
    const { result } = renderHook(() => useLiveRun({ reducedMotion: false }))
    await startLive(result)
    const first = handlers
    act(() => first.onEvent(live[0]))
    await startLive(result)
    expect(unsubscribe).toHaveBeenCalled()
    act(() => {
      first.onEvent(live[1])
      first.onEnd()
    })
    expect(result.current.state).toEqual(initialRunState())
    expect(result.current.phase).toBe('running')
  })

  it('drops a 409 from a cancel that arrives after the stream has ended', async () => {
    let reject: (error: Error) => void = () => undefined
    client.cancelRun.mockReturnValueOnce(
      new Promise((_, no) => {
        reject = no
      }),
    )
    const { result } = renderHook(() => useLiveRun({ reducedMotion: false }))
    await startLive(result)
    act(() => handlers.onEvent(live[0]))
    act(() => result.current.cancel())
    await act(async () => {
      for (const event of live.slice(1)) handlers.onEvent(event)
      handlers.onEnd()
    })
    await act(async () =>
      reject(
        new ApiError('CONFLICT', 'The run has already ended.', false, 409),
      ),
    )
    expect(result.current.error).toBeNull()
    expect(result.current.cancelling).toBe(false)
  })

  it('does not let an old cancel failure touch a newer run', async () => {
    let reject: (error: Error) => void = () => undefined
    client.cancelRun.mockReturnValueOnce(
      new Promise((_, no) => {
        reject = no
      }),
    )
    const { result } = renderHook(() => useLiveRun({ reducedMotion: false }))
    await startLive(result)
    act(() => result.current.cancel())
    await startLive(result)
    await act(async () =>
      reject(
        new ApiError('CONFLICT', 'The run has already ended.', false, 409),
      ),
    )
    expect(result.current.error).toBeNull()
    expect(result.current.cancelling).toBe(false)
  })

  it('aborts a pending cancel when the screen unmounts', async () => {
    let signal: AbortSignal | undefined
    client.cancelRun.mockImplementationOnce(
      (_id: string, given?: AbortSignal) => {
        signal = given
        return new Promise(() => undefined)
      },
    )
    const { result, unmount } = renderHook(() =>
      useLiveRun({ reducedMotion: false }),
    )
    await startLive(result)
    act(() => result.current.cancel())
    expect(signal?.aborted).toBe(false)
    unmount()
    expect(signal?.aborted).toBe(true)
  })
})
