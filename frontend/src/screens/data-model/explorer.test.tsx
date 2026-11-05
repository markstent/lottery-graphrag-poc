import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { AboutContent } from './about'
import { graphAbout } from './about-copy'
import { Explorer, ListSearch, PickList } from './explorer'

const renderExplorer = () =>
  render(
    <Explorer
      steps={['Choose a table', 'Its rows', 'The record']}
      about={<p>The tables are made up for this test.</p>}
      list={<p>the list</p>}
      main={<p>the rows</p>}
      detail={<p>the record</p>}
    />,
  )

const GROUPS = [
  {
    name: 'Incident management',
    items: [
      { id: 'incidents', title: 'incidents', detail: '44' },
      { id: 'incident_game_map', title: 'incident game map', detail: '84' },
    ],
  },
  {
    name: 'Warehouse',
    items: [
      { id: 'games', title: 'games', detail: '20' },
      { id: 'players', title: 'players', detail: '10,000' },
    ],
  },
]

describe('Explorer', () => {
  it('lays out three columns, each a section named by its numbered step', () => {
    renderExplorer()
    const choose = screen.getByRole('region', { name: '1 Choose a table' })
    expect(choose).toHaveTextContent('the list')
    expect(
      screen.getByRole('region', { name: '2 Its rows' }),
    ).toHaveTextContent('the rows')
    expect(
      screen.getByRole('region', { name: '3 The record' }),
    ).toHaveTextContent('the record')
    expect(
      screen.getByRole('heading', { name: '1 Choose a table' }),
    ).toBeVisible()
  })

  it('opens "About this" in a drawer that Escape closes', async () => {
    const user = userEvent.setup()
    renderExplorer()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    const about = screen.getByRole('button', { name: 'About this' })
    await user.click(about)
    const dialog = screen.getByRole('dialog', { name: 'About this' })
    expect(dialog).toHaveTextContent('The tables are made up for this test.')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(about).toHaveFocus()
  })
})

describe('AboutContent', () => {
  it("draws a layer's copy as headed lists, with the API's figures", () => {
    render(
      <AboutContent
        copy={graphAbout({ max_depth: 3, max_total_nodes: 150 })}
      />,
    )
    expect(
      screen.getByRole('heading', { name: 'How the graph is built' }),
    ).toBeVisible()
    expect(
      screen.getByRole('region', { name: 'Where the links come from' }),
    ).toHaveTextContent('No AI model makes them.')
    expect(screen.getByText(/at most 3 steps and 150 records/)).toBeVisible()
  })
})

describe('ListSearch', () => {
  it('is a labelled search box that reports what is typed', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ListSearch label="Find a table" value="" onChange={onChange} />)
    await user.type(
      screen.getByRole('searchbox', { name: 'Find a table' }),
      'g',
    )
    expect(onChange).toHaveBeenCalledWith('g')
  })
})

function Pick({ onChoose }: { onChoose: (id: string) => void }) {
  const [chosen, setChosen] = useState('incidents')
  return (
    <PickList
      label="Find a table"
      groups={GROUPS}
      chosen={chosen}
      onChoose={(id) => {
        setChosen(id)
        onChoose(id)
      }}
    />
  )
}

describe('PickList', () => {
  it('shows each group and marks the chosen item', () => {
    render(<Pick onChoose={vi.fn()} />)
    expect(screen.getByText('Incident management')).toBeVisible()
    expect(screen.getByText('Warehouse')).toBeVisible()
    expect(screen.getByRole('button', { name: /^incidents/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: /^games/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('calls onChoose with the item chosen, by pointer or keyboard', async () => {
    const user = userEvent.setup()
    const onChoose = vi.fn()
    render(<Pick onChoose={onChoose} />)
    await user.click(screen.getByRole('button', { name: /^games/ }))
    expect(onChoose).toHaveBeenLastCalledWith('games')
    expect(screen.getByRole('button', { name: /^games/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    screen.getByRole('button', { name: /^players/ }).focus()
    await user.keyboard('{Enter}')
    expect(onChoose).toHaveBeenLastCalledWith('players')
  })

  it('narrows the list as the reader types, hiding groups with no match', async () => {
    const user = userEvent.setup()
    render(<Pick onChoose={vi.fn()} />)
    await user.type(
      screen.getByRole('searchbox', { name: 'Find a table' }),
      'PLAY',
    )
    const buttons = screen.getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual(['players10,000'])
    expect(screen.queryByText('Incident management')).not.toBeInTheDocument()
    expect(
      within(screen.getByText('Warehouse').parentElement!).getByRole('button'),
    ).toBeVisible()
  })

  it('says "No match" when the search finds nothing', async () => {
    const user = userEvent.setup()
    render(<Pick onChoose={vi.fn()} />)
    await user.type(
      screen.getByRole('searchbox', { name: 'Find a table' }),
      'zzz',
    )
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.getByText('No match')).toBeVisible()
  })
})
