/**
 * The benchmark job the screen follows. On mount it looks for a job that is
 * still running (the server lists every job since it started, newest first)
 * and follows that one; it asks again every two seconds until the job ends (a
 * failed poll is tried again with a short backoff before the error shows),
 * and stops when the screen goes away.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import {
  cancelJob,
  getJob,
  listJobs,
  startBenchmark,
  type Schemas,
} from '../../api/client'
import { ApiError } from '../../api/http'

type Job = Schemas['BenchmarkJob']

export const POLL_MS = 2000
/** A failed poll is tried again this many times in all, each after a longer wait, before the error shows. */
export const POLL_TRIES = 3
export const RETRY_MS = 1000

const asError = (error: unknown) =>
  error instanceof Error ? error : new Error(String(error))

export function useBenchmarkJob(onCompleted: (runId: string) => void) {
  const [job, setJob] = useState<Job | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const completed = useRef(onCompleted)
  useEffect(() => {
    completed.current = onCompleted
  })

  useEffect(() => {
    const controller = new AbortController()
    listJobs(controller.signal).then(
      (jobs) =>
        setJob(
          (now) => now ?? jobs.find((j) => j.status === 'running') ?? null,
        ),
      (failure: unknown) => {
        if (!controller.signal.aborted) setError(asError(failure))
      },
    )
    return () => controller.abort()
  }, [])

  const jobId = job?.job_id ?? null
  const running = job?.status === 'running'
  useEffect(() => {
    if (jobId === null || !running) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    let failures = 0
    const poll = async () => {
      try {
        const next = await getJob(jobId, controller.signal)
        failures = 0
        setJob(next)
        if (next.status === 'completed' && next.run_id)
          completed.current(next.run_id)
        if (next.status === 'running') timer = setTimeout(poll, POLL_MS)
      } catch (failure) {
        if (controller.signal.aborted) return
        failures += 1
        if (failures < POLL_TRIES) timer = setTimeout(poll, RETRY_MS * failures)
        else setError(asError(failure))
      }
    }
    timer = setTimeout(poll, POLL_MS)
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [jobId, running])

  /**
   * Starts a run; a refusal (409, 422, 503) reaches the caller. A 409 because
   * a job is already running (started in another tab, say) attaches to that
   * job instead.
   */
  const start = useCallback(async (body: Schemas['BenchmarkStart']) => {
    setError(null)
    try {
      setJob(await startBenchmark(body))
    } catch (failure) {
      if (!(failure instanceof ApiError) || failure.status !== 409)
        throw failure
      const attached = (await listJobs()).find((j) => j.status === 'running')
      if (attached === undefined) throw failure
      setJob(attached)
    }
  }, [])

  /** Asks the job to stop; it stops before its next question, and polling shows when it has. */
  const cancel = useCallback(async () => {
    if (jobId !== null) await cancelJob(jobId)
  }, [jobId])

  return { job, error, start, cancel }
}
