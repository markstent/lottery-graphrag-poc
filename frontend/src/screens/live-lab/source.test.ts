import { describe, expect, it } from 'vitest'

import { DOWN, PUBLIC, READY } from '../../test/api-stub'
import { liveUnavailableReason, PUBLIC_LIVE_OFF } from './source'

describe('liveUnavailableReason', () => {
  it('is null when the backend is ready', () => {
    expect(liveUnavailableReason('ready', READY.checks)).toBeNull()
  })

  it('says in plain words why Live is off', () => {
    expect(liveUnavailableReason('checking', null)).toBe(
      'Checking the backend.',
    )
    expect(liveUnavailableReason('starting', null)).toBe(
      'The backend is still starting.',
    )
    expect(liveUnavailableReason('not-ready', DOWN.checks)).toBe(
      'The answer model is not ready: qwen3:8b is not listed by the model server.',
    )
    expect(liveUnavailableReason('not-ready', null)).toBe(
      'The backend did not answer.',
    )
  })

  it('says live answers are off on the public site and points to the recorded runs', () => {
    expect(liveUnavailableReason('public', PUBLIC.checks)).toBe(PUBLIC_LIVE_OFF)
    expect(PUBLIC_LIVE_OFF).toBe(
      'Live answers are off on the public site. Replay a recorded run below.',
    )
  })
})
