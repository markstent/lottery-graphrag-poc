import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Schemas } from '../../api/client'
import { failure, stubApi } from '../../test/api-stub'
import { DATASET, DICTIONARY, GAME_ROWS, SCHEMA } from './data-model.fixtures'
import { TablesTab } from './tables-tab'

const BASE = '/api/v1/datasets/dev-seed2026'

const INCIDENT_ROWS = (marketId: string | null = 'UK') => ({
  table: 'incidents',
  offset: 0,
  limit: 50,
  total: 25,
  rows: [
    {
      incident_id: 'INC_002',
      market_id: marketId,
      summary: 'Payment provider degraded',
    },
    { incident_id: 'INC_003', market_id: marketId, summary: 'Login slow' },
  ],
})

const INCIDENT: Schemas['RecordOut'] = {
  table: 'incidents',
  row: {
    incident_id: 'INC_002',
    market_id: 'UK',
    summary: 'Payment provider degraded',
  },
  graph_node_id: 'INC_002',
  edges: [
    { type: 'AFFECTS', direction: 'out', count: 3 },
    { type: 'AFFECTS_MARKET', direction: 'out', count: 1 },
    { type: 'RELATED_TO', direction: 'in', count: 24 },
    { type: 'RELATED_TO', direction: 'out', count: 1 },
    { type: 'REFERENCES', direction: 'in', count: 1 },
  ],
  graph_error: null,
}

const ROUTES = {
  '/api/v1/datasets': [DATASET],
  [`${BASE}/dictionary`]: DICTIONARY,
  '/api/v1/graph/schema': {
    ...SCHEMA,
    relationship_types: [
      ...SCHEMA.relationship_types,
      { type: 'AFFECTS_MARKET', from_label: 'Incident', to_label: 'Market' },
    ],
  },
  '/api/v1/data-model/example': { incident_id: 'INC_002' },
  [`${BASE}/tables/games/rows`]: GAME_ROWS(0, 3),
  [`${BASE}/tables/incidents/rows`]: INCIDENT_ROWS(),
  [`${BASE}/tables/incidents/rows/INC_002`]: INCIDENT,
}

const renderTab = (query = '') =>
  render(<TablesTab params={new URLSearchParams(query)} />)

beforeEach(() => window.history.replaceState(null, '', '/#/data-model'))
afterEach(() => vi.unstubAllGlobals())

describe('Tables tab', () => {
  it('lists the tables by source system, each with its row count, under three numbered steps', async () => {
    stubApi(ROUTES)
    renderTab('table=games')
    expect(
      await screen.findByRole('heading', { name: '1 Choose a table' }),
    ).toBeVisible()
    expect(screen.getByRole('heading', { name: '2 Its rows' })).toBeVisible()
    expect(screen.getByRole('heading', { name: '3 The record' })).toBeVisible()
    const list = within(
      screen.getByRole('region', { name: '1 Choose a table' }),
    )
    expect(
      list.getByRole('heading', { name: 'Incident management' }),
    ).toBeVisible()
    expect(list.getByRole('button', { name: /^games ?120/ })).toBeVisible()
    expect(list.getByRole('button', { name: /^tickets ?5,400/ })).toBeVisible()
    expect(list.getByRole('button', { name: /^incidents ?25/ })).toBeVisible()
  })

  it('narrows the list as the reader types', async () => {
    stubApi(ROUTES)
    renderTab('table=games')
    await screen.findByRole('button', { name: /^tickets ?5,400/ })
    await userEvent.type(screen.getByRole('searchbox'), 'tick')
    expect(
      screen.getByRole('button', { name: /^tickets ?5,400/ }),
    ).toBeVisible()
    expect(screen.queryByRole('button', { name: /^games ?120/ })).toBeNull()
  })

  it('finds a table by the words of its description', async () => {
    stubApi(ROUTES)
    renderTab('table=games')
    await screen.findByRole('button', { name: /^tickets ?5,400/ })
    await userEvent.type(screen.getByRole('searchbox'), 'outage')
    expect(screen.getByRole('button', { name: /^incidents/ })).toBeVisible()
    expect(screen.queryByRole('button', { name: /^tickets/ })).toBeNull()
  })

  it('says what a table holds under its name in the list and above its rows', async () => {
    stubApi(ROUTES)
    renderTab('table=games')
    const list = within(
      await screen.findByRole('region', { name: '1 Choose a table' }),
    )
    expect(
      list.getByText('Each ticket bought, with who bought it and when.'),
    ).toBeVisible()
    const rows = within(screen.getByRole('region', { name: '2 Its rows' }))
    expect(
      rows.getByText('Each game sold in a market, with its price and status.'),
    ).toBeVisible()
  })

  it('puts the chosen table, then the chosen row, in the address', async () => {
    stubApi(ROUTES)
    const { rerender } = renderTab('table=games')
    await userEvent.click(
      await screen.findByRole('button', { name: /^incidents ?25/ }),
    )
    expect(window.location.hash).toBe('#/data-model?tab=tables&table=incidents')
    rerender(<TablesTab params={new URLSearchParams('table=incidents')} />)
    await userEvent.click(
      await screen.findByRole('button', { name: 'Open INC_003' }),
    )
    expect(window.location.hash).toBe(
      '#/data-model?tab=tables&table=incidents&row=INC_003',
    )
  })

  it('marks the chosen table and the chosen row', async () => {
    stubApi(ROUTES)
    renderTab('table=incidents&row=INC_002')
    expect(
      await screen.findByRole('button', { name: /^incidents ?25/ }),
    ).toHaveAttribute('aria-pressed', 'true')
    const rows = await screen.findAllByRole('row')
    expect(
      rows.filter((row) => row.getAttribute('aria-current') === 'true'),
    ).toHaveLength(1)
  })

  it('makes a foreign-key value a link to the other table row, and leaves a none value as text', async () => {
    stubApi(ROUTES)
    const { unmount } = renderTab('table=incidents')
    expect(
      (await screen.findAllByRole('link', { name: 'UK' }))[0],
    ).toHaveAttribute('href', '#/data-model?tab=tables&table=markets&row=UK')
    unmount()
    stubApi({
      ...ROUTES,
      [`${BASE}/tables/incidents/rows`]: INCIDENT_ROWS(null),
    })
    renderTab('table=incidents')
    await screen.findByRole('button', { name: 'Open INC_003' })
    expect(screen.queryAllByRole('link', { name: 'none' })).toHaveLength(0)
    expect(screen.getAllByText('none').length).toBeGreaterThan(0)
  })

  it('shows the record in words, with its links counted and a way into the graph', async () => {
    stubApi(ROUTES)
    renderTab('table=incidents&row=INC_002')
    const record = within(
      await screen.findByRole('region', { name: '3 The record' }),
    )
    expect(await record.findByText('Payment provider degraded')).toBeVisible()
    expect(
      record.getByRole('heading', { name: 'Becomes these links in the graph' }),
    ).toBeVisible()
    const items = record.getAllByRole('listitem').map((li) => li.textContent)
    expect(items).toEqual([
      'affects 3 games',
      'affects 1 market',
      'is related to 25 others',
      '1 record refers to it',
    ])
    const button = record.getByRole('link', { name: 'Open in the graph' })
    expect(button).toHaveAttribute(
      'href',
      '#/data-model?tab=graph&node=INC_002',
    )
    // The way on comes before the fields, so it is never below the fold.
    expect(
      button.compareDocumentPosition(
        record.getByText('Payment provider degraded'),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('still words the links when the graph schema cannot be read', async () => {
    stubApi({
      ...ROUTES,
      '/api/v1/graph/schema': () => failure('The graph is down.', true),
    })
    renderTab('table=incidents&row=INC_002')
    expect(await screen.findByText('affects 3 records')).toBeVisible()
  })

  it('says a row has no graph record when it has no node, and gives no button', async () => {
    stubApi({
      ...ROUTES,
      [`${BASE}/tables/incidents/rows/INC_002`]: {
        ...INCIDENT,
        graph_node_id: null,
        edges: null,
      },
    })
    renderTab('table=incidents&row=INC_002')
    expect(
      await screen.findByText('This row is not in the graph.'),
    ).toBeVisible()
    expect(screen.queryByRole('link', { name: 'Open in the graph' })).toBeNull()
  })

  it('opens on the example incident when the address names no table', async () => {
    stubApi(ROUTES)
    renderTab()
    expect(
      await screen.findByRole('button', { name: /^incidents ?25/ }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(
      await screen.findByText('Becomes these links in the graph'),
    ).toBeVisible()
  })

  it('opens on the incidents table with no row chosen when the world has no example', async () => {
    stubApi({ ...ROUTES, '/api/v1/data-model/example': { incident_id: null } })
    renderTab()
    expect(
      await screen.findByText('Choose a row to see its record.'),
    ).toBeVisible()
    expect(
      screen.getByRole('button', { name: /^incidents ?25/ }),
    ).toHaveAttribute('aria-pressed', 'true')
  })

  it('opens on the incidents table with no row chosen when the example cannot be read', async () => {
    for (const status of [404, 503]) {
      stubApi({
        ...ROUTES,
        '/api/v1/data-model/example': () =>
          failure('The example is not answering.', true, status),
      })
      const { unmount } = renderTab()
      expect(
        await screen.findByText('Choose a row to see its record.'),
      ).toBeVisible()
      expect(
        screen.getByRole('button', { name: /^incidents ?25/ }),
      ).toHaveAttribute('aria-pressed', 'true')
      unmount()
      vi.unstubAllGlobals()
    }
  })

  it('says so in the rows column when the table is unknown', async () => {
    stubApi(ROUTES)
    renderTab('table=nonsense')
    expect(
      await screen.findByText('There is no table called nonsense.'),
    ).toBeVisible()
  })

  it('says so in the record column when the row is unknown', async () => {
    stubApi({
      ...ROUTES,
      [`${BASE}/tables/incidents/rows/INC_999`]: () =>
        failure('no incidents row with incident_id INC_999', false, 404),
    })
    renderTab('table=incidents&row=INC_999')
    expect(
      await screen.findByText('No row INC_999 in incidents.'),
    ).toBeVisible()
  })

  it('shows an error with a retry when the tables cannot be loaded', async () => {
    stubApi({
      ...ROUTES,
      [`${BASE}/dictionary`]: () => failure('The data is unavailable.', true),
    })
    renderTab('table=games')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The data is unavailable.',
    )
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible()
  })

  it('opens the layer explanation from About this', async () => {
    stubApi(ROUTES)
    renderTab('table=games')
    await userEvent.click(
      await screen.findByRole('button', { name: 'About this' }),
    )
    expect(
      await screen.findByRole('heading', { name: 'What the tables are' }),
    ).toBeVisible()
  })
})
