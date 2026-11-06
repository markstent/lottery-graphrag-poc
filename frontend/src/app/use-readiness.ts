/**
 * Model status for the header. Polls readiness every 15 s while something
 * is not ready and every 60 s once all is, pauses while the tab is hidden,
 * and aborts its request when it unmounts. On the public read-only site
 * (D-117) the status is `public` whatever the checks say: no model runs there.
 */

import { useEffect, useState } from 'react'

import { getReadiness, type Schemas } from '../api/client'

export type Readiness = Schemas['Readiness']
export type ModelStatus =
  'checking' | 'ready' | 'starting' | 'not-ready' | 'public'

export const POLL_NOT_READY_MS = 15_000
export const POLL_READY_MS = 60_000

/** `null` while the first answer is awaited, `'unreachable'` when none came. */
type Reading = Readiness | 'unreachable' | null

export function statusOf(reading: Reading): ModelStatus {
  if (reading === null) return 'checking'
  if (reading === 'unreachable') return 'not-ready'
  if (reading.public_mode) return 'public'
  if (reading.ready) return 'ready'
  return reading.checks.lab?.detail === 'building' ? 'starting' : 'not-ready'
}

/** Whether a test stand-in (the fake generator or the hashing embedder) passed a check in place of a real model. */
export function usesStandIn(checks: Readiness['checks'] | null): boolean {
  return (
    checks !== null && Object.values(checks).some((check) => check.stand_in)
  )
}

export function useReadiness(): {
  status: ModelStatus
  checks: Readiness['checks'] | null
  /** Every check passed; false until the server answers. */
  ready: boolean
} {
  const [reading, setReading] = useState<Reading>(null)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let controller: AbortController | undefined

    const poll = async () => {
      const request = new AbortController()
      controller = request
      let next: Reading
      try {
        const answer = await getReadiness(request.signal)
        // A 503 that is an error envelope, not a readiness body, is no answer.
        next = 'checks' in answer ? answer : 'unreachable'
      } catch {
        next = 'unreachable'
      }
      if (request.signal.aborted) return
      setReading(next)
      timer = setTimeout(
        poll,
        next !== 'unreachable' && next.ready
          ? POLL_READY_MS
          : POLL_NOT_READY_MS,
      )
    }

    const stop = () => {
      clearTimeout(timer)
      controller?.abort()
    }
    const onVisibility = () => {
      stop()
      if (!document.hidden) void poll()
    }

    if (!document.hidden) void poll()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      stop()
    }
  }, [])

  const answered =
    reading === null || reading === 'unreachable' ? null : reading
  return {
    status: statusOf(reading),
    checks: answered?.checks ?? null,
    ready: answered?.ready ?? false,
  }
}
