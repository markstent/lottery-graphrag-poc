import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { mergeTimeline, useRunPlayback } from './use-run-playback'
import { MOCK_RUN } from '../mock/telemetry'

describe('mergeTimeline', () => {
  it('merges streams ordered by event time', () => {
    const timeline = mergeTimeline(MOCK_RUN)
    expect(timeline.length).toBe(
      MOCK_RUN.rag.length + MOCK_RUN.graph.length + MOCK_RUN.evaluation.length,
    )
    for (let i = 1; i < timeline.length; i += 1) {
      expect(timeline[i].t).toBeGreaterThanOrEqual(timeline[i - 1].t)
    }
  })
})

describe('useRunPlayback', () => {
  it('starts idle with empty prefixes', () => {
    const { result } = renderHook(() => useRunPlayback(MOCK_RUN, false))
    expect(result.current.status).toBe('idle')
    expect(result.current.rag).toEqual([])
    expect(result.current.graph).toEqual([])
    expect(result.current.scores).toBeNull()
  })

  it('jumps to completion immediately under reduced motion', () => {
    const { result } = renderHook(() => useRunPlayback(MOCK_RUN, true))
    act(() => {
      result.current.runQuestion()
    })
    expect(result.current.played).toBe(result.current.total)
    expect(result.current.status).toBe('done')
    expect(result.current.rag).toHaveLength(MOCK_RUN.rag.length)
    expect(result.current.scores).not.toBeNull()
  })

  it('rewind truncates every stream to the same moment', () => {
    const { result } = renderHook(() => useRunPlayback(MOCK_RUN, true))
    act(() => {
      result.current.runQuestion()
    })
    act(() => {
      result.current.rewindTo(5)
    })
    expect(result.current.played).toBe(5)
    expect(result.current.rag.length).toBeLessThan(MOCK_RUN.rag.length)
    expect(result.current.graph.length).toBeLessThan(MOCK_RUN.graph.length)
    expect(result.current.scores).toBeNull()
  })
})
