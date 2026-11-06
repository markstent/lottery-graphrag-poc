import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Schemas } from '../../api/client'
import {
  OFFICIAL,
  PILOT,
  RUNS as CAPTURED_RUNS,
  SMOKE,
} from '../../results/results.fixtures'
import { failure, json, PUBLIC, stubApi } from '../../test/api-stub'
import { Results } from './results'

const OFFICIAL_RUN: Schemas['BenchmarkRunOut'] = {
  run_id: 'fixture-official',
  run_kind: 'official',
  label: 'Fixture run (test values)',
  method_version: '0.3.0',
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
) => ({ run_id, run_kind, label: null, method_version: '0.3.0', summary })

const OUTCOMES = {
  recorded: true,
  evidence: {
    A: {
      repeats: 3,
      found: 3,
      missed: 4,
      found_share: 0.42,
      extra_per_question: 16,
    },
  },
  answers: {
    A: {
      scored: 10,
      right: 4,
      partly: 3,
      wrong: 3,
      right_declined: 1,
      partly_declined: 1,
      wrong_declined: 2,
      not_scored: 0,
      partly_score_sum: 1,
    },
  },
}

const ROUTES = {
  '/api/v1/benchmarks/jobs': [],
  '/api/v1/benchmarks': RUNS,
  '/api/v1/benchmarks/fixture-official': summaryOf(
    'fixture-official',
    'official',
    OFFICIAL,
  ),
  '/api/v1/benchmarks/fixture-official/outcomes': OUTCOMES,
  '/api/v1/benchmarks/fixture-subset': summaryOf(
    'fixture-subset',
    'official',
    PILOT,
  ),
  '/api/v1/benchmarks/fixture-smoke': summaryOf(
    'fixture-smoke',
    'smoke',
    SMOKE,
  ),
}

/** The subset run as the harness writes single facts: no evidence recall, so no evidence pairs. */
const NO_SINGLE_FACT_EVIDENCE = {
  ...ROUTES,
  '/api/v1/benchmarks/fixture-subset': summaryOf('fixture-subset', 'official', {
    ...PILOT,
    metrics: {
      ...PILOT.metrics,
      H3: { ...PILOT.metrics.H3, evidence_recall: {} },
    },
    comparisons: PILOT.comparisons.map((c) =>
      c.stratum === 'H3' && c.metric === 'evidence_recall'
        ? {
            ...c,
            n: 0,
            clusters: 0,
            mean: null,
            low: null,
            high: null,
            p: null,
            p_holm: null,
            reason: 'too_few',
          }
        : c,
    ),
  }),
}

const figureOf = (title: RegExp) =>
  screen.getByText(title).closest('figure') as HTMLElement

/** The charts of the scores panel; the efficiency panel draws figures of its own. */
const scoreFigures = () =>
  within(
    screen.getByRole('region', { name: 'Scores by kind of question' }),
  ).getAllByRole('figure')

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
  it('shows the evidence and answer outcomes of the selected run under the verdict', async () => {
    stubApi(ROUTES)
    open('fixture-official')
    const panel = await screen.findByRole('region', { name: 'Outcomes' })
    expect(
      await within(panel).findByText(
        'Evidence found (evidence recall, as in the Verdict)',
      ),
    ).toBeInTheDocument()
    expect(within(panel).getByText('Answers by score')).toBeInTheDocument()
    const regions = screen
      .getAllByRole('region')
      .map((r) => r.getAttribute('aria-label'))
    expect(regions.indexOf('Outcomes')).toBe(regions.indexOf('Verdict') + 1)
  })

  it('says when the outcomes of a run could not be read, and retries', async () => {
    const user = userEvent.setup()
    let calls = 0
    stubApi({
      ...ROUTES,
      '/api/v1/benchmarks/fixture-official/outcomes': () =>
        ++calls === 1
          ? failure('The outcomes could not be read.', true)
          : json(OUTCOMES),
    })
    open('fixture-official')
    const panel = await screen.findByRole('region', { name: 'Outcomes' })
    expect(await within(panel).findByRole('alert')).toHaveTextContent(
      'could not be read',
    )
    await user.click(within(panel).getByRole('button', { name: 'Retry' }))
    expect(
      await within(panel).findByText(/^Evidence found \(evidence recall/),
    ).toBeInTheDocument()
  })

  it('picks the full official run by default', async () => {
    stubApi(ROUTES)
    open()
    expect(await screen.findByRole('group', { name: 'Metric' })).toBeVisible()
    expect(screen.getByRole('combobox', { name: 'Run' })).toHaveValue(
      'fixture-official',
    )
    expect(screen.getByText(OFFICIAL.headlines[0])).toBeVisible()
    expect(
      screen.getAllByRole('group', { name: /evidence recall$/ }),
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
      '19 October 2026 - Quick check - scorer smoke test',
      '19 October 2026 - Official run - Fixture run (test values)',
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
    const link = within(history as HTMLElement).getAllByRole('link')[2]
    expect(link).toHaveAttribute('href', '#/results?run=fixture-smoke')
  })

  it('run param selects a run', async () => {
    stubApi(ROUTES)
    open('fixture-subset')
    expect(await within(await verdict()).findByText('Subset run')).toBeVisible()
    expect(screen.getByRole('combobox', { name: 'Run' })).toHaveValue(
      'fixture-subset',
    )
  })

  it('says under the headlines how many tested cells the interval and the test disagree on, and points at the paired differences', async () => {
    const disagreeing = (over: Partial<Schemas['ComparisonCell']>) => ({
      ...OFFICIAL.comparisons[0],
      in_family: true,
      reason: 'tested',
      low: 0.062,
      high: 0.332,
      p_holm: 0.385,
      ...over,
    })
    stubApi({
      ...ROUTES,
      '/api/v1/benchmarks/fixture-official': summaryOf(
        'fixture-official',
        'official',
        {
          ...OFFICIAL,
          comparisons: [
            disagreeing({}),
            disagreeing({ low: -0.148, high: -0.019, p_holm: 1 }),
            disagreeing({ low: 0.104, high: 0.341, p_holm: 0.03 }),
          ],
        },
      ),
    })
    open('fixture-official')
    const panel = await verdict()
    expect(
      await within(panel).findByText(
        '2 tested comparisons whose interval excludes zero failed the test; see Paired differences.',
      ),
    ).toBeVisible()
    // The line points at a chart that is on this screen.
    expect(
      screen.getByText(/^Paired differences in evidence recall$/),
    ).toBeVisible()
  })

  it('has no interval-and-test line when they agree, and none for a quick check', async () => {
    stubApi(ROUTES)
    open('fixture-official')
    const panel = await verdict()
    await within(panel).findByRole('list')
    expect(within(panel).queryByText(/failed the test/)).toBeNull()
    cleanup()
    open('fixture-smoke')
    const smoke = await verdict()
    await within(smoke).findByRole('list')
    expect(within(smoke).queryByText(/failed the test/)).toBeNull()
  })

  it('choosing a run in the picker puts it in the address', async () => {
    stubApi(ROUTES)
    open()
    const picker = await screen.findByRole('combobox', { name: 'Run' })
    fireEvent.change(picker, { target: { value: 'fixture-smoke' } })
    expect(window.location.hash).toBe('#/results?run=fixture-smoke')
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
    const fetchMock = stubApi(ROUTES)
    open('fixture-smoke')
    expect(await screen.findByText(SMOKE.headlines[0])).toBeVisible()
    expect(
      screen.getByText(
        'A quick check tests the scoring code with a stand-in model. Its numbers are not results.',
      ),
    ).toBeVisible()
    expect(screen.queryByRole('figure')).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByText(/evidence recall/i)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('region', { name: 'Outcomes' }),
    ).not.toBeInTheDocument()
    // Its panel is hidden, so its outcomes are never asked for.
    expect(
      fetchMock.mock.calls.map(([input]) => String(input)),
    ).not.toContainEqual(expect.stringContaining('/outcomes'))
  })

  it('subset run is labelled beside its numbers', async () => {
    stubApi(ROUTES)
    open('fixture-subset')
    expect(await within(await verdict()).findByText('Subset run')).toBeVisible()
    expect(
      screen.getByText('All strata; at most 2 instances per question'),
    ).toBeVisible()
    expect(
      screen.getAllByRole('group', { name: /evidence recall$/ }),
    ).toHaveLength(3)
    await screen.findAllByRole('figure')
    const figures = scoreFigures()
    expect(figures).toHaveLength(3)
    for (const figure of figures) {
      expect(within(figure).getByText('Subset run')).toBeVisible()
      fireEvent.click(
        within(figure).getByRole('button', { name: 'Show as table' }),
      )
      expect(within(figure).getByRole('table')).toBeVisible()
      expect(within(figure).getByText('Subset run')).toBeVisible()
    }
  })

  it('a development run is never opened first and is labelled not a result in every figure', async () => {
    const DEV_RUN = {
      ...OFFICIAL_RUN,
      run_id: 'fixture-dev',
      run_kind: 'dev',
      started_at: '2026-10-21T09:00:00Z',
    }
    stubApi({
      ...ROUTES,
      '/api/v1/benchmarks': [DEV_RUN, ...RUNS],
      '/api/v1/benchmarks/fixture-dev': summaryOf(
        'fixture-dev',
        'dev',
        OFFICIAL,
      ),
      '/api/v1/benchmarks/fixture-dev/outcomes': OUTCOMES,
    })
    const first = open()
    expect(await screen.findByRole('combobox', { name: 'Run' })).toHaveValue(
      'fixture-official',
    )
    first.unmount()
    open('fixture-dev')
    expect(
      await within(await verdict()).findByText('Development run, not a result'),
    ).toBeVisible()
    await screen.findAllByRole('figure')
    for (const figure of scoreFigures())
      expect(
        within(figure).getByText('Development run, not a result'),
      ).toBeVisible()
    const outcomes = await screen.findByRole('region', { name: 'Outcomes' })
    const outcomeFigures = await within(outcomes).findAllByRole('figure')
    expect(outcomeFigures).toHaveLength(2)
    for (const figure of outcomeFigures)
      expect(
        within(figure).getByText('Development run, not a result'),
      ).toBeVisible()
  })

  it('a whole-bank run carries no subset label in its figures', async () => {
    stubApi(ROUTES)
    open()
    await screen.findAllByRole('figure')
    for (const figure of scoreFigures())
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
    const figures = scoreFigures()
    expect(figures).toHaveLength(3)
    for (const figure of figures)
      expect(within(figure).getByText('Subset run')).toBeVisible()
  })

  it('tiles show evidence to two places and the answer score as a percentage', async () => {
    stubApi(ROUTES)
    open('fixture-subset')
    await verdict()
    await screen.findAllByRole('figure')
    const tile = screen.getByRole('group', {
      name: 'A · Text search evidence recall',
    })
    expect(within(tile).getByText(/^\d\.\d\d$/)).toBeVisible()
    expect(within(tile).getByText(/^Answer score \d+%$/)).toBeVisible()
    expect(within(tile).queryByText(/interval/)).not.toBeInTheDocument()
  })

  it('too few pairs draws no interval', async () => {
    stubApi(ROUTES)
    open('fixture-subset')
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
      '6 pairs in 6 groups',
      'Too few pairs',
    ])
  })

  it('a cell with no pairs reads No pairs, with no counts line', async () => {
    stubApi(NO_SINGLE_FACT_EVIDENCE)
    open('fixture-subset')
    await screen.findAllByRole('figure')
    const figure = figureOf(/Paired differences/)
    expect(within(figure).getAllByText('No pairs').length).toBeGreaterThan(0)
    expect(within(figure).queryByText(/^0 pairs/)).not.toBeInTheDocument()
    fireEvent.click(
      within(figure).getByRole('button', { name: 'Show as table' }),
    )
    const row = within(figure)
      .getByRole('rowheader', {
        name: /Single facts: Graph against text search/,
      })
      .closest('tr') as HTMLElement
    expect(
      within(row)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['no value', 'no value', 'no value', 'no value', 'No pairs'])
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
    const figure = figureOf(/^Differences in evidence recall$/)
    expect(heading.nextElementSibling).toBe(figure)
    expect(
      within(figure).getByText('Descriptive: not part of the tested family.'),
    ).toBeVisible()
  })

  it('draws no ellipsis in any chart label', async () => {
    stubApi(ROUTES)
    open()
    await screen.findAllByRole('figure')
    // A chart draws at a fallback width until its container has been measured.
    await waitFor(() => {
      for (const figure of scoreFigures())
        expect(figure.textContent).not.toContain('…')
    })
  })

  it('says once, horizontally, that single facts have no evidence score', async () => {
    stubApi(NO_SINGLE_FACT_EVIDENCE)
    open('fixture-subset')
    await screen.findAllByRole('figure')
    const figure = figureOf(/Evidence recall by kind of question/)
    expect(within(figure).getByText(/^No evidence/)).toBeVisible()
    expect(within(figure).queryByText('no value')).not.toBeInTheDocument()
  })

  it('metric switch by keyboard', async () => {
    stubApi(ROUTES)
    const user = userEvent.setup()
    open()
    const evidence = await screen.findByRole('button', {
      name: 'Evidence recall',
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
    stubApi({ ...ROUTES, '/api/v1/benchmarks': [] })
    open()
    expect(await screen.findByText('No runs yet.')).toBeVisible()
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

  describe('following a run', () => {
    it('puts Start a run in the heading row of the runs panel, first on the screen', async () => {
      stubApi(ROUTES)
      open()
      const runs = await screen.findByRole('region', { name: 'Benchmark runs' })
      expect(screen.getAllByRole('region')[0]).toBe(runs)
      expect(
        within(runs).getByRole('button', { name: 'Start a run' }),
      ).toHaveAttribute('aria-expanded', 'false')
    })

    it('closes an open form when readiness says this is the public site', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      try {
        let publicSite = false
        stubApi({
          ...ROUTES,
          '/api/v1/models': {},
          '/api/v1/benchmarks/latest': failure('none', false, 404),
          '/api/v1/health/ready': () =>
            publicSite ? json(PUBLIC) : failure('not yet', true),
        })
        open()
        const start = await screen.findByRole('button', { name: 'Start a run' })
        await waitFor(() => expect(start).toBeEnabled())
        fireEvent.click(start)
        expect(
          screen.getByRole('radio', { name: 'Development run' }),
        ).toBeVisible()
        publicSite = true
        await act(() => vi.advanceTimersByTimeAsync(15_000))
        await waitFor(() =>
          expect(
            screen.queryByRole('radio', { name: 'Development run' }),
          ).toBeNull(),
        )
        expect(
          screen.getByRole('button', { name: 'Start a run' }),
        ).toBeDisabled()
        expect(
          screen.getByText('Runs cannot be started on the public site.'),
        ).toBeVisible()
      } finally {
        vi.useRealTimers()
      }
    })

    const NEW_RUN = {
      ...OFFICIAL_RUN,
      run_id: 'new-run',
      label: 'Just finished',
      started_at: '2026-10-24T09:00:00Z',
    }
    const progress = {
      world_seed: 2026,
      worlds_done: 0,
      worlds_total: 1,
      instances_done: 3,
      instances_total: 10,
    }

    it('reattaches to a running job after reload', async () => {
      stubApi({
        ...ROUTES,
        '/api/v1/benchmarks/jobs': [
          { job_id: 'J1', status: 'running', progress },
        ],
      })
      open()
      expect(
        await screen.findByText('World 2026 (1 of 1): 3 of 10 questions'),
      ).toBeVisible()
      expect(screen.queryByRole('button', { name: 'Start a run' })).toBeNull()
    })

    it('completed job selects the new run', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      try {
        let done = false
        stubApi({
          ...ROUTES,
          '/api/v1/benchmarks/jobs': [
            { job_id: 'J1', status: 'running', progress },
          ],
          '/api/v1/benchmarks/jobs/J1': () =>
            json({ job_id: 'J1', status: 'completed', run_id: 'new-run' }),
          '/api/v1/benchmarks': () => json(done ? [NEW_RUN, ...RUNS] : RUNS),
          '/api/v1/benchmarks/new-run': summaryOf(
            'new-run',
            'official',
            OFFICIAL,
          ),
        })
        open()
        await screen.findByText('World 2026 (1 of 1): 3 of 10 questions')
        done = true
        await act(() => vi.advanceTimersByTimeAsync(2000))
        await waitFor(() =>
          expect(screen.getByRole('combobox', { name: 'Run' })).toHaveValue(
            'new-run',
          ),
        )
        expect(window.location.hash).toBe('#/results?run=new-run')
        expect(
          screen.getByRole('button', { name: 'Start a run' }),
        ).toBeVisible()
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
