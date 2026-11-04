import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { GraphWhy, OntologyWhy, ScenariosWhy, WarehouseWhy } from './why'

describe('the Data Model panels on how each layer is built', () => {
  it('gives the graph search limits from the API, not from the copy', () => {
    render(<GraphWhy caps={{ max_depth: 3, max_total_nodes: 150 }} />)
    expect(
      screen.getByRole('heading', { name: 'How the graph is built' }),
    ).toBeVisible()
    expect(screen.getByText(/at most 3 steps and 150 records/)).toBeVisible()
  })

  it('says where the graph links come from, in the three ways', () => {
    render(<GraphWhy caps={{ max_depth: 2, max_total_nodes: 200 }} />)
    const where = screen.getByRole('region', {
      name: 'Where the links come from',
    })
    expect(where).toHaveTextContent('No AI model makes them.')
    for (const way of [
      /^Copied from a column/,
      /^Counted from bulk rows/,
      /^Worked out by a rule/,
    ])
      expect(screen.getByText(way)).toBeVisible()
    expect(where).toHaveTextContent("the warehouse's own column links")
  })

  it('gives the ontology counts from the API, not from the copy', () => {
    render(<OntologyWhy concepts={40} bindings={110} />)
    expect(
      screen.getByRole('heading', { name: 'How the ontology is built' }),
    ).toBeVisible()
    expect(
      screen.getByText(/A shared dictionary of 40 business ideas/),
    ).toBeVisible()
    expect(screen.getByText(/^110 entries match each country/)).toBeVisible()
  })

  it('explains the warehouse and how to read its maps', () => {
    render(<WarehouseWhy />)
    expect(
      screen.getByRole('heading', { name: 'What the warehouse is' }),
    ).toBeVisible()
    expect(
      screen.getByRole('region', { name: 'How to read the maps' }),
    ).toHaveTextContent('Each box is a table')
  })

  it('explains a planted story and each part of its card', () => {
    render(<ScenariosWhy />)
    const card = screen.getByRole('region', { name: 'How to read a card' })
    for (const part of ['Strength:', 'Noise level:', 'Rows added:'])
      expect(card).toHaveTextContent(part)
  })
})
