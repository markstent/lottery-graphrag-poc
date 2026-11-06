import { describe, expect, it } from 'vitest'

import { DOWN, PUBLIC, READY } from '../test/api-stub'
import { statusOf } from './use-readiness'

describe('statusOf', () => {
  it('reads the public read-only site as its own status, whatever its checks say', () => {
    expect(statusOf(PUBLIC)).toBe('public')
    expect(
      statusOf({
        ...PUBLIC,
        ready: false,
        checks: {
          ...PUBLIC.checks,
          graph: {
            ok: false,
            detail: 'Neo4j did not answer.',
            stand_in: false,
          },
        },
      }),
    ).toBe('public')
  })

  it('reads the local lab as ready or not ready', () => {
    expect(statusOf(READY)).toBe('ready')
    expect(statusOf(DOWN)).toBe('not-ready')
    expect(statusOf(null)).toBe('checking')
    expect(statusOf('unreachable')).toBe('not-ready')
  })
})
