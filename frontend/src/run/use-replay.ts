/**
 * React binding for the replay clock. The clock is built once per events
 * array and motion preference; its timer is cancelled on unmount and
 * whenever either changes.
 */

import { useEffect, useMemo, useSyncExternalStore } from 'react'

import { createReplay, type Replay, type Speed } from './replay'
import type { RunEvent, RunState } from './reduce'

export interface UseReplay {
  state: RunState
  /** Time of the position in ms from the first event. */
  cursor: number
  /** Events applied. */
  count: number
  duration: number
  playing: boolean
  speed: Speed
  controls: Replay
}

export function useReplay(
  events: RunEvent[],
  options: { reducedMotion: boolean },
): UseReplay {
  const { reducedMotion } = options
  const controls = useMemo(
    () => createReplay(events, { reducedMotion }),
    [events, reducedMotion],
  )
  useEffect(() => () => controls.pause(), [controls])
  const snapshot = useSyncExternalStore(controls.subscribe, controls.snapshot)
  return { ...snapshot, duration: controls.duration, controls }
}
