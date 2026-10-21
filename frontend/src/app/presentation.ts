/**
 * Presentation mode: its place in the URL, and the keys that drive the
 * replay of the screen being shown. A view registers its replay through
 * `useRegisterReplay`; while presentation mode is on, Space plays or pauses
 * it, the right arrow steps it and R resets it.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from 'react'

import type { Replay, ReplaySnapshot } from '../run/replay'

export type KeyedReplay = Pick<Replay, 'play' | 'pause' | 'step' | 'reset'> & {
  snapshot: () => Pick<ReplaySnapshot, 'playing'>
}

type RegisterReplay = (replay: KeyedReplay | null) => void

export const ActiveReplayContext = createContext<RegisterReplay>(
  () => undefined,
)

const PARAM = 'present'

export function presentationFromUrl(): boolean {
  return new URLSearchParams(window.location.search).get(PARAM) === '1'
}

/** Keeps the path and the hash; only the query changes. */
export function writePresentationToUrl(on: boolean): void {
  const params = new URLSearchParams(window.location.search)
  if (on) params.set(PARAM, '1')
  else params.delete(PARAM)
  const query = params.toString()
  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`,
  )
}

const TYPING = 'input, textarea, select, [contenteditable], [role="textbox"]'
// Space presses these, so the key is theirs while one has focus.
const PRESSABLE =
  'button, a[href], summary, [role="button"], [role="tab"], [role="switch"], [role="checkbox"]'

/** True when the key belongs to whatever has focus, not to the replay. */
function keyIsTaken(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey)
    return true
  const target = event.target instanceof Element ? event.target : null
  if (target?.closest(`${TYPING}, [role="dialog"]`)) return true
  return event.key === ' ' && target?.closest(PRESSABLE) !== null
}

/**
 * Holds the registered replay and, while `active`, listens for its keys.
 * Returns the function views register through.
 */
export function useActiveReplayRegistry(active: boolean): RegisterReplay {
  const replay = useRef<KeyedReplay | null>(null)

  useEffect(() => {
    if (!active) return
    const onKey = (event: KeyboardEvent) => {
      const current = replay.current
      if (!current || keyIsTaken(event)) return
      if (event.key === ' ') {
        if (current.snapshot().playing) current.pause()
        else current.play()
      } else if (event.key === 'ArrowRight') current.step(1)
      else if (event.key.toLowerCase() === 'r') current.reset()
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])

  return useCallback((next) => {
    replay.current = next
  }, [])
}

/** Registers `replay` as the one presentation keys drive, while the caller is mounted. */
export function useRegisterReplay(replay: KeyedReplay | null): void {
  const register = useContext(ActiveReplayContext)
  useEffect(() => {
    register(replay)
    return () => register(null)
  }, [register, replay])
}
