import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Schemas } from '../../api/client'
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
import { GraphExplorer } from './graph-explorer'

const GRAPH_SCHEMA: Schemas['GraphSchema'] = {
  ...SCHEMA,
  labels: [...SCHEMA.labels, 'SupportCase', 'PrizeType'],
  node_tables: { ...SCHEMA.node_tables, SupportCase: 'support_cases' },
  relationship_types: [
    ...SCHEMA.relationship_types,
    { type: 'RELATED_TO', from_label: 'SupportCase', to_label: 'Incident' },
  ],
  allow_list: {
    B: [...(SCHEMA.allow_list.B ?? []), 'RELATED_TO'],
    C: [...(SCHEMA.allow_list.C ?? []), 'RELATED_TO'],
  },
  caps: { max_depth: 2, max_total_nodes: 200 },
}

const GRAPH_STATS: Schemas['GraphStats'] = {
  ...STATS,
  nodes_by_label: { ...STATS.nodes_by_label, SupportCase: 2038, PrizeType: 5 },
}

const supportCase = (i: number): Schemas['NeighbourOut'] => ({
  rel_type: 'RELATED_TO',
  direction: 'in',
  node: {
    node_id: `SC_${String(i).padStart(3, '0')}`,
    labels: ['SupportCase'],
    properties: { id: `SC_${String(i).padStart(3, '0')}` },
    provenance: null,
  },
})

const INCIDENT: Schemas['NodeOut'] = {
  node_id: 'INC_002',
  labels: ['Incident'],
  properties: { id: 'INC_002', title: 'Payments degraded' },
  provenance: { table: 'incidents', row_id: 'INC_002', dataset_id: 'd' },
  edges: [
    { type: 'AFFECTS', direction: 'out', count: 1 },
    { type: 'RELATED_TO', direction: 'in', count: 150 },
  ],
}

const AFFECTED_GAME: Schemas['NeighbourOut'] = {
  rel_type: 'AFFECTS',
  direction: 'out',
  node: GAME_NODE,
}

/** At most 100 neighbours a call, as the server; `type` and `direction` narrow them. */
const incidentNeighbours = (url: URL) => {
  const type = url.searchParams.get('type')
  const direction = url.searchParams.get('direction')
  const items =
    type === 'RELATED_TO' && direction === 'in'
      ? Array.from({ length: 100 }, (_, i) => supportCase(i))
      : type === 'AFFECTS' && direction === 'out'
        ? [AFFECTED_GAME]
        : type === null
          ? [
              AFFECTED_GAME,
              ...Array.from({ length: 99 }, (_, i) => supportCase(i)),
            ]
          : []
  return json({ node_id: 'INC_002', truncated: items.length === 100, items })
}

const CONCEPT: Schemas['NodeOut'] = {
  node_id: 'CONCEPT_DRAW',
  labels: ['BusinessConcept'],
  properties: { id: 'CONCEPT_DRAW', name: 'Draw game' },
  provenance: null,
  edges: [{ type: 'MAPS_TO', direction: 'in', count: 2 }],
}

const ROUTES = {
  '/api/v1/graph/schema': GRAPH_SCHEMA,
  '/api/v1/graph/stats': GRAPH_STATS,
  '/api/v1/data-model/example': { incident_id: 'INC_002' },
  '/api/v1/datasets': [DATASET],
  '/api/v1/datasets/dev-seed2026/dictionary': DICTIONARY,
  '/api/v1/datasets/dev-seed2026/tables/games/rows': GAME_ROWS(0, 1),
  '/api/v1/graph/nodes/INC_002': INCIDENT,
  '/api/v1/graph/nodes/INC_002/neighbours': incidentNeighbours,
  '/api/v1/graph/nodes/GAME_001': {
    ...GAME_NODE,
    edges: [
      { type: 'AFFECTS', direction: 'in', count: 1 },
      { type: 'AVAILABLE_IN', direction: 'out', count: 1 },
    ],
  },
  '/api/v1/graph/nodes/GAME_001/neighbours': NEIGHBOURS(),
  '/api/v1/graph/nodes/CONCEPT_DRAW': CONCEPT,
  '/api/v1/graph/nodes/CONCEPT_DRAW/neighbours': {
    node_id: 'CONCEPT_DRAW',
    truncated: false,
    items: [
      { rel_type: 'MAPS_TO', direction: 'in', node: GAME_NODE },
      {
        rel_type: 'MAPS_TO',
        direction: 'in',
        node: {
          node_id: 'UK',
          labels: ['Market'],
          properties: { id: 'UK', name: 'United Kingdom' },
          provenance: null,
        },
      },
    ],
  },
}

const renderTab = (query = '') =>
  render(<GraphExplorer params={new URLSearchParams(query)} scale={1} />)

const column = async (step: string) =>
  within(await screen.findByRole('region', { name: step }))
const LIST = '1 Choose a kind or find a record'
const MAIN = '2 The record and its neighbours'
const DETAIL = '3 Its details'

beforeEach(() => window.history.replaceState(null, '', '/#/data-model'))
afterEach(() => vi.unstubAllGlobals())

describe('Graph explorer', () => {
  it('opens on the example incident and its neighbours, under three numbered steps', async () => {
    stubApi(ROUTES)
    renderTab()
    expect(
      await screen.findByRole('button', {
        name: 'Payments degraded, incident',
      }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('heading', { name: LIST })).toBeVisible()
    expect(screen.getByRole('heading', { name: MAIN })).toBeVisible()
    expect(screen.getByRole('heading', { name: DETAIL })).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Albion Millions 1, game' }),
    ).toBeVisible()
    expect(
      (await column(LIST)).getByRole('button', { name: /^incident ?25$/ }),
    ).toHaveAttribute('aria-pressed', 'true')
  })

  it('folds many neighbours of one kind and link into one box, and keeps the few as records', async () => {
    stubApi(ROUTES)
    renderTab('node=INC_002')
    expect(
      await screen.findByRole('button', {
        name: '150 support cases, click to list them',
      }),
    ).toBeVisible()
    expect(screen.queryByRole('button', { name: /^SC_000/ })).toBeNull()
    expect(
      screen.getByText('150 support cases are related to Payments degraded'),
    ).toBeInTheDocument()
  })

  it('cuts a long name short in its box, so the drawing fits its column', async () => {
    stubApi({
      ...ROUTES,
      '/api/v1/graph/nodes/INC_002': {
        ...INCIDENT,
        properties: { title: 'Payment provider degraded in every market' },
      },
    })
    renderTab('node=INC_002')
    expect(
      await screen.findByRole('button', {
        name: 'Payment provider degr…, incident',
      }),
    ).toBeVisible()
    expect(
      (await column(MAIN)).getByText(
        'Payment provider degraded in every market',
      ),
    ).toBeVisible()
  })

  it('says where the record comes from, with a link to its table row, and its links by who follows them', async () => {
    stubApi(ROUTES)
    renderTab('node=INC_002')
    const detail = await column(DETAIL)
    expect(await detail.findByText('From incidents, row INC_002')).toBeVisible()
    expect(
      detail.getByRole('link', { name: 'See its table row' }),
    ).toHaveAttribute(
      'href',
      '#/data-model?tab=tables&table=incidents&row=INC_002',
    )
    const followed = detail.getByRole('region', {
      name: 'Followed by Graph and Graph + Ontology',
    })
    expect(
      within(followed)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['affects 1 game', 'is related to 150 others'])
  })

  it('opens a record by its id from the search box', async () => {
    stubApi(ROUTES)
    renderTab('node=INC_002')
    await userEvent.type(
      await (
        await column(LIST)
      ).findByRole('searchbox', {
        name: 'Find a record by id',
      }),
      'GAME_001',
    )
    await userEvent.click(
      (await column(LIST)).getByRole('button', { name: 'Open' }),
    )
    await vi.waitFor(() =>
      expect(window.location.hash).toBe('#/data-model?tab=graph&node=GAME_001'),
    )
  })

  it('says so when no record has the id searched for, and stays where it was', async () => {
    stubApi(ROUTES)
    renderTab('node=INC_002')
    await userEvent.type(
      await (
        await column(LIST)
      ).findByRole('searchbox', {
        name: 'Find a record by id',
      }),
      'NOPE{Enter}',
    )
    expect(
      await (await column(LIST)).findByText('No record with that id.'),
    ).toBeVisible()
    // Announced, so a screen reader hears that the search found nothing.
    expect((await column(LIST)).getByRole('status')).toHaveTextContent(
      'No record with that id.',
    )
    expect(window.location.hash).toBe('#/data-model')
  })

  it('says so when the address names a record that does not exist', async () => {
    stubApi(ROUTES)
    renderTab('node=NOPE')
    expect(
      await (await column(MAIN)).findByText('No record with that id.'),
    ).toBeVisible()
  })

  it('opens a sample of the kind the address names, when it names no record', async () => {
    const fetchSpy = stubApi(ROUTES)
    renderTab('kind=Game')
    expect(
      await screen.findByRole('button', { name: 'Albion Millions 1, game' }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(
      (await column(LIST)).getByRole('button', { name: /^game ?120$/ }),
    ).toHaveAttribute('aria-pressed', 'true')
    const asked = fetchSpy.mock.calls.map(([input]) => String(input))
    expect(asked.some((url) => url.includes('/data-model/example'))).toBe(false)
  })

  it('falls back to the search prompt when the example cannot be read', async () => {
    for (const status of [404, 503]) {
      stubApi({
        ...ROUTES,
        '/api/v1/data-model/example': () =>
          failure('The example is not answering.', true, status),
      })
      const { unmount } = renderTab()
      expect(
        await (
          await column(MAIN)
        ).findByText('Find a record by its id, or choose a kind of record.'),
      ).toBeVisible()
      expect(
        (await column(LIST)).getByRole('searchbox', {
          name: 'Find a record by id',
        }),
      ).toBeVisible()
      unmount()
      vi.unstubAllGlobals()
    }
  })

  it('opens a sample record when a kind is chosen', async () => {
    stubApi(ROUTES)
    renderTab('node=INC_002')
    await userEvent.click(
      await (await column(LIST)).findByRole('button', { name: /^game ?120$/ }),
    )
    await vi.waitFor(() =>
      expect(window.location.hash).toBe('#/data-model?tab=graph&node=GAME_001'),
    )
  })

  it('opens the first concept of the ontology for the business concept kind', async () => {
    stubApi({
      ...ROUTES,
      '/api/v1/ontology': {
        version: '2',
        concepts: [{ concept_id: 'CONCEPT_DRAW' }],
      },
    })
    renderTab('node=INC_002')
    await userEvent.click(
      await (
        await column(LIST)
      ).findByRole('button', {
        name: /^business concept ?30$/,
      }),
    )
    await vi.waitFor(() =>
      expect(window.location.hash).toBe(
        '#/data-model?tab=graph&node=CONCEPT_DRAW',
      ),
    )
  })

  it('says plainly when a kind has no sample, and shows an error when the sample cannot be read', async () => {
    stubApi({
      ...ROUTES,
      '/api/v1/datasets/dev-seed2026/tables/games/rows': () =>
        failure('The warehouse is not answering.', true),
    })
    renderTab('node=INC_002')
    await userEvent.click(
      await (
        await column(LIST)
      ).findByRole('button', { name: /^prize type ?5$/ }),
    )
    expect(
      await (
        await column(LIST)
      ).findByText(
        'Prize type records are not built from a table, so there is no sample.',
      ),
    ).toBeVisible()
    await userEvent.click(
      (await column(LIST)).getByRole('button', { name: /^game ?120$/ }),
    )
    expect(await (await column(LIST)).findByRole('alert')).toHaveTextContent(
      'The warehouse is not answering.',
    )
  })

  it('puts an opened group in the address, and lists its first 100 members on the right', async () => {
    stubApi(ROUTES)
    const { rerender } = renderTab('node=INC_002')
    await userEvent.click(
      await screen.findByRole('button', {
        name: '150 support cases, click to list them',
      }),
    )
    expect(window.location.hash).toBe(
      '#/data-model?tab=graph&node=INC_002&group=RELATED_TO%3Ain',
    )
    rerender(
      <GraphExplorer
        params={new URLSearchParams('node=INC_002&group=RELATED_TO:in')}
        scale={1}
      />,
    )
    const detail = await column(DETAIL)
    expect(
      await detail.findByText('Showing the first 100 of 150.'),
    ).toBeVisible()
    const members = detail.getByRole('region', { name: '150 support cases' })
    expect(within(members).getAllByRole('button')).toHaveLength(100)
    await userEvent.click(
      within(members).getByRole('button', { name: 'SC_007' }),
    )
    expect(window.location.hash).toBe('#/data-model?tab=graph&node=SC_007')
  })

  it('asks again, by type and direction, for a kind of link with few neighbours the first page missed', async () => {
    const fetchSpy = stubApi({
      ...ROUTES,
      '/api/v1/graph/nodes/INC_002/neighbours': (url: URL) =>
        url.searchParams.get('type') === null
          ? json({
              node_id: 'INC_002',
              truncated: true,
              items: Array.from({ length: 100 }, (_, i) => supportCase(i)),
            })
          : incidentNeighbours(url),
    })
    renderTab('node=INC_002')
    expect(
      await screen.findByRole('button', { name: 'Albion Millions 1, game' }),
    ).toBeVisible()
    const asked = fetchSpy.mock.calls
      .map(([input]) => new URL(String(input), 'http://localhost'))
      .filter((url) => url.pathname.endsWith('/neighbours'))
      .map((url) => url.search)
    expect(asked).toContain('?type=AFFECTS&direction=out&limit=100')
  })

  it("lists only a group's own direction, asking the server for it", async () => {
    const fetchSpy = stubApi(ROUTES)
    renderTab('node=INC_002&group=RELATED_TO:in')
    const detail = await column(DETAIL)
    expect(
      await detail.findByText('Showing the first 100 of 150.'),
    ).toBeVisible()
    const asked = fetchSpy.mock.calls
      .map(([input]) => new URL(String(input), 'http://localhost'))
      .filter((url) => url.pathname.endsWith('/neighbours'))
      .map((url) => url.search)
    expect(asked).toContain('?type=RELATED_TO&direction=in&limit=100')
  })

  it('says so when a group comes back empty', async () => {
    stubApi({
      ...ROUTES,
      '/api/v1/graph/nodes/INC_002/neighbours': (url: URL) =>
        url.searchParams.get('direction') === 'in'
          ? json({ node_id: 'INC_002', truncated: false, items: [] })
          : incidentNeighbours(url),
    })
    renderTab('node=INC_002&group=RELATED_TO:in')
    const detail = await column(DETAIL)
    expect(
      await detail.findByText('None of these records could be read.'),
    ).toBeVisible()
    expect(detail.queryByText(/^Showing the first/)).toBeNull()
  })

  it('moves to a neighbour when it is chosen', async () => {
    stubApi(ROUTES)
    renderTab('node=INC_002')
    await userEvent.click(
      await screen.findByRole('button', { name: 'Albion Millions 1, game' }),
    )
    expect(window.location.hash).toBe('#/data-model?tab=graph&node=GAME_001')
  })

  it('shows a concept with its link counts and no table row to go to', async () => {
    stubApi(ROUTES)
    renderTab('node=CONCEPT_DRAW')
    const detail = await column(DETAIL)
    expect(await detail.findByText('2 records are matched to it')).toBeVisible()
    expect(detail.getByText('It is not built from a table row.')).toBeVisible()
    expect(detail.queryByRole('link', { name: 'See its table row' })).toBeNull()
    expect(
      detail.getByRole('region', { name: 'Followed by Graph + Ontology only' }),
    ).toBeVisible()
  })

  it('holds the Kinds of link table, with where each is made from, in About this', async () => {
    stubApi(ROUTES)
    renderTab('node=INC_002')
    await userEvent.click(
      await screen.findByRole('button', { name: 'About this' }),
    )
    const drawer = within(await screen.findByRole('dialog'))
    expect(
      drawer.getByRole('heading', { name: 'How the graph is built' }),
    ).toBeVisible()
    const table = within(
      await drawer.findByRole('region', { name: 'Kinds of link' }),
    )
    expect(table.getByRole('columnheader', { name: 'Made from' })).toBeVisible()
  })

  it('shows a loading state, then an error with a retry when the record cannot be read', async () => {
    stubApi({
      ...ROUTES,
      '/api/v1/graph/nodes/INC_002': () =>
        failure('The graph is not answering.', true),
    })
    renderTab('node=INC_002')
    expect(await (await column(MAIN)).findByRole('alert')).toHaveTextContent(
      'The graph is not answering.',
    )
    expect(
      (await column(MAIN)).getByRole('button', { name: 'Retry' }),
    ).toBeVisible()
    // The details column does not invite a search beside the error.
    expect(
      (await column(DETAIL)).queryByText(
        'Find a record by its id, or choose a kind of record.',
      ),
    ).toBeNull()
  })

  it('says plainly when the graph has not been built', async () => {
    stubApi({
      ...ROUTES,
      '/api/v1/graph/schema': { ...GRAPH_SCHEMA, labels: [] },
    })
    renderTab('node=INC_002')
    expect(
      await screen.findByText('The graph has not been built yet.'),
    ).toBeVisible()
  })
})
