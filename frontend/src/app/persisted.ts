/**
 * Per-browser preferences. Storage can be blocked, full or absent (private
 * windows, cleared site data), so every access is wrapped: a failure falls
 * back to the default and the app carries on without remembering.
 */

import { useCallback, useState } from 'react'

export function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Not remembered; the preference still applies for this page.
  }
}

/** State that is saved under `key` as text on every change. */
export function usePersisted<T>(
  key: string,
  fallback: T,
  parse: (stored: string) => T | undefined,
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const stored = readStored(key)
    return (stored === null ? undefined : parse(stored)) ?? fallback
  })
  const set = useCallback(
    (next: T) => {
      setValue(next)
      writeStored(key, String(next))
    },
    [key],
  )
  return [value, set]
}

export const parseBoolean = (stored: string): boolean | undefined =>
  stored === 'true' ? true : stored === 'false' ? false : undefined
