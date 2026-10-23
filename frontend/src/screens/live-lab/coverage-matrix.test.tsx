import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { Schemas } from '../../api/client'
import { coverage } from '../../run/coverage'
import { RECORDED_RUNS } from '../../run/recorded'
import { CoverageMatrix } from './coverage-matrix'

type Results = Schemas['QueryResults']
const h1 = RECORDED_RUNS.find((run) => run.stratum === 'H1')!.results

const cell = (market: string, pipeline: string) => {
  const table = screen.getByRole('table', { name: 'Market coverage' })
  const header = within(table)
    .getAllByRole('columnheader')
    .findIndex((h) => h.textContent?.startsWith(pipeline))
  const row = within(table).getByRole('row', { name: new RegExp(`^${market}`) })
  return within(row).getAllByRole('cell')[header]
}

describe('CoverageMatrix', () => {
  it('has a row per market and a column per pipeline', () => {
    render(<CoverageMatrix results={h1} />)
    const table = screen.getByRole('table', { name: 'Market coverage' })
    expect(
      within(table)
        .getAllByRole('rowheader')
        .map((h) => h.textContent),
    ).toEqual(['United Kingdom', 'Greece', 'Austria', 'Czech Republic'])
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['A · Text search', 'B · Graph', 'C · Graph + Ontology'])
  })

  it('marks reached and not reached in words, matching coverage(results)', () => {
    render(<CoverageMatrix results={h1} />)
    const reached = coverage(h1)
    const names = {
      MKT_UK: 'United Kingdom',
      MKT_GR: 'Greece',
      MKT_AT: 'Austria',
      MKT_CZ: 'Czech Republic',
    }
    for (const [id, name] of Object.entries(names))
      for (const pipeline of ['A', 'B', 'C'] as const)
        expect(cell(name, pipeline)).toHaveTextContent(
          reached[pipeline]!.includes(id) ? 'Reached' : 'Not reached',
        )
  })

  it('says no result for a pipeline that has none', () => {
    const partial = structuredClone(h1) as Results
    delete partial.results!.B
    render(<CoverageMatrix results={partial} />)
    expect(cell('Greece', 'B')).toHaveTextContent('No result')
  })

  it('explains in one line what counts as reached', () => {
    render(<CoverageMatrix results={h1} />)
    expect(
      screen.getByText(
        'A market is reached when evidence an approach used comes from it.',
      ),
    ).toBeVisible()
  })
})
