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
  V03_INSTANCES,
  V03_RUN,
} from '../../results/results.fixtures'
import { DATASETS, failure, stubApi } from '../../test/api-stub'
import { Results } from './results'

const OFFICIAL_RUN: Schemas['BenchmarkRunOut'] = {
  run_id: 'fixture-official',
  run_kind: 'official',
  label: 'Fixture run (test values)',
  method_version: '0.3.0',
  started_at: '2026-10-20T09:00:00Z',
  selection: { strata: null, limit: null },
  worlds: [2026, 2027, 2028],
  headlines: OFFICIAL.headlines,
}

const summaryOf = (run_id: string, summary: Schemas['SummaryOut']) => ({
  run_id,
  run_kind: 'official',
  label: null,
  method_version: '0.3.0',
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
  '/api/v1/benchmarks/fixture-smoke': {
    ...summaryOf('fixture-smoke', SMOKE),
    run_kind: 'smoke',
  },
  '/api/v1/benchmarks/fixture-subset': summaryOf('fixture-subset', PILOT),
  '/api/v1/benchmarks/fixture-subset/instances': PILOT_INSTANCES,
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
    open('run=fixture-subset')
    const table = await questionTable()
    fireEvent.change(await table.findByRole('combobox', { name: 'World' }), {
      target: { value: '2026' },
    })
    expect(window.location.hash).toBe('#/results?run=fixture-subset&world=2026')
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
    open('run=fixture-subset')
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

  it('a field the run did not record reads Not recorded', async () => {
    stubApi(ROUTES)
    open('run=fixture-subset')
    const repro = within(
      await screen.findByRole('region', { name: 'Reproducibility' }),
    )
    const term = repro.getAllByText('generation_quantisation')[0]
    expect(term.nextElementSibling).toHaveTextContent('Not recorded')
    expect(repro.getByRole('link', { name: 'Raw record' })).toHaveAttribute(
      'href',
      '/api/v1/benchmarks/fixture-subset',
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
      '/api/v1/benchmarks/fixture-subset/instances': () =>
        failure('This run has no per-question results.', false, 404),
    })
    open('run=fixture-subset')
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
    open('run=fixture-subset')
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
    open('run=fixture-smoke')
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

describe('a run with every comparison, a judge and groundedness', () => {
  const V03_LISTED: Schemas['BenchmarkRunOut'] = {
    run_id: V03_RUN.run_id,
    run_kind: V03_RUN.run_kind,
    label: V03_RUN.label,
    method_version: V03_RUN.method_version,
    started_at: '2026-11-02T09:00:00Z',
    selection: { strata: null, limit: null },
    worlds: V03_RUN.summary.worlds,
    headlines: V03_RUN.summary.headlines,
  }
  const routes = {
    ...ROUTES,
    '/api/v1/benchmarks': [V03_LISTED, OFFICIAL_RUN, ...CAPTURED_RUNS],
    [`/api/v1/benchmarks/${V03_RUN.run_id}`]: V03_RUN,
    [`/api/v1/benchmarks/${V03_RUN.run_id}/instances`]: [],
  }
  const verdict = async () =>
    within(await screen.findByRole('region', { name: 'Verdict' }))

  it('a run compares evidence recall and C against A without a test, and names no method', async () => {
    stubApi(routes)
    open(`run=${V03_RUN.run_id}`)
    expect(
      await (await verdict()).findByText('Evidence recall: A · Text search'),
    ).toBeVisible()
    expect(screen.queryByText(/Method v0/)).toBeNull()
    const scores = within(
      screen.getByRole('region', { name: 'Scores by kind of question' }),
    )
    expect(
      scores.getByRole('button', { name: 'Evidence recall' }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(
      scores.getAllByText(/: C against A$/, { exact: false }).length,
    ).toBeGreaterThan(0)
  })

  it("a run's question table shows each question's evidence recall, never its F1", async () => {
    // F1 set apart from recall, so the cell shows which one it reads.
    const instances = structuredClone(V03_INSTANCES)
    for (const row of instances)
      for (const scores of Object.values(row.pipelines))
        if (scores) scores.evidence_f1 = 0.99
    stubApi({
      ...routes,
      [`/api/v1/benchmarks/${V03_RUN.run_id}/instances`]: instances,
    })
    open(`run=${V03_RUN.run_id}`)
    const table = await questionTable()
    const heads = await table.findAllByRole('columnheader', {
      name: 'Evidence recall',
    })
    expect(heads).toHaveLength(3)
    expect(table.queryByRole('columnheader', { name: 'Evidence' })).toBeNull()
    const first = instances[0]
    const row = table
      .getByRole('button', { name: `Details for ${first.instance_id}` })
      .closest('tr')!
    const cells = within(row)
      .getAllByRole('cell')
      .map((c) => c.textContent)
    // Question, kind, world, then answer, evidence and judge per approach.
    expect([cells[4], cells[7], cells[10]]).toEqual(
      (['A', 'B', 'C'] as const).map((id) =>
        first.pipelines[id]!.evidence_recall!.toFixed(2),
      ),
    )
    expect(table.queryByText('0.99')).toBeNull()
  })

  it("a question's details count the answers cut off and name the run's token limit", async () => {
    const instances = structuredClone(V03_INSTANCES)
    const first = instances[0]
    first.pipelines.A!.cut_off_repeats = 0
    first.pipelines.A!.token_limit_repeats = 0
    first.pipelines.B!.cut_off_repeats = null
    first.pipelines.B!.token_limit_repeats = null
    first.pipelines.C!.cut_off_repeats = 2
    first.pipelines.C!.token_limit_repeats = 1
    stubApi({
      ...routes,
      [`/api/v1/benchmarks/${V03_RUN.run_id}/instances`]: instances,
    })
    open(`run=${V03_RUN.run_id}`)
    const table = await questionTable()
    fireEvent.click(
      await table.findByRole('button', {
        name: `Details for ${first.instance_id}`,
      }),
    )
    const row = table.getByRole('rowheader', { name: 'Answers cut off' })
    // The limit is the run's recorded max_tokens (512 here), never a typed number.
    expect(
      within(row.closest('tr')!)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['0', 'Not recorded', '2 (1 at the 512-token limit)'])
  })

  it("a run recorded before the cut-off record says so in each approach's cell", async () => {
    stubApi({
      ...routes,
      [`/api/v1/benchmarks/${V03_RUN.run_id}/instances`]: V03_INSTANCES,
    })
    open(`run=${V03_RUN.run_id}`)
    const table = await questionTable()
    fireEvent.click(
      await table.findByRole('button', {
        name: `Details for ${V03_INSTANCES[0].instance_id}`,
      }),
    )
    const row = await table.findByRole('rowheader', {
      name: 'Answers cut off',
    })
    expect(
      within(row.closest('tr')!)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['Not recorded', 'Not recorded', 'Not recorded'])
  })

  it('a run splits judge agreement and shows groundedness', async () => {
    stubApi(routes)
    open(`run=${V03_RUN.run_id}`)
    const judge = within(await screen.findByRole('region', { name: 'Judge' }))
    expect(
      judge.getByRole('rowheader', { name: 'All questions, abstained' }),
    ).toBeVisible()
    expect(
      judge.getByRole('columnheader', { name: 'Weighted kappa' }),
    ).toBeVisible()
    expect(judge.getAllByText('Too few to say').length).toBeGreaterThan(0)
    const grounded = within(
      screen.getByRole('region', { name: 'Groundedness' }),
    )
    expect(grounded.getByText(/Descriptive, not tested/)).toBeVisible()
    expect(
      grounded.getByRole('rowheader', {
        name: 'All questions - C · Graph + Ontology',
      }),
    ).toBeVisible()
  })
})
