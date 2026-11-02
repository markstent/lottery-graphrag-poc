import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { GraphWhy, OntologyWhy } from './why'

describe('the Data Model panels on why it is built this way', () => {
  it('gives the graph search limits from the API, not from the copy', () => {
    render(<GraphWhy caps={{ max_depth: 3, max_total_nodes: 150 }} />)
    expect(
      screen.getByRole('heading', { name: 'Why the graph is built this way' }),
    ).toBeVisible()
    expect(screen.getByText(/at most 3 steps and 150 records/)).toBeVisible()
  })

  it('gives the ontology counts from the API, not from the copy', () => {
    render(<OntologyWhy concepts={40} bindings={110} />)
    expect(
      screen.getByRole('heading', {
        name: 'Why the ontology is built this way',
      }),
    ).toBeVisible()
    expect(
      screen.getByText(/one shared dictionary of 40 business ideas/),
    ).toBeVisible()
    expect(screen.getByText(/^110 links tie each country/)).toBeVisible()
  })
})
