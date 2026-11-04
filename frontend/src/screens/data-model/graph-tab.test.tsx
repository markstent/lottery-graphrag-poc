import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { failure, json, stubApi } from '../../test/api-stub'
import {
  DATASET,
  DICTIONARY,
  GAME_NODE,
  GAME_ROWS,
  NEIGHBOURS,
  SCHEMA,
  STATS,
} from './data-model.fixtures'
import { GraphTab } from './graph-tab'

const ROUTES = {
  '/api/v1/graph/schema': SCHEMA,
  '/api/v1/graph/stats': STATS,
  '/api/v1/datasets': [DATASET],
  '/api/v1/datasets/dev-seed2026/dictionary': DICTIONARY,
  '/api/v1/datasets/dev-seed2026/tables/games/rows': GAME_ROWS(0, 1),
  '/api/v1/graph/nodes/GAME_001': GAME_NODE,
  '/api/v1/graph/nodes/GAME_001/neighbours': NEIGHBOURS(),
}

const params = (query = '') => new URLSearchParams(query)
const renderTab = (query = '') =>
  render(<GraphTab params={params(query)} scale={1} />)

beforeEach(() => window.history.replaceState(null, '', '/#/data-model'))
afterEach(() => vi.unstubAllGlobals())

describe('Graph tab map', () => {
  it('shows a loading state, then each kind of record with its count', async () => {
    stubApi(ROUTES)
    renderTab()
    expect(screen.getByRole('status')).toHaveTextContent(
      'Loading Kinds of record',
    )
    expect(
      await screen.findByRole('button', { name: 'game, 120 records' }),
    ).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'market, 4 records' }),
    ).toBeVisible()
  })

  it('shows every link first, and a table of each kind of link: what it joins, how many, who follows it and why', async () => {
    stubApi(ROUTES)
    renderTab()
    await screen.findByRole('button', { name: 'game, 120 records' })
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
    expect(
      table.getByRole('rowheader', { name: 'game is similar to game' }),
    ).toBeVisible()
  })

  it('says why a kind of link is followed by neither approach', async () => {
    stubApi({
      ...ROUTES,
      '/api/v1/graph/schema': {
        ...SCHEMA,
        allow_list: { B: ['AFFECTS'], C: ['AFFECTS'] },
      },
    })
    renderTab()
    const table = within(
      await screen.findByRole('region', { name: 'Kinds of link' }),
    )
    expect(
      table
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent)
        .slice(3),
    ).toEqual([
      'Followed by Graph and Graph + Ontology',
      'Followed by neither - Left out to keep the search focused: these are many, or lead to many records.',
    ])
  })

  it('says dashed lines are followed by neither approach only when the map draws any', async () => {
    stubApi(ROUTES)
    renderTab()
    await screen.findByRole('button', { name: 'game, 120 records' })
    expect(screen.queryByText(/Dashed grey/)).toBeNull()
    await userEvent.click(screen.getByRole('radio', { name: 'B · Graph' }))
    expect(screen.queryByText(/Dashed grey/)).toBeNull()
  })

  it('says it when a line followed by neither approach is drawn', async () => {
    stubApi({
      ...ROUTES,
      '/api/v1/graph/schema': {
        ...SCHEMA,
        allow_list: { B: ['AFFECTS'], C: ['AFFECTS'] },
      },
    })
    renderTab()
    expect(
      await screen.findByText(
        /Dashed grey lines: followed by neither approach\./,
      ),
    ).toBeVisible()
  })

  it('narrows to what Graph follows, and to what Graph + Ontology follows', async () => {
    stubApi(ROUTES)
    renderTab()
    await screen.findByRole('button', { name: 'game, 120 records' })
    await userEvent.click(screen.getByRole('radio', { name: 'B · Graph' }))
    expect(
      screen.getByText('B · Graph follows 2 of the 4 kinds of link.'),
    ).toBeVisible()

    await userEvent.click(
      screen.getByRole('radio', { name: 'C · Graph + Ontology' }),
    )
    expect(
      screen.getByText(
        'C · Graph + Ontology follows 4 of the 4 kinds of link.',
      ),
    ).toBeVisible()
  })

  it('shows the properties and a sample node of a kind of record when it is chosen', async () => {
    stubApi(ROUTES)
    renderTab()
    expect(
      await screen.findByText(/Choose a box for its details\./),
    ).toBeVisible()
    expect(screen.queryByRole('dialog')).toBeNull()
    await userEvent.click(
      await screen.findByRole('button', { name: 'game, 120 records' }),
    )
    const details = await screen.findByRole('region', { name: 'Details' })
    expect(await within(details).findByText('Albion Millions 1')).toBeVisible()
    expect(within(details).getByText('market id')).toBeVisible()
    expect(within(details).queryByText('source record id')).toBeNull()
    expect(within(details).getByText('id')).toBeVisible()
    expect(within(details).getByText(/^Built from games\./)).toBeVisible()
    expect(
      within(details).getByRole('link', {
        name: 'Open this node in the graph',
      }),
    ).toHaveAttribute('href', '#/data-model?tab=graph&node=GAME_001')
  })

  it('lists a kind with no relationship apart from the map, and it opens like the others', async () => {
    stubApi({
      ...ROUTES,
      '/api/v1/graph/schema': {
        ...SCHEMA,
        labels: [...SCHEMA.labels, 'Currency'],
      },
      '/api/v1/graph/stats': {
        ...STATS,
        nodes_by_label: { ...STATS.nodes_by_label, Currency: 3 },
      },
    })
    renderTab()
    const apart = await screen.findByRole('region', {
      name: 'Kinds with no links',
    })
    await userEvent.click(
      within(apart).getByRole('button', { name: 'currency, 3 records' }),
    )
    expect(
      await screen.findByRole('dialog', { name: 'currency' }),
    ).toBeVisible()
  })

  it('tags only the relationships of the chosen kind, and keeps it chosen when the details close', async () => {
    stubApi(ROUTES)
    const { container } = renderTab()
    await screen.findByRole('button', { name: 'game, 120 records' })
    const tagged = () =>
      [...container.querySelectorAll('g[data-edge-id]')]
        .filter((g) => g.querySelector('text'))
        .map((g) => g.getAttribute('data-edge-id'))
    expect(tagged()).toEqual([])

    await userEvent.click(
      screen.getByRole('button', { name: 'game, 120 records' }),
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(
      screen.getByRole('button', { name: 'game, 120 records' }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(tagged()).toEqual([
      'AFFECTS:Incident>Game',
      'AVAILABLE_IN:Game>Market',
      'MAPS_TO:Game>BusinessConcept',
    ])

    await userEvent.click(
      screen.getByRole('button', { name: 'Show all relationships' }),
    )
    expect(tagged()).toEqual([])
  })

  it('says plainly that a kind built from the ontology has no sample', async () => {
    stubApi(ROUTES)
    renderTab()
    await userEvent.click(
      await screen.findByRole('button', {
        name: 'business concept, 30 records',
      }),
    )
    expect(
      await screen.findByText('Built from the ontology: no sample row.'),
    ).toBeVisible()
  })

  it('shows an error when the sample cannot be read', async () => {
    stubApi({
      ...ROUTES,
      '/api/v1/graph/nodes/GAME_001': () =>
        failure('The graph is not answering.', true),
    })
    renderTab()
    await userEvent.click(
      await screen.findByRole('button', { name: 'game, 120 records' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The graph is not answering.',
    )
  })

  it('says plainly when the graph has not been built, and when the request fails', async () => {
    stubApi({
      ...ROUTES,
      '/api/v1/graph/schema': { ...SCHEMA, labels: [] },
    })
    const empty = renderTab()
    expect(await screen.findByText('None yet.')).toBeVisible()
    empty.unmount()

    let fail = true
    stubApi({
      ...ROUTES,
      '/api/v1/graph/stats': () =>
        fail ? failure('The graph is unavailable.', true) : json(STATS),
    })
    renderTab()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The graph is unavailable.',
    )
    fail = false
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(
      await screen.findByRole('button', { name: 'game, 120 records' }),
    ).toBeVisible()
  })
})

describe('Graph tab focused node', () => {
  it('shows the node with a bounded set of neighbours and what links them', async () => {
    const fetchSpy = stubApi(ROUTES)
    renderTab('node=GAME_001')
    expect(
      await screen.findByRole('button', { name: 'Albion Millions 1, game' }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(
      await screen.findByRole('button', { name: 'INC_007, incident' }),
    ).toBeVisible()
    expect(
      screen.getByText('INC_007 affects Albion Millions 1'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Albion Millions 1 is available in United Kingdom'),
    ).toBeInTheDocument()
    const neighbourCall = fetchSpy.mock.calls
      .map(([input]) => String(input))
      .find((url) => url.includes('/neighbours'))
    expect(neighbourCall).toContain('limit=20')
    expect(screen.queryByText(/has more/)).toBeNull()
    expect(
      screen.getByRole('link', { name: 'All kinds of record' }),
    ).toHaveAttribute('href', '#/data-model?tab=graph')
    expect(screen.getByText('Built from games, row GAME_001')).toBeVisible()
  })

  it('says when the node has more neighbours than are shown', async () => {
    stubApi({
      ...ROUTES,
      '/api/v1/graph/nodes/GAME_001/neighbours': NEIGHBOURS(true),
    })
    renderTab('node=GAME_001')
    expect(await screen.findByText('Showing the first 20.')).toBeVisible()
  })

  it('moves to a neighbour when it is chosen', async () => {
    stubApi(ROUTES)
    renderTab('node=GAME_001')
    await userEvent.click(
      await screen.findByRole('button', { name: 'INC_007, incident' }),
    )
    expect(window.location.hash).toBe('#/data-model?tab=graph&node=INC_007')
  })

  it('shows an error with the server message when the node is not found', async () => {
    stubApi({
      ...ROUTES,
      '/api/v1/graph/nodes/NOPE': () =>
        json(
          {
            error: {
              error_code: 'NOT_FOUND',
              message: 'no graph node with id NOPE',
              retryable: false,
            },
          },
          404,
        ),
    })
    renderTab('node=NOPE')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'no graph node with id NOPE',
    )
    expect(
      screen.getByRole('link', { name: 'All kinds of record' }),
    ).toBeVisible()
  })

  it('shows a loading state while the node is read', async () => {
    stubApi({
      ...ROUTES,
      '/api/v1/graph/nodes/GAME_001': () =>
        new Promise<Response>(() => undefined),
    })
    renderTab('node=GAME_001')
    expect(screen.getByRole('status')).toHaveTextContent('Loading Node')
  })
})
