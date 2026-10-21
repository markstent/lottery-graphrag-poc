import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import fixture from './fixtures/run-abc.json'
import { reduceAll, type RunEvent } from './reduce'
import { useReplay } from './use-replay'

const recorded = fixture.events as unknown as RunEvent[]

afterEach(() => {
  vi.useRealTimers()
})

describe('useReplay', () => {
  it('starts at the beginning, paused', () => {
    const { result } = renderHook(() =>
      useReplay(recorded, { reducedMotion: false }),
    )
    expect(result.current.count).toBe(0)
    expect(result.current.playing).toBe(false)
    expect(result.current.state).toEqual(reduceAll([]))
  })

  it('jumps to the end state under reduced motion', () => {
    const { result } = renderHook(() =>
      useReplay(recorded, { reducedMotion: true }),
    )
    act(() => result.current.controls.play())
    expect(result.current.count).toBe(recorded.length)
    expect(result.current.playing).toBe(false)
    expect(result.current.state).toEqual(reduceAll(recorded))
  })

  it('plays on real timers and follows the recorded gaps', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() =>
      useReplay(recorded, { reducedMotion: false }),
    )
    act(() => result.current.controls.play())
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    const origin = recorded[0].t_ms
    expect(result.current.state).toEqual(
      reduceAll(recorded.filter((event) => event.t_ms - origin <= 1000)),
    )
  })

  it('leaves no timer after unmount', () => {
    vi.useFakeTimers()
    const { result, unmount } = renderHook(() =>
      useReplay(recorded, { reducedMotion: false }),
    )
    act(() => result.current.controls.play())
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels the old clock when the events change', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(
      ({ events }) => useReplay(events, { reducedMotion: false }),
      { initialProps: { events: recorded } },
    )
    act(() => result.current.controls.play())
    expect(vi.getTimerCount()).toBe(1)
    rerender({ events: recorded.slice(0, 10) })
    expect(vi.getTimerCount()).toBe(0)
    expect(result.current.count).toBe(0)
    expect(result.current.playing).toBe(false)
  })
})
