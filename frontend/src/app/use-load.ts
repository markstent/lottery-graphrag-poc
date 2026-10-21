/**
 * Loads one thing from the API when it mounts, and again when `key` changes
 * or `retry` is called. The request is aborted when the caller unmounts or
 * moves on, so a slow answer never lands in the wrong place.
 */

import { useEffect, useRef, useState } from 'react'

type Outcome<T> =
  { status: 'ready'; data: T } | { status: 'error'; error: Error }

export type Load<T> = ({ status: 'loading' } | Outcome<T>) & {
  retry: () => void
}

export function useLoad<T>(
  load: (signal: AbortSignal) => Promise<T>,
  key: string,
): Load<T> {
  const [attempt, setAttempt] = useState(0)
  const [settled, setSettled] = useState<{
    id: string
    outcome: Outcome<T>
  } | null>(null)
  const loader = useRef(load)
  const id = `${key}#${attempt}`

  useEffect(() => {
    loader.current = load
  })

  useEffect(() => {
    const controller = new AbortController()
    loader.current(controller.signal).then(
      (data) => setSettled({ id, outcome: { status: 'ready', data } }),
      (error: unknown) => {
        if (controller.signal.aborted) return
        setSettled({
          id,
          outcome: {
            status: 'error',
            error: error instanceof Error ? error : new Error(String(error)),
          },
        })
      },
    )
    return () => controller.abort()
  }, [id])

  const retry = () => setAttempt((count) => count + 1)
  const outcome: { status: 'loading' } | Outcome<T> =
    settled?.id === id ? settled.outcome : { status: 'loading' }
  return { ...outcome, retry }
}
