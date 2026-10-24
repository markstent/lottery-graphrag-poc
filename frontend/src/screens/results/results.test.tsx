import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { failure, json, stubApi } from '../../test/api-stub'
import { Results } from './results'

const RUNS = [
  {
    run_id: 'run-b',
    run_kind: 'official',
    label: null,
    started_at: '2026-10-20T10:00:00Z',
    selection: { strata: null, limit: null },
    worlds: [2026],
    headlines: ['C beat A on every stratum.'],
  },
  {
    run_id: 'run-a',
    run_kind: 'smoke',
    label: 'Pilot check',
    started_at: '2026-10-18T09:00:00Z',
    selection: { strata: ['depth'], limit: 3 },
    worlds: [2026],
    headlines: ['Pilot only.'],
  },
  {
    run_id: 'run-c',
    run_kind: 'ablation',
    label: null,
    started_at: '2026-10-17T09:00:00Z',
    selection: { strata: null, limit: 1 },
    worlds: [2026],
    headlines: [],
  },
]

const ROUTES = { '/api/v1/benchmarks': RUNS }

afterEach(() => vi.unstubAllGlobals())

describe('Results', () => {
  it('lists each run plainly with its headlines and a summary link', async () => {
    stubApi(ROUTES)
    render(<Results />)
    const [official] = await screen.findAllByRole('article')
    expect(within(official).getByText('Official run')).toBeVisible()
    expect(within(official).getByText('20 October 2026')).toBeVisible()
    expect(
      within(official).getByText('C beat A on every stratum.'),
    ).toBeVisible()
    expect(
      within(official).getByRole('link', {
        name: 'Reproducibility record (JSON)',
      }),
    ).toHaveAttribute('href', '/api/v1/benchmarks/run-b')
    expect(
      within(official).getByRole('link', {
        name: 'Reproducibility record (JSON)',
      }),
    ).toHaveAttribute('rel', 'noopener')
    expect(screen.queryByText('smoke')).not.toBeInTheDocument()
    expect(within(official).queryByText(/Subset/)).not.toBeInTheDocument()
  })

  it('labels a subset run as a subset', async () => {
    stubApi(ROUTES)
    render(<Results />)
    const [, subset] = await screen.findAllByRole('article')
    expect(within(subset).getByText('Quick check - Pilot check')).toBeVisible()
    expect(
      within(subset).getByText(
        'Subset (strata: depth; at most 3 instances per question)',
      ),
    ).toBeVisible()
    expect(within(subset).getByText('Pilot only.')).toBeVisible()
  })

  it('reads an unknown kind as plain words and an all-strata limit as a subset', async () => {
    stubApi(ROUTES)
    render(<Results />)
    const [, , other] = await screen.findAllByRole('article')
    expect(within(other).getByText('ablation')).toBeVisible()
    expect(
      within(other).getByText(
        'Subset (all strata; at most 1 instance per question)',
      ),
    ).toBeVisible()
    expect(within(other).queryByRole('list')).not.toBeInTheDocument()
  })

  it('says so when there are no runs', async () => {
    stubApi({ '/api/v1/benchmarks': [] })
    render(<Results />)
    expect(await screen.findByText('No benchmark runs yet.')).toBeVisible()
  })

  it('shows the error and tries again on retry', async () => {
    let up = false
    stubApi({
      ...ROUTES,
      '/api/v1/benchmarks': () =>
        up ? json(RUNS) : failure('The run list is unavailable.', true),
    })
    render(<Results />)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The run list is unavailable.',
    )
    up = true
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('20 October 2026')).toBeVisible()
  })
})
