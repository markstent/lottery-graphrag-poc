import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { Schemas } from '../../api/client'
import { RECORDINGS } from '../../test/recordings'
import { Scorecard } from './scorecard'

type Results = Schemas['QueryResults']

const h1 = RECORDINGS.find((run) => run.stratum === 'H1')!.results
const h3 = RECORDINGS.find((run) => run.stratum === 'H3')!.results

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

/** Results with chosen answer writing time and context size per pipeline. */
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
      'Evidence recall',
      'Starting record',
      'Markets reached',
      'Answer writing time',
      'Context size',
      'Reason',
    ])
  })

  it('says the score is against the answer key, once, for a scored bank question', () => {
    render(<Scorecard results={h1} />)
    expect(screen.getAllByText('scored against the answer key')).toHaveLength(1)
    expect(screen.queryByText(/Not scored: this wording/)).toBeNull()
  })

  it('shows each pipeline answer, evidence found and starting record from the run score', () => {
    render(<Scorecard results={h1} />)
    expect(cells('Answer')).toEqual([
      'Partly correct (50%)',
      'Partly correct (40%)',
      'Partly correct (40%)',
    ])
    expect(cells('Evidence recall')).toEqual([
      '0.00',
      '1.00 | +1.00 vs A',
      '1.00 | +1.00 vs A',
    ])
    expect(cells('Starting record')).toEqual(['Yes', 'Yes', 'Yes'])
  })

  it('takes the answer from the score, so a changed score changes the card', () => {
    const changed = structuredClone(h1) as Results
    changed.score!.per_pipeline.C.answer = 0.5
    changed.score!.per_pipeline.B.answer = 1
    render(<Scorecard results={changed} />)
    expect(cells('Answer')).toEqual([
      'Partly correct (50%)',
      'Correct',
      'Partly correct (50%)',
    ])
  })

  it('gives the one-line reason from the failure class in plain words', () => {
    render(<Scorecard results={h1} />)
    expect(cells('Reason')).toEqual([
      'The needed evidence was not retrieved',
      'The evidence was retrieved but the answer was wrong',
      'The evidence was retrieved but the answer was wrong',
    ])
  })

  it('shows a null measure as missing, never as 0', () => {
    render(<Scorecard results={h3} />)
    expect(cells('Evidence recall')).toEqual(['Missing', 'Missing', 'Missing'])
    expect(cells('Answer')).toEqual(['Correct', 'Correct', 'Correct'])
    expect(cells('Reason')).toEqual([
      'No failure recorded',
      'No failure recorded',
      'No failure recorded',
    ])
  })

  it('shows answer writing time and context size, with deltas against A for B and C only', () => {
    render(
      <Scorecard
        results={measured({
          A: [10000, 1400],
          B: [4000, 1500],
          C: [10000, 1400],
        })}
      />,
    )
    expect(cells('Answer writing time')).toEqual([
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

  it('shows an answer writing time of none as "<1 ms", never "0 s"', () => {
    render(
      <Scorecard
        results={measured({ A: [0, 1400], B: [0, 1500], C: [250, 1400] })}
      />,
    )
    expect(cells('Answer writing time')).toEqual([
      '<1 ms',
      '<1 ms | same as A',
      '250 ms | +250 ms vs A',
    ])
  })

  it('shows the delta of an evidence score against A as a signed difference on its 0 to 1 scale', () => {
    const changed = structuredClone(h1) as Results
    changed.score!.per_pipeline.B.evidence_recall = 0.4
    changed.score!.per_pipeline.C.evidence_recall = 0
    render(<Scorecard results={changed} />)
    expect(cells('Evidence recall')).toEqual([
      '0.00',
      '0.40 | +0.40 vs A',
      '0.00 | same as A',
    ])
  })

  it('shows no delta when either side is missing', () => {
    const changed = structuredClone(h1) as Results
    changed.score!.per_pipeline.B.evidence_recall = null
    changed.score!.per_pipeline.C.evidence_recall = 0.2
    render(<Scorecard results={changed} />)
    expect(cells('Evidence recall')).toEqual([
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
      screen.getByText('Not scored: this wording is not in the tested set.'),
    ).toBeVisible()
    expect(screen.queryByText('scored against the answer key')).toBeNull()
    for (const name of [
      'Answer writing time',
      'Context size',
      'Markets reached',
    ])
      expect(hasColumn(name)).toBe(true)
    for (const name of [
      'Answer',
      'Evidence recall',
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
    expect(cells('Answer writing time')[2]).toBe('No result')
  })
})
