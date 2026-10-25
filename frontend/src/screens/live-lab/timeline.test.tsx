import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { initialRunState } from '../../run/reduce'
import { Timeline } from './timeline'

describe('Timeline', () => {
  it('sits an empty run at the start of its slider', () => {
    render(
      <Timeline
        state={initialRunState()}
        originMs={0}
        timeline={{
          cursor: 0,
          duration: 0,
          playing: false,
          speed: 1,
          enabled: false,
          replaying: false,
        }}
        controls={{
          rewind: vi.fn(),
          play: vi.fn(),
          pause: vi.fn(),
          replay: vi.fn(),
          seek: vi.fn(),
          speed: vi.fn(),
          step: vi.fn(),
        }}
      />,
    )
    expect(screen.getByRole('slider', { name: 'Position' })).toHaveValue('0')
  })
})
