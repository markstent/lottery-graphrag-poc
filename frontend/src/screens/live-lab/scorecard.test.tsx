import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { Schemas } from '../../api/client'
import { RECORDED_RUNS } from '../../run/recorded'
import { Scorecard } from './scorecard'

type Results = Schemas['QueryResults']

const h1 = RECORDED_RUNS.find((run) => run.stratum === 'H1')!.results
const h3 = RECORDED_RUNS.find((run) => run.stratum === 'H3')!.results

const adHoc = {
  ...h1,
  benchmark_instance_id: null,
  answer_key: 'none',
  score_status: 'not_applicable',
  score: null,
} as unknown as Results

const columnIndex = (name: string) =>
  within(screen.getByRole('table'))
    .getAllByRole('columnheader')
    .findIndex((head) => head.textContent === name)
const hasColumn = (name: string) => columnIndex(name) >= 0
/** One measure for A, B and C: the cell of each pipeline row under the column. */
const cells = (name: string) =>
  within(screen.getByRole('table'))
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[columnIndex(name)])
    .map((cell) =>
      Array.from(cell.children)
        .map((part) => part.textContent)
        .join(' | '),
    )

/** Results with chosen latency and context size per pipeline. */
const measured = (
  values: Record<'A' | 'B' | 'C', [number, number]>,
): Results => {
  const out = structuredClone(h3) as Results
  for (const id of ['A', 'B', 'C'] as const) {
    out.results![id].answer.latency_ms = values[id][0]
    out.results![id].answer.context_tokens = values[id][1]
  }
  return out
}

describe('Scorecard', () => {
  it('is a labelled region with a row per pipeline and a column per measure', () => {
    render(<Scorecard results={h1} />)
    const region = screen.getByRole('region', { name: 'Scorecard' })
    expect(region).toBeVisible()
    expect(
      within(region)
        .getAllByRole('rowheader')
        .map((h) => h.textContent),
    ).toEqual(['A · Text search', 'B · Graph', 'C · Graph + Ontology'])
    expect(
      within(region)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual([
      'Answer',
      'Evidence score',
      'Starting record',
      'Markets reached',
      'Latency',
      'Context size',
      'Reason',
    ])
  })

  it('says the score is against the answer key, once, for a scored bank question', () => {
    render(<Scorecard results={h1} />)
    expect(screen.getAllByText('scored against the answer key')).toHaveLength(1)
    expect(screen.queryByText(/No answer key exists/)).toBeNull()
  })

  it('shows each pipeline answer, evidence found and starting record from the run score', () => {
    render(<Scorecard results={h1} />)
    expect(cells('Answer')).toEqual([
      'Not correct',
      'Not correct',
      'Not correct',
    ])
    expect(cells('Evidence score')).toEqual([
      '0.00',
      '0.00 | same as A',
      '0.00 | same as A',
    ])
    expect(cells('Starting record')).toEqual(['Yes', 'Yes', 'Yes'])
  })

  it('takes the answer from the score, so a changed score changes the card', () => {
    const changed = structuredClone(h1) as Results
    changed.score!.per_pipeline.C.answer = 0.5
    changed.score!.per_pipeline.B.answer = 1
    render(<Scorecard results={changed} />)
    expect(cells('Answer')).toEqual([
      'Not correct',
      'Correct',
      'Partly correct (50%)',
    ])
  })

  it('gives the one-line reason from the failure class in plain words', () => {
    render(<Scorecard results={h1} />)
    expect(cells('Reason')).toEqual([
      'The needed evidence was not retrieved',
      'The needed evidence was not retrieved',
      'The needed evidence was not retrieved',
    ])
  })

  it('shows a null measure as missing, never as 0', () => {
    render(<Scorecard results={h3} />)
    expect(cells('Evidence score')).toEqual(['Missing', 'Missing', 'Missing'])
    expect(cells('Answer')).toEqual(['Correct', 'Correct', 'Correct'])
    expect(cells('Reason')).toEqual([
      'No failure recorded',
      'No failure recorded',
      'No failure recorded',
    ])
  })

  it('shows latency and context size, with deltas against A for B and C only', () => {
    render(
      <Scorecard
        results={measured({
          A: [10000, 1400],
          B: [4000, 1500],
          C: [10000, 1400],
        })}
      />,
    )
    expect(cells('Latency')).toEqual([
      '10.0 s',
      '4.0 s | -6.0 s vs A',
      '10.0 s | same as A',
    ])
    expect(cells('Context size')).toEqual([
      '1,400 tokens',
      '1,500 tokens | +100 vs A',
      '1,400 tokens | same as A',
    ])
  })

  it('shows the delta of a score against A in points', () => {
    const changed = structuredClone(h1) as Results
    changed.score!.per_pipeline.B.evidence_f1 = 0.4
    render(<Scorecard results={changed} />)
    expect(cells('Evidence score')).toEqual([
      '0.00',
      '0.40 | +0.40 vs A',
      '0.00 | same as A',
    ])
  })

  it('shows no delta when either side is missing', () => {
    const changed = structuredClone(h1) as Results
    changed.score!.per_pipeline.B.evidence_f1 = null
    changed.score!.per_pipeline.C.evidence_f1 = 0.2
    render(<Scorecard results={changed} />)
    expect(cells('Evidence score')).toEqual([
      '0.00',
      'Missing',
      '0.20 | +0.20 vs A',
    ])
  })

  it('counts the markets each pipeline reached', () => {
    render(<Scorecard results={h1} />)
    const counts = cells('Markets reached')
    expect(counts).toHaveLength(3)
    for (const text of counts) expect(text).toMatch(/^[0-4] of 4/)
  })

  it('for an ad hoc question shows the measurable items only and says there is no key', () => {
    render(<Scorecard results={adHoc} />)
    expect(
      screen.getByText('No answer key exists for this question.'),
    ).toBeVisible()
    expect(screen.queryByText('scored against the answer key')).toBeNull()
    for (const name of ['Latency', 'Context size', 'Markets reached'])
      expect(hasColumn(name)).toBe(true)
    for (const name of [
      'Answer',
      'Evidence score',
      'Starting record',
      'Reason',
    ])
      expect(hasColumn(name)).toBe(false)
  })

  it('says scoring has not finished while the score is pending', () => {
    render(
      <Scorecard
        results={{ ...h1, score_status: 'pending', score: null } as Results}
      />,
    )
    expect(screen.getByText('Scoring has not finished.')).toBeVisible()
    expect(screen.queryByText('scored against the answer key')).toBeNull()
  })

  it('says so when scoring failed', () => {
    render(
      <Scorecard
        results={{ ...h1, score_status: 'failed', score: null } as Results}
      />,
    )
    expect(screen.getByText('Scoring failed for this run.')).toBeVisible()
  })

  it('shows a dash for a pipeline with no result', () => {
    const partial = structuredClone(h1) as Results
    delete partial.results!.C
    render(<Scorecard results={partial} />)
    expect(cells('Latency')[2]).toBe('No result')
  })
})
