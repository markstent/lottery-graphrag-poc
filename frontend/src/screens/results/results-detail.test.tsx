import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Schemas } from '../../api/client'
import {
  OFFICIAL,
  SMOKE,
  OFFICIAL_INSTANCES,
  PILOT,
  PILOT_INSTANCES,
  RUNS as CAPTURED_RUNS,
} from '../../results/results.fixtures'
import { DATASETS, failure, stubApi } from '../../test/api-stub'
import { Results } from './results'

const OFFICIAL_RUN: Schemas['BenchmarkRunOut'] = {
  run_id: 'fixture-official',
  run_kind: 'official',
  label: 'Fixture run (test values)',
  started_at: '2026-10-20T09:00:00Z',
  selection: { strata: null, limit: null },
  worlds: [2026, 2027, 2028],
  headlines: OFFICIAL.headlines,
}

const summaryOf = (run_id: string, summary: Schemas['SummaryOut']) => ({
  run_id,
  run_kind: 'official',
  label: null,
  summary,
})

const ROUTES = {
  '/api/v1/benchmarks/jobs': [],
  '/api/v1/benchmarks': [OFFICIAL_RUN, ...CAPTURED_RUNS],
  '/api/v1/datasets': DATASETS,
  '/api/v1/benchmarks/fixture-official': summaryOf(
    'fixture-official',
    OFFICIAL,
  ),
  '/api/v1/benchmarks/fixture-official/instances': OFFICIAL_INSTANCES,
  '/api/v1/benchmarks/20261019T164733Z-smoke': {
    ...summaryOf('20261019T164733Z-smoke', SMOKE),
    run_kind: 'smoke',
  },
  '/api/v1/benchmarks/pilot-2026-nothink': summaryOf(
    'pilot-2026-nothink',
    PILOT,
  ),
  '/api/v1/benchmarks/pilot-2026-nothink/instances': PILOT_INSTANCES,
}

const open = (query: string) => {
  window.location.hash = `#/results?${query}`
  return render(<Results />)
}

const questionTable = async () =>
  within(await screen.findByRole('region', { name: 'Questions' }))

beforeEach(() => {
  window.location.hash = ''
})
afterEach(() => vi.unstubAllGlobals())

describe('question table', () => {
  it('table filters by stratum and world from the URL', async () => {
    stubApi(ROUTES)
    open('run=fixture-official&stratum=H3&world=2027')
    const table = await questionTable()
    expect(await table.findByText('1 to 6 of 6 (81 in all)')).toBeVisible()
    expect(table.getByRole('combobox', { name: 'Kind' })).toHaveValue('H3')
    expect(table.getByRole('combobox', { name: 'World' })).toHaveValue('2027')
    const body = table.getAllByRole('rowgroup')[1]
    expect(within(body).getAllByRole('row')).toHaveLength(6)
  })

  it('choosing a filter writes it to the address', async () => {
    stubApi(ROUTES)
    open('run=pilot-2026-nothink')
    const table = await questionTable()
    fireEvent.change(await table.findByRole('combobox', { name: 'World' }), {
      target: { value: '2026' },
    })
    expect(window.location.hash).toBe(
      '#/results?run=pilot-2026-nothink&world=2026',
    )
  })

  it('failure count filters the table and moves focus', async () => {
    stubApi(ROUTES)
    const user = userEvent.setup()
    open('run=fixture-official')
    const failures = within(
      await screen.findByRole('region', { name: 'Failures' }),
    )
    const button = failures.getAllByRole('button', {
      name: /^B, the needed evidence was not retrieved/,
    })[0]
    await user.click(button)
    expect(window.location.hash).toContain('failure=B%3Aretrieval_failure')
    const table = await questionTable()
    expect(await table.findByText(/^1 to 50 of 81$/)).toBeVisible()
    expect(
      table.getByText('B: the needed evidence was not retrieved'),
    ).toBeVisible()
    expect(document.activeElement).toBe(
      screen
        .getByRole('region', { name: 'Questions' })
        .querySelector('[tabindex="-1"]'),
    )
  })

  it('row expands by keyboard', async () => {
    stubApi(ROUTES)
    const user = userEvent.setup()
    open('run=pilot-2026-nothink')
    const table = await questionTable()
    const toggle = (
      await table.findAllByRole('button', { name: /^Details for / })
    )[0]
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    toggle.focus()
    await user.keyboard('{Enter}')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const detail = table.getByRole('table', { name: /, world \d+$/ })
    expect(
      within(detail).getByRole('rowheader', { name: 'Recall' }),
    ).toBeVisible()
    expect(
      within(detail).getByRole('rowheader', { name: 'Latency (ms)' }),
    ).toBeVisible()
    await user.keyboard(' ')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('live lab link only for the loaded world', async () => {
    stubApi(ROUTES)
    open('run=fixture-official&stratum=H3')
    const table = await questionTable()
    await table.findAllByRole('link', { name: /in Live Lab$/ })
    const h3 = OFFICIAL_INSTANCES.filter((row) => row.stratum === 'H3')
    const loaded = h3.filter((row) => row.world_seed === 2026).length
    expect(table.getAllByRole('link', { name: /in Live Lab$/ })).toHaveLength(
      loaded,
    )
    const elsewhere = h3.length - loaded
    expect(table.getAllByText('Loaded world is 2026')).toHaveLength(elsewhere)
    expect(table.getAllByText('Not loaded')).toHaveLength(elsewhere)
  })

  it('older run renders with missing fields', async () => {
    stubApi(ROUTES)
    open('run=pilot-2026-nothink')
    const repro = within(
      await screen.findByRole('region', { name: 'Reproducibility' }),
    )
    const term = repro.getAllByText('git_dirty')[0]
    expect(term.nextElementSibling).toHaveTextContent('Not recorded')
    expect(repro.getByRole('link', { name: 'Raw record' })).toHaveAttribute(
      'href',
      '/api/v1/benchmarks/pilot-2026-nothink',
    )
  })

  it('table pages at 50 with the total', async () => {
    stubApi(ROUTES)
    const user = userEvent.setup()
    open('run=fixture-official')
    const table = await questionTable()
    expect(await table.findByText('1 to 50 of 81')).toBeVisible()
    expect(
      within(table.getAllByRole('rowgroup')[1]).getAllByRole('row'),
    ).toHaveLength(50)
    await user.click(table.getByRole('button', { name: 'Next' }))
    expect(table.getByText('51 to 81 of 81')).toBeVisible()
    expect(table.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it('instances error keeps the charts', async () => {
    stubApi({
      ...ROUTES,
      '/api/v1/benchmarks/pilot-2026-nothink/instances': () =>
        failure('This run has no per-question results.', false, 404),
    })
    open('run=pilot-2026-nothink')
    expect(
      await within(
        await screen.findByRole('region', { name: 'Questions' }),
      ).findByRole('alert'),
    ).toHaveTextContent('This run has no per-question results.')
    expect(await screen.findAllByRole('figure')).not.toHaveLength(0)
    expect(screen.getByRole('region', { name: 'Failures' })).toBeVisible()
  })

  it('a world list that failed to load does not say no world is loaded', async () => {
    stubApi({
      ...ROUTES,
      '/api/v1/datasets': () =>
        failure('The datasets could not be read.', true),
    })
    open('run=fixture-official&stratum=H3')
    const table = await questionTable()
    await table.findAllByText('Missing')
    expect(table.queryByText('Not loaded')).toBeNull()
    expect(table.queryByText('No world is loaded')).toBeNull()
    expect(table.queryAllByRole('link', { name: /in Live Lab$/ })).toHaveLength(
      0,
    )
  })

  it('kind column is short, the filter keeps the full name, and a not loaded cell keeps its reason', async () => {
    stubApi(ROUTES)
    open('run=fixture-official&stratum=H2_name&world=2027')
    const table = await questionTable()
    const row = (await table.findAllByText('Ontology, by name'))[0].closest(
      'tr',
    ) as HTMLElement
    expect(within(row).getByText('Not loaded')).toBeVisible()
    expect(within(row).getByText('Loaded world is 2026')).toBeInTheDocument()
    expect(
      table.getByRole('option', {
        name: 'Ontology-dependent questions, by local-language name',
      }),
    ).toBeInTheDocument()
  })

  it('subset run labels the table and panels', async () => {
    stubApi(ROUTES)
    open('run=pilot-2026-nothink')
    for (const name of ['Questions', 'Efficiency', 'Failures', 'Judge'])
      expect(
        await within(await screen.findByRole('region', { name })).findByText(
          'Subset run',
        ),
      ).toBeVisible()
  })

  it('a quick check shows only the reproducibility panel beside the headline', async () => {
    stubApi({
      ...ROUTES,
      '/api/v1/benchmarks': CAPTURED_RUNS,
    })
    open('run=20261019T164733Z-smoke')
    expect(
      await screen.findByRole('region', { name: 'Reproducibility' }),
    ).toBeVisible()
    expect(
      screen.queryByRole('region', { name: 'Questions' }),
    ).not.toBeInTheDocument()
  })
})

describe('panels', () => {
  it('no judge in this run', async () => {
    stubApi({
      ...ROUTES,
      '/api/v1/benchmarks/fixture-official': summaryOf('fixture-official', {
        ...OFFICIAL,
        judge_agreement: null,
      }),
    })
    open('run=fixture-official')
    expect(
      within(await screen.findByRole('region', { name: 'Judge' })).getByText(
        'No judge in this run',
      ),
    ).toBeVisible()
  })

  it('judge shows the five metrics per kind of question and approach', async () => {
    stubApi(ROUTES)
    open('run=fixture-official')
    const panel = within(await screen.findByRole('region', { name: 'Judge' }))
    expect(
      panel.getByRole('rowheader', { name: 'Single facts - B · Graph' }),
    ).toBeVisible()
    for (const name of ['Correctness', 'Abstention'])
      expect(panel.getByRole('columnheader', { name })).toBeVisible()
  })

  it('efficiency carries its one line and the two charts', async () => {
    stubApi(ROUTES)
    open('run=fixture-official')
    const panel = within(
      await screen.findByRole('region', { name: 'Efficiency' }),
    )
    expect(await panel.findAllByRole('figure')).toHaveLength(2)
  })
})
