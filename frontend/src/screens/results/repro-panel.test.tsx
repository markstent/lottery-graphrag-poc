import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ReproPanel } from './repro-panel'

const record = {
  run: { git_sha: 'abc', run_kind: 'official' },
  worlds: [2026, 2027].map((seed) => ({
    git_sha: 'abc',
    world_seed: seed,
    bank_hash: `hash-${seed}`,
    world_dir: `/worlds/${seed}`,
  })),
}

describe('ReproPanel', () => {
  it('gives a field that differs by world to each world, never as not recorded', () => {
    const { container } = render(<ReproPanel runId="r" record={record} />)
    const runList = container.querySelector('dl') as HTMLElement
    expect(within(runList).queryByText('bank_hash')).toBeNull()
    expect(within(runList).queryByText('world_dir')).toBeNull()
    expect(within(runList).getByText('git_dirty')).toBeInTheDocument()
    expect(screen.getByText('hash-2026')).toBeInTheDocument()
    expect(screen.getByText('hash-2027')).toBeInTheDocument()
    expect(screen.getByText('/worlds/2027')).toBeInTheDocument()
  })
})
