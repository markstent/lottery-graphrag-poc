import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Schemas } from '../../api/client'
import {
  OFFICIAL,
  PILOT,
  RUNS as CAPTURED_RUNS,
  SMOKE,
} from '../../results/results.fixtures'
import { failure, json, stubApi } from '../../test/api-stub'
import { Results } from './results'

const OFFICIAL_RUN: Schemas['BenchmarkRunOut'] = {
  run_id: 'fixture-official',
  run_kind: 'official',
  label: 'Fixture run (test values)',
  started_at: '2026-10-20T09:00:00Z',
  selection: { strata: null, limit: null },
  worlds: [2026],
  headlines: OFFICIAL.headlines,
}
const RUNS = [OFFICIAL_RUN, ...CAPTURED_RUNS]

const summaryOf = (
  run_id: string,
  run_kind: string,
  summary: Schemas['SummaryOut'],
) => ({ run_id, run_kind, label: null, summary })

const ROUTES = {
  '/api/v1/benchmarks': RUNS,
  '/api/v1/benchmarks/fixture-official': summaryOf(
    'fixture-official',
    'official',
    OFFICIAL,
  ),
  '/api/v1/benchmarks/pilot-2026-nothink': summaryOf(
    'pilot-2026-nothink',
    'official',
    PILOT,
  ),
  '/api/v1/benchmarks/20261019T164733Z-smoke': summaryOf(
    '20261019T164733Z-smoke',
    'smoke',
    SMOKE,
  ),
}

const figureOf = (title: RegExp) =>
  screen.getByText(title).closest('figure') as HTMLElement

const verdict = () => screen.findByRole('region', { name: 'Verdict' })

const open = (run?: string) => {
  window.location.hash = run ? `#/results?run=${run}` : '#/results'
  return render(<Results />)
}

beforeEach(() => {
  window.location.hash = ''
})
afterEach(() => vi.unstubAllGlobals())

describe('Results', () => {
  it('picks the full official run by default', async () => {
    stubApi(ROUTES)
    open()
    expect(await screen.findByRole('group', { name: 'Metric' })).toBeVisible()
    expect(screen.getByRole('combobox', { name: 'Run' })).toHaveValue(
      'fixture-official',
    )
    expect(screen.getByText(OFFICIAL.headlines[0])).toBeVisible()
    expect(
      screen.getAllByRole('group', { name: /evidence score$/ }),
    ).toHaveLength(3)
  })

  it('lists the runs newest first as date - kind - label with the standing', async () => {
    stubApi(ROUTES)
    open()
    const picker = await screen.findByRole('combobox', { name: 'Run' })
    const options = within(picker).getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual([
      '20 October 2026 - Official run - Fixture run (test values)',
      '19 October 2026 - Official run - subset run (at most 2 instances per question)',
      '19 October 2026 - Official run - subset run (at most 1 instance per question)',
      '19 October 2026 - Quick check - scorer smoke test',
    ])
    expect(
      within(picker.parentElement as HTMLElement).getByText('Result'),
    ).toBeVisible()
  })

  it('keeps the run history collapsed and each row opens its run', async () => {
    stubApi(ROUTES)
    open()
    const history = (await screen.findByText('All runs')).closest('details')
    expect(history).not.toHaveAttribute('open')
    const link = within(history as HTMLElement).getAllByRole('link')[3]
    expect(link).toHaveAttribute('href', '#/results?run=20261019T164733Z-smoke')
  })

  it('run param selects a run', async () => {
    stubApi(ROUTES)
    open('pilot-2026-nothink')
    expect(await within(await verdict()).findByText('Subset run')).toBeVisible()
    expect(screen.getByRole('combobox', { name: 'Run' })).toHaveValue(
      'pilot-2026-nothink',
    )
  })

  it('choosing a run in the picker puts it in the address', async () => {
    stubApi(ROUTES)
    open()
    const picker = await screen.findByRole('combobox', { name: 'Run' })
    fireEvent.change(picker, { target: { value: '20261019T164733Z-smoke' } })
    expect(window.location.hash).toBe('#/results?run=20261019T164733Z-smoke')
  })

  it('an unknown run says so and keeps the picker', async () => {
    stubApi(ROUTES)
    open('nope')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This run is not published.',
    )
    expect(screen.getByRole('combobox', { name: 'Run' })).toBeVisible()
  })

  it('quick check shows no results', async () => {
    stubApi(ROUTES)
    open('20261019T164733Z-smoke')
    expect(await screen.findByText(SMOKE.headlines[0])).toBeVisible()
    expect(
      screen.getByText(
        'A quick check tests the scoring code with a stand-in model. Its numbers are not results.',
      ),
    ).toBeVisible()
    expect(screen.queryByRole('figure')).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByText(/evidence score/i)).not.toBeInTheDocument()
  })

  it('subset run is labelled beside its numbers', async () => {
    stubApi(ROUTES)
    open('pilot-2026-nothink')
    expect(await within(await verdict()).findByText('Subset run')).toBeVisible()
    expect(
      screen.getByText('Subset (all strata; at most 2 instances per question)'),
    ).toBeVisible()
    expect(
      screen.getAllByRole('group', { name: /evidence score$/ }),
    ).toHaveLength(3)
    await screen.findAllByRole('figure')
    const figures = screen.getAllByRole('figure')
    expect(figures).toHaveLength(2)
    for (const figure of figures) {
      expect(within(figure).getByText('Subset run')).toBeVisible()
      fireEvent.click(
        within(figure).getByRole('button', { name: 'Show as table' }),
      )
      expect(within(figure).getByRole('table')).toBeVisible()
      expect(within(figure).getByText('Subset run')).toBeVisible()
    }
  })

  it('a whole-bank run carries no subset label in its figures', async () => {
    stubApi(ROUTES)
    open()
    await screen.findAllByRole('figure')
    for (const figure of screen.getAllByRole('figure'))
      expect(within(figure).queryByText('Subset run')).not.toBeInTheDocument()
  })

  it('labels a split chart as a subset too', async () => {
    stubApi({
      ...ROUTES,
      '/api/v1/benchmarks': [
        { ...OFFICIAL_RUN, selection: { strata: null, limit: 5 } },
      ],
    })
    open()
    await screen.findAllByRole('figure')
    const figures = screen.getAllByRole('figure')
    expect(figures).toHaveLength(3)
    for (const figure of figures)
      expect(within(figure).getByText('Subset run')).toBeVisible()
  })

  it('tiles show evidence to two places and the answer score as a percentage', async () => {
    stubApi(ROUTES)
    open('pilot-2026-nothink')
    await verdict()
    await screen.findAllByRole('figure')
    const tile = screen.getByRole('group', {
      name: 'A · Text search evidence score',
    })
    expect(within(tile).getByText(/^\d\.\d\d$/)).toBeVisible()
    expect(within(tile).getByText(/^Answer score \d+%$/)).toBeVisible()
    expect(within(tile).queryByText(/interval/)).not.toBeInTheDocument()
  })

  it('too few pairs draws no interval', async () => {
    stubApi(ROUTES)
    open('pilot-2026-nothink')
    await verdict()
    await screen.findAllByRole('figure')
    const figure = figureOf(/Paired differences/)
    fireEvent.click(
      within(figure).getByRole('button', { name: 'Show as table' }),
    )
    const row = within(figure)
      .getByRole('rowheader', {
        name: /Multi-hop questions: Graph against text search/,
      })
      .closest('tr') as HTMLElement
    const cells = within(row).getAllByRole('cell')
    expect(cells.map((c) => c.textContent)).toEqual([
      'no value',
      'no value',
      'no value',
      '8 pairs in 4 groups',
      'Too few pairs',
    ])
  })

  it('shows the Holm-adjusted p in the table of a tested row', async () => {
    stubApi(ROUTES)
    open()
    await screen.findAllByRole('figure')
    const figure = figureOf(/Paired differences/)
    fireEvent.click(
      within(figure).getByRole('button', { name: 'Show as table' }),
    )
    expect(
      within(figure).getByRole('columnheader', { name: 'Adjusted p (Holm)' }),
    ).toBeVisible()
    expect(within(figure).getAllByText('1.00').length).toBeGreaterThan(0)
  })

  it('shows the split with its descriptive line', async () => {
    stubApi(ROUTES)
    open()
    const heading = await screen.findByRole('heading', {
      name: 'Ontology-dependent split',
    })
    const figure = figureOf(/Differences in evidence score, by question group/)
    expect(heading.nextElementSibling).toBe(figure)
    expect(
      within(figure).getByText('Descriptive: not part of the tested family.'),
    ).toBeVisible()
  })

  it('draws no ellipsis in any chart label', async () => {
    stubApi(ROUTES)
    open()
    await screen.findAllByRole('figure')
    for (const figure of screen.getAllByRole('figure'))
      expect(figure.textContent).not.toContain('…')
  })

  it('says once, horizontally, that single facts have no evidence score', async () => {
    stubApi(ROUTES)
    open('pilot-2026-nothink')
    await screen.findAllByRole('figure')
    const figure = figureOf(/Evidence score by kind of question/)
    expect(within(figure).getByText(/^No evidence/)).toBeVisible()
    expect(within(figure).queryByText('no value')).not.toBeInTheDocument()
  })

  it('split absent says the run predates it', async () => {
    stubApi(ROUTES)
    open('pilot-2026-nothink')
    const heading = await screen.findByRole('heading', {
      name: 'Ontology-dependent split',
    })
    expect(heading.nextElementSibling).toHaveTextContent(
      'This run predates the split.',
    )
    expect(
      screen.queryByText('Descriptive: not part of the tested family.'),
    ).not.toBeInTheDocument()
  })

  it('metric switch by keyboard', async () => {
    stubApi(ROUTES)
    const user = userEvent.setup()
    open()
    const evidence = await screen.findByRole('button', {
      name: 'Evidence score',
    })
    const answer = screen.getByRole('button', { name: 'Answer score' })
    expect(evidence).toHaveAttribute('aria-pressed', 'true')
    answer.focus()
    await user.keyboard('{Enter}')
    expect(answer).toHaveAttribute('aria-pressed', 'true')
    expect(evidence).toHaveAttribute('aria-pressed', 'false')
    expect(figureOf(/Answer score by kind of question/)).toBeVisible()
    evidence.focus()
    await user.keyboard(' ')
    expect(evidence).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows the loading state of the summary', async () => {
    stubApi({
      ...ROUTES,
      '/api/v1/benchmarks/fixture-official': () =>
        new Promise<Response>(() => undefined),
    })
    open()
    expect(await screen.findByRole('combobox', { name: 'Run' })).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('Loading Verdict')
  })

  it('says so when there are no runs', async () => {
    stubApi({ '/api/v1/benchmarks': [] })
    open()
    expect(await screen.findByText('No benchmark runs yet.')).toBeVisible()
  })

  it('shows the error and tries again on retry', async () => {
    let up = false
    stubApi({
      ...ROUTES,
      '/api/v1/benchmarks': () =>
        up ? json(RUNS) : failure('The run list is unavailable.', true),
    })
    open()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The run list is unavailable.',
    )
    up = true
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('combobox', { name: 'Run' })).toBeVisible()
  })

  it('shows the summary error and tries again on retry', async () => {
    let up = false
    stubApi({
      ...ROUTES,
      '/api/v1/benchmarks/fixture-official': () =>
        up
          ? json(summaryOf('fixture-official', 'official', OFFICIAL))
          : failure('The summary is unavailable.', true),
    })
    open()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The summary is unavailable.',
    )
    up = true
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText(OFFICIAL.headlines[0])).toBeVisible()
  })
})
