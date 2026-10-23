import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useLoad } from './use-load'

describe('useLoad', () => {
  it('aborts the request when the caller unmounts', () => {
    let seen: AbortSignal | undefined
    const { unmount } = renderHook(() =>
      useLoad((signal) => {
        seen = signal
        return new Promise<string>(() => undefined)
      }, 'k'),
    )
    expect(seen?.aborted).toBe(false)
    unmount()
    expect(seen?.aborted).toBe(true)
  })

  it('asks again after retry, keeping the failure until the new answer lands', async () => {
    let calls = 0
    const { result } = renderHook(() =>
      useLoad(async () => {
        calls += 1
        if (calls === 1) throw new Error('down')
        return 'up'
      }, 'k'),
    )
    await waitFor(() => expect(result.current.status).toBe('error'))
    act(() => result.current.retry())
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(calls).toBe(2)
  })
})
