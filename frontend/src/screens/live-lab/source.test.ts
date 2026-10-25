import { describe, expect, it } from 'vitest'

import { DOWN, READY } from '../../test/api-stub'
import { liveUnavailableReason } from './source'

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
})
