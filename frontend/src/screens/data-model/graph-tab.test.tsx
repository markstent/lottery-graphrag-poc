import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { SCHEMA, STATS } from './data-model.fixtures'
import { KindsOfLink } from './graph-tab'

const renderTable = (schema = SCHEMA) =>
  render(<KindsOfLink schema={schema} stats={STATS} />)

const rowHeaders = () =>
  within(screen.getByRole('region', { name: 'Kinds of link' }))
    .getAllByRole('rowheader')
    .map((cell) => cell.textContent)

describe('Kinds of link', () => {
  it('shows every kind of link first: what it joins, where it is made from, how many, and who follows it', () => {
    renderTable()
    expect(screen.getByRole('radio', { name: 'All links' })).toBeChecked()
    const table = within(screen.getByRole('region', { name: 'Kinds of link' }))
    expect(
      table.getByText(
        /A link joins two records, such as an incident and the game it affects\./,
      ),
    ).toBeVisible()
    expect(
      table.getAllByRole('columnheader').map((cell) => cell.textContent),
    ).toEqual([
      'What it links',
      'Made from',
      'How many',
      'Followed by Graph and Graph + Ontology',
      'Followed by Graph + Ontology only - These come from the ontology.',
    ])
    expect(
      table
        .getAllByRole('rowheader')
        .map((cell) => [
          cell.textContent,
          cell.nextSibling?.nextSibling?.textContent,
        ]),
    ).toEqual([
      ['incident affects game', '34'],
      ['game is available in market', '310'],
      ['game and market: each is an instance of business concept', '124'],
      ['game is similar to game', '60'],
    ])
    expect(
      table.getByRole('rowheader', { name: 'game is available in market' })
        .nextSibling,
    ).toHaveTextContent("Copied from the game's market column.")
  })

  it('says why a kind of link is followed by neither approach', () => {
    renderTable({ ...SCHEMA, allow_list: { B: ['AFFECTS'], C: ['AFFECTS'] } })
    expect(
      within(screen.getByRole('region', { name: 'Kinds of link' }))
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent)
        .slice(3),
    ).toEqual([
      'Followed by Graph and Graph + Ontology',
      'Followed by neither - Left out to keep the search focused: these are many, or lead to many records.',
    ])
  })

  it('narrows to what Graph follows, and to what Graph + Ontology follows', async () => {
    renderTable()
    await userEvent.click(screen.getByRole('radio', { name: 'B · Graph' }))
    expect(rowHeaders()).toEqual([
      'incident affects game',
      'game is available in market',
    ])
    await userEvent.click(
      screen.getByRole('radio', { name: 'C · Graph + Ontology' }),
    )
    expect(rowHeaders()).toHaveLength(4)
    await userEvent.click(screen.getByRole('radio', { name: 'All links' }))
    expect(rowHeaders()).toHaveLength(4)
  })
})
