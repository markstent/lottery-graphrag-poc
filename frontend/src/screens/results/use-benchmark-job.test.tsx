import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Schemas } from '../../api/client'
import { json, stubApi } from '../../test/api-stub'
import { useBenchmarkJob } from './use-benchmark-job'

type Job = Schemas['BenchmarkJob']

const PROGRESS = {
  world_seed: 2026,
  worlds_done: 0,
  worlds_total: 3,
  instances_done: 4,
  instances_total: 40,
}
const running = (job_id = 'J2'): Job => ({
  job_id,
  status: 'running',
  run_id: null,
  error: null,
  progress: PROGRESS,
})
const finished = (job_id: string): Job => ({
  job_id,
  status: 'completed',
  run_id: 'RUN-NEW',
  error: null,
  progress: null,
})

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const settle = () => act(async () => {})
const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))

describe('useBenchmarkJob', () => {
  it('reattaches to a running job after reload', async () => {
    const fetchMock = stubApi({
      '/api/v1/benchmarks/jobs': [finished('J3'), running('J2')],
    })
    const { result } = renderHook(() => useBenchmarkJob(() => {}))
    await settle()
    expect(result.current.job?.job_id).toBe('J2')
    expect(result.current.job?.progress?.instances_done).toBe(4)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('attaches to nothing when no job is running', async () => {
    stubApi({ '/api/v1/benchmarks/jobs': [finished('J3')] })
    const { result } = renderHook(() => useBenchmarkJob(() => {}))
    await settle()
    expect(result.current.job).toBeNull()
  })

  it('polls every two seconds and reports the completed run once', async () => {
    let answer: Job = running()
    const fetchMock = stubApi({
      '/api/v1/benchmarks/jobs': [running()],
      '/api/v1/benchmarks/jobs/J2': () => json(answer),
    })
    const done = vi.fn()
    const { result } = renderHook(() => useBenchmarkJob(done))
    await settle()
    await tick(1999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await tick(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(done).not.toHaveBeenCalled()
    answer = finished('J2')
    await tick(2000)
    expect(result.current.job?.status).toBe('completed')
    expect(done).toHaveBeenCalledExactlyOnceWith('RUN-NEW')
    await tick(10_000)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('stops polling when the screen goes away', async () => {
    const fetchMock = stubApi({
      '/api/v1/benchmarks/jobs': [running()],
      '/api/v1/benchmarks/jobs/J2': () => json(running()),
    })
    const { unmount } = renderHook(() => useBenchmarkJob(() => {}))
    await settle()
    unmount()
    await tick(10_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('starts a run and follows it', async () => {
    const fetchMock = stubApi({
      '/api/v1/benchmarks/jobs': [],
      '/api/v1/benchmarks': () => json(running('J9'), 202),
      '/api/v1/benchmarks/jobs/J9': () => json(running('J9')),
    })
    const { result } = renderHook(() => useBenchmarkJob(() => {}))
    await settle()
    await act(() =>
      result.current.start({
        kind: 'smoke',
        seeds: [2026],
        repeats: 1,
        strata: null,
        limit: null,
      }),
    )
    expect(result.current.job?.job_id).toBe('J9')
    const [, init] = fetchMock.mock.calls.find(
      ([url]) => String(url) === '/api/v1/benchmarks',
    ) as [string, RequestInit]
    expect(init.method).toBe('POST')
    await tick(2000)
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).endsWith('/jobs/J9')),
    ).toBe(true)
  })

  it('lets a refused start reach the caller and keeps no job', async () => {
    stubApi({
      '/api/v1/benchmarks/jobs': [],
      '/api/v1/benchmarks': () =>
        json(
          {
            error: {
              error_code: 'CONFLICT',
              message: 'A live run is using the graph.',
              retryable: false,
            },
          },
          409,
        ),
    })
    const { result } = renderHook(() => useBenchmarkJob(() => {}))
    await settle()
    await expect(
      result.current.start({
        kind: 'smoke',
        seeds: [2026],
        repeats: 1,
        strata: null,
        limit: null,
      }),
    ).rejects.toThrow('A live run is using the graph.')
    expect(result.current.job).toBeNull()
  })

  it('cancels the job and keeps following it until it ends', async () => {
    let answer: Job = running()
    const fetchMock = stubApi({
      '/api/v1/benchmarks/jobs': [running()],
      '/api/v1/benchmarks/jobs/J2/cancel': () => json(running(), 202),
      '/api/v1/benchmarks/jobs/J2': () => json(answer),
    })
    const { result } = renderHook(() => useBenchmarkJob(() => {}))
    await settle()
    await act(() => result.current.cancel())
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).endsWith('/cancel')),
    ).toBe(true)
    answer = { ...running(), status: 'cancelled' }
    await tick(2000)
    expect(result.current.job?.status).toBe('cancelled')
  })

  it('retries a failed poll with a short backoff and carries on', async () => {
    let failures = 2
    const fetchMock = stubApi({
      '/api/v1/benchmarks/jobs': [running()],
      '/api/v1/benchmarks/jobs/J2': () =>
        failures-- > 0 ? json({}, 503) : json(running()),
    })
    const { result } = renderHook(() => useBenchmarkJob(() => {}))
    await settle()
    await tick(2000)
    await tick(1000)
    await tick(2000)
    expect(result.current.error).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(4)
    await tick(2000)
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })

  it('reports a job that cannot be read after three tries and stops', async () => {
    const fetchMock = stubApi({
      '/api/v1/benchmarks/jobs': [running()],
    })
    const { result } = renderHook(() => useBenchmarkJob(() => {}))
    await settle()
    await tick(2000)
    await tick(1000)
    expect(result.current.error).toBeNull()
    await tick(2000)
    expect(result.current.error).toBeInstanceOf(Error)
    await tick(10_000)
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })
})
