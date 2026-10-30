import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { failure, json, stubApi } from '../../test/api-stub'
import { DATASET, DICTIONARY, GAME_ROWS } from './data-model.fixtures'
import { groupBySystem } from './model'
import { Warehouse } from './warehouse'

const ROUTES = {
  '/api/v1/datasets': [DATASET],
  '/api/v1/datasets/dev-seed2026/dictionary': DICTIONARY,
  '/api/v1/datasets/dev-seed2026/tables/games/rows': GAME_ROWS(0, 50),
}

const RECORD = {
  table: 'games',
  row: { game_id: 'GAME_001', name: 'Albion Millions 1' },
  graph_node_id: 'GAME_001',
  edges: [],
  graph_error: null,
}

const params = (query = '') => new URLSearchParams(query)

beforeEach(() => window.history.replaceState(null, '', '/#/data-model'))
afterEach(() => vi.unstubAllGlobals())

describe('groupBySystem', () => {
  it('groups tables by source system in the order the dictionary gives them', () => {
    expect(
      groupBySystem(DICTIONARY).map((g) => [
        g.system,
        g.tables.map((t) => t.table),
      ]),
    ).toEqual([
      ['warehouse', ['markets', 'games', 'tickets']],
      ['incident_management', ['incidents']],
    ])
  })
})

describe('Warehouse map', () => {
  it('shows a loading state, then one group per source system in plain words', async () => {
    stubApi(ROUTES)
    render(<Warehouse params={params()} scale={1} />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading Tables')
    const warehouse = await screen.findByRole('region', { name: 'Warehouse' })
    expect(
      await within(warehouse).findByRole('button', { name: 'games, 120 rows' }),
    ).toBeVisible()
    expect(
      await within(warehouse).findByRole('button', {
        name: 'tickets, 5,400 rows',
      }),
    ).toBeVisible()
    const incidents = screen.getByRole('region', {
      name: 'Incident management',
    })
    expect(
      await within(incidents).findByRole('button', {
        name: 'incidents, 25 rows',
      }),
    ).toBeVisible()
    expect(within(warehouse).queryByText('incidents')).toBeNull()
  })

  it('draws the links between tables of one system and lists them in words', async () => {
    stubApi(ROUTES)
    render(<Warehouse params={params()} scale={1} />)
    expect(
      await screen.findByText('games links to markets'),
    ).toBeInTheDocument()
    expect(screen.getByText('tickets links to games')).toBeInTheDocument()
  })

  it('opens a table from the map', async () => {
    stubApi(ROUTES)
    render(<Warehouse params={params()} scale={1} />)
    await userEvent.click(
      await screen.findByRole('button', { name: 'games, 120 rows' }),
    )
    expect(window.location.hash).toBe('#/data-model?tab=warehouse&table=games')
  })

  it('says plainly when there is no world, and when the request fails', async () => {
    stubApi({ '/api/v1/datasets': [] })
    const empty = render(<Warehouse params={params()} scale={1} />)
    expect(
      await screen.findByText('No data has been generated yet.'),
    ).toBeVisible()
    empty.unmount()

    stubApi({ ...ROUTES, '/api/v1/datasets/dev-seed2026/dictionary': [] })
    const noTables = render(<Warehouse params={params()} scale={1} />)
    expect(
      await screen.findByText('No data has been generated yet.'),
    ).toBeVisible()
    noTables.unmount()

    let fail = true
    stubApi({
      ...ROUTES,
      '/api/v1/datasets': () =>
        fail ? failure('The warehouse is unavailable.', true) : json([DATASET]),
    })
    render(<Warehouse params={params()} scale={1} />)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The warehouse is unavailable.',
    )
    fail = false
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(
      await screen.findByRole('button', { name: 'games, 120 rows' }),
    ).toBeVisible()
  })
})

describe('Warehouse table and record', () => {
  it('shows the table with its source, its links and its rows, and a way back to the map', async () => {
    stubApi(ROUTES)
    render(<Warehouse params={params('table=games')} scale={1} />)
    expect(await screen.findByRole('heading', { name: 'games' })).toBeVisible()
    expect(
      screen.getByText(/^Source: Warehouse · 120 rows · 4 columns/),
    ).toBeVisible()
    expect(screen.getByRole('link', { name: 'markets' })).toHaveAttribute(
      'href',
      '#/data-model?tab=warehouse&table=markets',
    )
    expect(await screen.findByText('Rows 1 to 50 of 120')).toBeVisible()
    expect(screen.getByRole('link', { name: 'All tables' })).toHaveAttribute(
      'href',
      '#/data-model?tab=warehouse',
    )
  })

  it('says plainly when the table is not in the dictionary', async () => {
    stubApi(ROUTES)
    render(<Warehouse params={params('table=nothing')} scale={1} />)
    expect(
      await screen.findByText('There is no table called nothing.'),
    ).toBeVisible()
  })

  it('opens a row as a record, and follows it into the graph when it has a node', async () => {
    stubApi({
      ...ROUTES,
      '/api/v1/datasets/dev-seed2026/tables/games/rows/GAME_001': RECORD,
    })
    render(<Warehouse params={params('table=games')} scale={1} />)
    await userEvent.click(
      await screen.findByRole('button', { name: 'Open GAME_001' }),
    )
    const dialog = await screen.findByRole('dialog', { name: 'Evidence' })
    expect(
      await within(dialog).findByRole('link', {
        name: 'Follow into the graph',
      }),
    ).toHaveAttribute('href', '#/data-model?tab=graph&node=GAME_001')
  })

  it('says plainly that a row has no node in the graph when it has none', async () => {
    stubApi({
      ...ROUTES,
      '/api/v1/datasets/dev-seed2026/tables/games/rows/GAME_001': {
        ...RECORD,
        graph_node_id: null,
      },
    })
    render(<Warehouse params={params('table=games')} scale={1} />)
    await userEvent.click(
      await screen.findByRole('button', { name: 'Open GAME_001' }),
    )
    const dialog = await screen.findByRole('dialog', { name: 'Evidence' })
    expect(
      await within(dialog).findByText('This row has no graph node.'),
    ).toBeVisible()
    expect(within(dialog).queryByRole('link')).toBeNull()
  })
})
