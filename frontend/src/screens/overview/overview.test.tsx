import { render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DATASETS, failure, json, MODELS, stubApi } from '../../test/api-stub'
import { Overview } from './overview'

const cell = (mean: number | null, n: number, repeats: number) => ({
  mean,
  n,
  repeats,
})

const OFFICIAL = {
  run_id: 'official-1',
  run_kind: 'official',
  label: null,
  method_version: '0.2.0',
  summary: {
    selection: { strata: null, limit: null },
    headlines: [
      'Graph found 0.12 more evidence than text search (95% interval 0.05 to 0.19).',
      'Graph + Ontology found 0.03 more than Graph (95% interval -0.02 to 0.08).',
    ],
    metrics: {
      overall: {
        evidence_f1: {
          A: cell(0.25, 114, 342),
          B: cell(null, 0, 0),
          C: cell(0.5, 114, 342),
        },
      },
    },
  },
}

const SMOKE = {
  run_id: 'smoke-1',
  run_kind: 'smoke',
  label: 'scorer smoke test',
  summary: {
    ...OFFICIAL.summary,
    selection: { strata: null, limit: null },
  },
}

const QUESTIONS = [
  {
    instance_id: 'L05-2026-INC_S007_GR',
    question_id: 'L05',
    text: 'Why did digital conversion fall in Greece?',
    stratum: 'H1',
    market_scope: [],
  },
  {
    instance_id: 'L07-2026-X',
    question_id: 'L07',
    text: 'Which markets share a payment provider?',
    stratum: 'H2',
    market_scope: [],
  },
]

const base = (latest: unknown) => ({
  '/api/v1/benchmarks/latest': latest,
  '/api/v1/demo/questions': QUESTIONS,
  '/api/v1/datasets': DATASETS,
  '/api/v1/models': MODELS,
})

afterEach(() => vi.unstubAllGlobals())

describe('Overview', () => {
  it('opens with its purpose sentence and heading', async () => {
    stubApi(base(OFFICIAL))
    render(<Overview />)
    expect(
      screen.getByRole('heading', { level: 1, name: 'Overview' }),
    ).toBeVisible()
    await screen.findByTestId('tile-A')
  })

  it('fills one tile per pipeline from a full official run', async () => {
    stubApi(base(OFFICIAL))
    render(<Overview />)
    const a = await screen.findByTestId('tile-A')
    expect(within(a).getByText('A · Text search')).toBeVisible()
    // F1 is defined only for questions with claims: the tile says so and gives their count.
    expect(
      within(a).getByText('Evidence score, questions with claims'),
    ).toBeVisible()
    expect(within(a).getByText('0.25')).toBeVisible()
    expect(within(a).getByText('114 questions, 342 runs')).toBeVisible()
    const b = screen.getByTestId('tile-B')
    expect(within(b).getByText('B · Graph')).toBeVisible()
    expect(within(b).getByText('Missing')).toBeVisible()
    expect(within(b).queryByText('0.00')).toBeNull()
    expect(
      within(screen.getByTestId('tile-C')).getByText('C · Graph + Ontology'),
    ).toBeVisible()
  })

  it('names the method of the run, the old one as old', async () => {
    stubApi(base(OFFICIAL))
    render(<Overview />)
    await screen.findByTestId('tile-A')
    const panel = screen.getByRole('region', { name: 'Latest official run' })
    expect(within(panel).getByText('Method v0.2 (old method)')).toBeVisible()
    expect(within(panel).queryByText(/was made after/)).toBeNull()
  })

  it('reads evidence recall, by name, from a run of method v0.3', async () => {
    stubApi(
      base({
        ...OFFICIAL,
        method_version: '0.3.0',
        summary: {
          ...OFFICIAL.summary,
          method_note: 'Method v0.3 was made after seeing the v0.2.0 result.',
          metrics: {
            overall: {
              evidence_recall: {
                A: cell(0.4, 120, 360),
                B: cell(0.6, 120, 360),
                C: cell(0.7, 120, 360),
              },
            },
          },
        },
      }),
    )
    render(<Overview />)
    const a = await screen.findByTestId('tile-A')
    expect(
      within(a).getByText('Evidence recall, questions with claims'),
    ).toBeVisible()
    expect(within(a).getByText('0.40')).toBeVisible()
    expect(within(a).getByText('120 questions, 360 runs')).toBeVisible()
    expect(screen.getByText('Method v0.3')).toBeVisible()
    expect(
      screen.getByText('Method v0.3 was made after seeing the v0.2.0 result.'),
    ).toBeVisible()
  })

  it('renders the headline sentences verbatim', async () => {
    stubApi(base(OFFICIAL))
    render(<Overview />)
    for (const line of OFFICIAL.summary.headlines)
      expect(await screen.findByText(line)).toBeVisible()
  })

  it('says under the headlines how many tested cells the interval and the test disagree on, with a link to Results', async () => {
    const comparison = (low: number, high: number, pHolm: number) => ({
      stratum: 'H2',
      metric: 'evidence_recall',
      comparison: 'C_vs_B',
      n: 72,
      clusters: 24,
      mean: (low + high) / 2,
      low,
      high,
      p: pHolm / 10,
      p_holm: pHolm,
      in_family: true,
      reason: 'tested',
    })
    stubApi(
      base({
        ...OFFICIAL,
        summary: {
          ...OFFICIAL.summary,
          comparisons: [
            comparison(0.104, 0.341, 0.03),
            comparison(0.062, 0.332, 0.385),
            comparison(-0.121, -0.025, 0.229),
            comparison(-0.068, 0.048, 1),
          ],
        },
      }),
    )
    render(<Overview />)
    const note = await screen.findByText(
      /^2 tested comparisons whose interval excludes zero failed the test; see/,
    )
    expect(note).toBeVisible()
    expect(
      within(note).getByRole('link', {
        name: 'Paired differences, on Results',
      }),
    ).toHaveAttribute('href', '#/results')
  })

  it('adds no such line when every interval and test agree', async () => {
    stubApi(base(OFFICIAL))
    render(<Overview />)
    await screen.findByTestId('tile-A')
    expect(screen.queryByText(/failed the test/)).toBeNull()
  })

  it('shows the plain no-run state, with a link to Results, on a 404', async () => {
    stubApi({
      ...base(null),
      '/api/v1/benchmarks/latest': () =>
        failure('no published benchmark run', false, 404),
    })
    render(<Overview />)
    expect(await screen.findByText('No official run yet')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Go to Results' })).toHaveAttribute(
      'href',
      '#/results',
    )
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText(/^Latest run:/)).toBeNull()
    expect(screen.queryByTestId('tile-A')).toBeNull()
    expect(screen.queryByTestId('tile-B')).toBeNull()
    expect(screen.queryByTestId('tile-C')).toBeNull()
    const panel = screen.getByRole('region', { name: 'Latest official run' })
    expect(panel.textContent).not.toMatch(/\d/)
  })

  it('never fills the tiles from a smoke run, and names it', async () => {
    stubApi(base(SMOKE))
    render(<Overview />)
    expect(await screen.findByText('No official run yet')).toBeVisible()
    expect(screen.getByText('Latest run: scorer smoke test')).toBeVisible()
    expect(screen.queryByTestId('tile-A')).toBeNull()
    expect(screen.queryByText('0.25')).toBeNull()
    expect(screen.queryByText(OFFICIAL.summary.headlines[0])).toBeNull()
  })

  it('never fills the tiles from a subset official run', async () => {
    stubApi(
      base({
        ...OFFICIAL,
        label: 'subset run',
        summary: { ...OFFICIAL.summary, selection: { strata: null, limit: 1 } },
      }),
    )
    render(<Overview />)
    expect(await screen.findByText('Latest run: subset run')).toBeVisible()
    expect(screen.queryByTestId('tile-A')).toBeNull()
  })

  it('links each demo question into Live Lab by its instance id', async () => {
    stubApi(base(OFFICIAL))
    render(<Overview />)
    const link = await screen.findByRole('link', {
      name: 'Why did digital conversion fall in Greece?',
    })
    expect(link).toHaveAttribute(
      'href',
      '#/live-lab?question=L05-2026-INC_S007_GR',
    )
    expect(
      screen.getByRole('link', { name: 'Run a question' }),
    ).toHaveAttribute('href', '#/live-lab')
  })

  it('shows the active dataset in plain words and the models', async () => {
    stubApi(base(OFFICIAL))
    render(<Overview />)
    expect(await screen.findByText('dev world, 2026')).toBeVisible()
    expect(screen.getByText('Answer model')).toBeVisible()
    expect(screen.getByText('qwen3:8b')).toBeVisible()
  })
})

describe('Overview panel states', () => {
  it('shows each panel loading, then ready', async () => {
    stubApi(base(OFFICIAL))
    render(<Overview />)
    expect(screen.getAllByRole('status').length).toBeGreaterThanOrEqual(3)
    await screen.findByTestId('tile-A')
  })

  it('shows an error with a retry for a failing latest run, and the rest still loads', async () => {
    stubApi({
      ...base(OFFICIAL),
      '/api/v1/benchmarks/latest': () =>
        failure('The run is unavailable.', true),
    })
    render(<Overview />)
    expect(await screen.findByText('The run is unavailable.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible()
    expect(
      await screen.findByRole('link', {
        name: 'Why did digital conversion fall in Greece?',
      }),
    ).toBeVisible()
  })

  it('shows an empty state when there are no demo questions', async () => {
    stubApi({ ...base(OFFICIAL), '/api/v1/demo/questions': [] })
    render(<Overview />)
    expect(await screen.findByText('No demo questions.')).toBeVisible()
  })

  it('shows an error for the questions and for the configuration', async () => {
    stubApi({
      ...base(OFFICIAL),
      '/api/v1/demo/questions': () =>
        failure('Questions are unavailable.', false),
      '/api/v1/models': () => failure('Models are unavailable.', false),
      '/api/v1/datasets': () => json(DATASETS),
    })
    render(<Overview />)
    expect(await screen.findByText('Questions are unavailable.')).toBeVisible()
    expect(await screen.findByText('Models are unavailable.')).toBeVisible()
  })
})
