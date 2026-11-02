import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { V03_SECOND_JUDGE } from '../../results/results.fixtures'
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
  method_version: '0.3.0',
  summary: {
    selection: { strata: null, limit: null },
    headlines: [
      'Graph found 0.12 more evidence than text search (95% interval 0.05 to 0.19).',
      'Graph + Ontology found 0.03 more than Graph (95% interval -0.02 to 0.08).',
    ],
    metrics: {
      overall: {
        evidence_recall: {
          A: cell(0.25, 114, 342),
          B: cell(null, 0, 0),
          C: cell(0.5, 114, 342),
        },
        answer: {
          A: cell(0.5, 150, 450),
          B: cell(0.55, 150, 450),
          C: cell(0.6, 150, 450),
        },
      },
    },
    instances: { total: { overall: 150 }, per_world: {} },
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
    expect(within(a).getByText('Evidence found')).toBeVisible()
    expect(within(a).getByText('25%')).toBeVisible()
    expect(within(a).getByText('Answer score 50%')).toBeVisible()
    const b = screen.getByTestId('tile-B')
    expect(within(b).getByText('B · Graph')).toBeVisible()
    expect(within(b).getByText('Missing')).toBeVisible()
    expect(within(b).queryByText('0%')).toBeNull()
    expect(
      screen.getByText(
        /^All three answered the same 150 questions about a made-up lottery company\. Each gets two scores:$/,
      ),
    ).toBeVisible()
    expect(
      within(screen.getByTestId('tile-C')).getByText('C · Graph + Ontology'),
    ).toBeVisible()
  })

  it('names no method and says nothing of how the method came about', async () => {
    stubApi(
      base({
        ...OFFICIAL,
        summary: { ...OFFICIAL.summary, method_note: 'A note on the method.' },
      }),
    )
    render(<Overview />)
    await screen.findByTestId('tile-A')
    const panel = screen.getByRole('region', { name: 'What we found' })
    expect(within(panel).queryByText(/Method v0/)).toBeNull()
    expect(within(panel).queryByText('A note on the method.')).toBeNull()
  })

  it('leaves out a question count the summary does not give, never printing 0', async () => {
    const { instances: _, ...noCounts } = OFFICIAL.summary
    stubApi(base({ ...OFFICIAL, summary: noCounts }))
    render(<Overview />)
    expect(
      await screen.findByText(/^All three answered the same questions about/),
    ).toBeVisible()
  })

  it('leaves the headline sentences to Results', async () => {
    stubApi(base(OFFICIAL))
    render(<Overview />)
    await screen.findByTestId('tile-A')
    for (const line of OFFICIAL.summary.headlines)
      expect(screen.queryByText(line)).toBeNull()
  })

  const comparison = (over: Record<string, unknown>) => ({
    stratum: 'H2',
    metric: 'evidence_recall',
    comparison: 'C_vs_B',
    n: 72,
    clusters: 24,
    mean: 0.2,
    low: 0.06,
    high: 0.33,
    p: 0.04,
    p_holm: 0.385,
    in_family: true,
    reason: 'tested',
    ...over,
  })

  const withComparisons = (comparisons: unknown[]) =>
    base({
      ...OFFICIAL,
      method_version: '0.3.0',
      summary: { ...OFFICIAL.summary, comparisons },
    })

  it('draws the answer score by kind of question, switches to evidence found, and marks the clear result and the untested kind', async () => {
    const kind = (a: number, b: number, c: number) => ({
      evidence_recall: {
        A: cell(a, 72, 72),
        B: cell(b, 72, 72),
        C: cell(c, 72, 72),
      },
      answer: { A: cell(a, 72, 72), B: cell(b, 72, 72), C: cell(c, 72, 72) },
    })
    stubApi(
      base({
        ...OFFICIAL,
        method_version: '0.3.0',
        summary: {
          ...OFFICIAL.summary,
          metrics: {
            ...OFFICIAL.summary.metrics,
            H1: kind(0.43, 0.65, 0.64),
            H2_name: kind(0.78, 0.62, 1),
            H3: kind(0.9, 0.9, 0.9),
          },
          comparisons: [
            comparison({
              stratum: 'H1',
              comparison: 'B_vs_A',
              mean: 0.22,
              low: 0.1,
              high: 0.34,
              p_holm: 0.03,
            }),
          ],
        },
      }),
    )
    render(<Overview />)
    // The answer score is shown first (owner, 2026-11-02).
    const answers = await screen.findByRole('img', {
      name: 'Answer score by kind of question',
    })
    expect(
      screen.getByRole('button', { name: 'Answer score' }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(within(answers).getByText('Single facts')).toBeInTheDocument()
    expect(
      within(answers).getByText('Several linked records'),
    ).toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', { name: 'Evidence found' }),
    )
    const chart = await screen.findByRole('img', {
      name: 'Evidence found by kind of question',
    })
    expect(
      within(chart).getByText('Several linked records (clear result)'),
    ).toBeInTheDocument()
    expect(
      within(chart).getByText('Local-language names (not tested)'),
    ).toBeInTheDocument()
    expect(within(chart).queryByText('Single facts')).toBeNull()
    expect(within(chart).getByText('65')).toBeInTheDocument()
  })

  const markOf = (a: number, b: number, c: number) => ({
    A: cell(a, 72, 72),
    B: cell(b, 72, 72),
    C: cell(c, 72, 72),
  })

  /** The second-judge answer of the official run, with its judges' mark (D-105). */
  const withJudges = (combined: Record<string, unknown>) => ({
    ...base({
      ...OFFICIAL,
      summary: {
        ...OFFICIAL.summary,
        metrics: {
          ...OFFICIAL.summary.metrics,
          H1: {
            evidence_recall: markOf(0.43, 0.65, 0.64),
            answer: markOf(0.5, 0.6, 0.6),
          },
        },
        comparisons: [comparison({})],
      },
    }),
    '/api/v1/benchmarks/official-1/second-judge': {
      ...V03_SECOND_JUDGE,
      combined: { ...V03_SECOND_JUDGE.combined, ...combined },
    },
  })
  const judgeCell = (over: Record<string, unknown>) =>
    comparison({ metric: 'judge_mark', ...over })

  it("adds the judges' mark to the key, each tile and the chart when the run has it", async () => {
    stubApi(
      withJudges({
        metrics: {
          overall: markOf(0.61, 0.66, 0.7),
          H1: markOf(0.5, 0.6, 0.7),
        },
        comparisons: [],
      }),
    )
    render(<Overview />)
    const panel = await screen.findByRole('region', { name: 'What we found' })
    await within(panel).findByText("Judges' mark:")
    expect(
      within(panel).getByText('how two AI judges rated the answer, averaged.'),
    ).toBeVisible()
    expect(within(panel).getByText(/Each gets three scores:/)).toBeVisible()
    expect(
      within(screen.getByTestId('tile-B')).getByText("Judges' mark 66%"),
    ).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: "Judges' mark" }))
    const chart = await screen.findByRole('img', {
      name: "Judges' mark by kind of question",
    })
    expect(within(chart).getByText('70')).toBeInTheDocument()
  })

  it("states a clear result of the judges' own tests apart from the run's count line", async () => {
    stubApi(
      withJudges({
        comparisons: [
          judgeCell({
            stratum: 'H1',
            comparison: 'B_vs_A',
            mean: 0.081,
            low: 0.02,
            high: 0.14,
            p_holm: 0.02,
          }),
          judgeCell({ mean: 0, low: -0.05, high: 0.05, p_holm: 1 }),
          judgeCell({ mean: 0.05, low: 0.01, high: 0.09, p_holm: 0.4 }),
        ],
      }),
    )
    render(<Overview />)
    const panel = await screen.findByRole('region', { name: 'What we found' })
    await within(panel).findByText("Judges' mark:")
    // The findings are the last list; the chart's legend is a list too.
    const findings = within(panel).getAllByRole('list').at(-1)!
    const items = within(findings)
      .getAllByRole('listitem')
      .map((li) => li.textContent)
    expect(items).toEqual([
      'No difference is proven yet. We made 1 check, comparing two approaches on one kind of question and one score. In 1, one approach came out ahead, but not by enough to rule out luck. Graph + Ontology did better on questions that match terms across countries.',
      'Graph did better on questions that need several linked records. For example: "which other countries had incidents on the same platform version as this one?" Graph scored about 8 points higher on the two judges\' mark than Text search. This passed our statistical test, so it is unlikely to be luck.',
      "Judges' mark: Nothing else is proven yet. We made 2 other checks, each comparing two approaches on one kind of question. In 1, one approach came out ahead, but not by enough to rule out luck. Graph + Ontology did better on questions that match terms across countries. In the other one the approaches were too close to call.",
    ])
  })

  it("says nothing of the judges' mark when the run has none worked out", async () => {
    stubApi({
      ...withComparisons([comparison({})]),
      '/api/v1/benchmarks/official-1/second-judge': {
        ...V03_SECOND_JUDGE,
        combined: null,
      },
    })
    render(<Overview />)
    await screen.findByTestId('tile-A')
    expect(screen.queryByText(/Judges' mark/)).toBeNull()
    expect(screen.getByText(/Each gets two scores:/)).toBeVisible()
  })

  it('leaves the chart out for a run with no figures by kind of question', async () => {
    stubApi(base(OFFICIAL))
    render(<Overview />)
    await screen.findByTestId('tile-A')
    expect(
      screen.queryByRole('img', { name: /by kind of question/ }),
    ).toBeNull()
    expect(screen.queryByText('No results to show.')).toBeNull()
  })

  it('says two pointers about the same kind of question in one sentence', async () => {
    const untested = (over: Record<string, unknown>) =>
      comparison({
        stratum: 'H2_name',
        clusters: 12,
        p: null,
        p_holm: null,
        in_family: false,
        reason: 'not_in_family',
        ...over,
      })
    stubApi(
      withComparisons([
        untested({
          comparison: 'B_vs_A',
          mean: -0.167,
          low: -0.21,
          high: -0.12,
        }),
        untested({ comparison: 'C_vs_B', mean: 0.384, low: 0.3, high: 0.46 }),
      ]),
    )
    render(<Overview />)
    expect(
      await screen.findByText(
        (_, el) =>
          el?.tagName === 'LI' &&
          el.textContent ===
            'A pointer, not a result. On questions that use a country\'s own name for something, Text search found about 17 more of every 100 needed facts than Graph, and Graph + Ontology found about 38 more of every 100 needed facts than Graph. For example, Austria calls its national draw "Zahlenziehung". We did not test this group, so treat it as a lead to follow up.',
      ),
    ).toBeVisible()
  })

  it('states each clear result, the rest of the tests and each hint in plain words, with a link to Results', async () => {
    stubApi(
      withComparisons([
        comparison({
          stratum: 'H1',
          comparison: 'B_vs_A',
          mean: 0.2206,
          low: 0.104,
          high: 0.341,
          p_holm: 0.03,
        }),
        comparison({}),
        comparison({ metric: 'answer', mean: 0.21, low: 0.07, high: 0.36 }),
        comparison({
          stratum: 'H5',
          comparison: 'B_vs_A',
          mean: -0.069,
          low: -0.121,
          high: -0.025,
          p_holm: 0.229,
        }),
        comparison({
          stratum: 'H1',
          comparison: 'B_vs_A',
          metric: 'answer',
          mean: 0.124,
          low: 0.036,
          high: 0.222,
          p_holm: 0.174,
        }),
        comparison({ mean: 0, low: -0.068, high: 0.048, p_holm: 1 }),
        comparison({
          stratum: 'H2_name',
          comparison: 'B_vs_A',
          clusters: 12,
          mean: -0.167,
          low: -0.21,
          high: -0.12,
          p: null,
          p_holm: null,
          in_family: false,
          reason: 'not_in_family',
        }),
      ]),
    )
    render(<Overview />)
    const panel = await screen.findByRole('region', { name: 'What we found' })
    const items = (await within(panel).findAllByRole('listitem')).map(
      (li) => li.textContent,
    )
    expect(items).toEqual([
      'Graph did better on questions that need several linked records. For example: "which other countries had incidents on the same platform version as this one?" Graph found about 22 more of every 100 needed facts than Text search. This passed our statistical test, so it is unlikely to be luck.',
      'Nothing else is proven yet. We made 5 other checks, each comparing two approaches on one kind of question and one score. In 4, one approach came out ahead, but not by enough to rule out luck. Graph + Ontology did better on questions that match terms across countries, Text search on evidence for questions about hidden patterns, and Graph on answers to questions that need several linked records. In the other one the approaches were too close to call.',
      'A pointer, not a result. On questions that use a country\'s own name for something, Text search found about 17 more of every 100 needed facts than Graph. For example, Austria calls its national draw "Zahlenziehung". We did not test this group, so treat it as a lead to follow up.',
    ])
    expect(
      within(panel).getByRole('link', { name: 'Results' }),
    ).toHaveAttribute('href', '#/results')
    // Help, chapter 13, explains where each approach did best and why.
    expect(
      within(panel).getByRole('link', { name: 'what the results teach' }),
    ).toHaveAttribute('href', '#/help?section=lessons')
  })

  it('says there is no clear result when no test passes', async () => {
    stubApi(
      withComparisons([
        comparison({}),
        comparison({ mean: 0, low: -0.1, high: 0.1, p_holm: 1 }),
      ]),
    )
    render(<Overview />)
    expect(
      await screen.findByText(
        (_, el) =>
          el?.tagName === 'LI' &&
          el.textContent ===
            'No difference is proven yet. We made 2 checks, each comparing two approaches on one kind of question and one score. In 1, one approach came out ahead, but not by enough to rule out luck. Graph + Ontology did better on questions that match terms across countries. In the other one the approaches were too close to call.',
      ),
    ).toBeVisible()
  })

  it('says every check was too close to call when none came out ahead', async () => {
    stubApi(
      withComparisons([
        comparison({ mean: 0, low: -0.1, high: 0.1, p_holm: 1 }),
        comparison({ mean: 0.01, low: -0.05, high: 0.07, p_holm: 1 }),
      ]),
    )
    render(<Overview />)
    expect(
      await screen.findByText(
        (_, el) =>
          el?.tagName === 'LI' &&
          el.textContent ===
            'No difference is proven yet. We made 2 checks, each comparing two approaches on one kind of question and one score. In all of them the approaches were too close to call.',
      ),
    ).toBeVisible()
  })

  it('states no findings for a run with no comparisons', async () => {
    stubApi(base(OFFICIAL))
    render(<Overview />)
    await screen.findByTestId('tile-A')
    expect(screen.queryByText(/comparisons? we tested/)).toBeNull()
    expect(screen.queryByText(/passed our statistical test/)).toBeNull()
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
    const panel = screen.getByRole('region', { name: 'What we found' })
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
