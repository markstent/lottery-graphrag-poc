import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Schemas } from '../../api/client'
import { failure, json, stubApi, type Route } from '../../test/api-stub'
import { DATASET, DICTIONARY, SCHEMA, STATS } from './data-model.fixtures'
import { ONTOLOGY, SCENARIOS } from './ontology.fixtures'
import { OverviewTab } from './overview-tab'
import { coreLinks, CORE_KINDS } from './model'

const RECORD: Schemas['RecordOut'] = {
  table: 'incidents',
  row: {
    incident_id: 'INC_002',
    market_id: 'MKT_GR',
    platform_version_id: 'PLV_PAYMENTS_3',
    incident_type: 'ITYPE_GR_PLIROMES',
    severity: 'LOW',
    summary: 'Payment provider degraded; transactions failing.',
  },
  graph_node_id: 'INC_002',
  edges: [
    { type: 'AFFECTS_MARKET', direction: 'out', count: 1 },
    { type: 'OF_TYPE', direction: 'out', count: 1 },
    { type: 'RELATED_TO', direction: 'in', count: 24 },
    { type: 'RELATED_TO_VERSION', direction: 'out', count: 1 },
  ],
  graph_error: null,
}

const node = (id: string, label: string, properties = {}) => ({
  node_id: id,
  labels: [label],
  properties: { id, ...properties },
  provenance: null,
  edges: [],
})

const INCIDENT_NEIGHBOURS: Schemas['Neighbours'] = {
  node_id: 'INC_002',
  truncated: false,
  items: [
    {
      rel_type: 'AFFECTS_MARKET',
      direction: 'out',
      node: node('MKT_GR', 'Market'),
    },
    {
      rel_type: 'OF_TYPE',
      direction: 'out',
      node: node('ITYPE_GR_PLIROMES', 'IncidentType'),
    },
    {
      rel_type: 'RELATED_TO',
      direction: 'in',
      node: node('SUP_00009', 'SupportCase'),
    },
    {
      rel_type: 'RELATED_TO_VERSION',
      direction: 'out',
      node: node('PLV_PAYMENTS_3', 'PlatformVersion'),
    },
  ],
}

const CONCEPT_NEIGHBOURS: Schemas['Neighbours'] = {
  node_id: 'ITYPE_GR_PLIROMES',
  truncated: false,
  items: [
    {
      rel_type: 'MAPS_TO',
      direction: 'out',
      node: node('CONCEPT_PAYMENT_INCIDENT', 'BusinessConcept', {
        label_en: 'Payment incident',
      }),
    },
  ],
}

const ROUTES: Record<string, Route> = {
  '/api/v1/data-model/example': { incident_id: 'INC_002' },
  '/api/v1/datasets': [DATASET],
  '/api/v1/datasets/dev-seed2026/dictionary': DICTIONARY,
  '/api/v1/datasets/dev-seed2026/tables/incidents/rows/INC_002': RECORD,
  '/api/v1/graph/nodes/INC_002/neighbours': INCIDENT_NEIGHBOURS,
  '/api/v1/graph/nodes/ITYPE_GR_PLIROMES/neighbours': CONCEPT_NEIGHBOURS,
  '/api/v1/graph/schema': SCHEMA,
  '/api/v1/graph/stats': STATS,
  '/api/v1/ontology': ONTOLOGY,
  '/api/v1/scenarios': SCENARIOS,
}

const card = (name: string) => screen.getByRole('region', { name })

/** Waits until every load has settled, so the cards hold their sizes. */
async function settled() {
  await screen.findByText('4 kinds of record · 4 kinds of link')
  await screen.findByText(/stories are planted/)
}

afterEach(() => vi.unstubAllGlobals())

describe('OverviewTab', () => {
  it('opens with what the screen is', () => {
    stubApi(ROUTES)
    render(<OverviewTab scale={1} />)
    expect(
      screen.getByText(
        'The data the three approaches search, in three layers. Each is built from the one before.',
      ),
    ).toBeVisible()
  })

  it('gives each layer its live size from the API', async () => {
    stubApi(ROUTES)
    render(<OverviewTab scale={1} />)
    await settled()
    // Two source systems, four tables and the rows of the world.
    expect(
      within(card("The company's data")).getByText(
        '2 systems · 4 tables · 5,549 rows',
      ),
    ).toBeVisible()
    expect(
      within(card('The links between records')).getByText(
        '4 kinds of record · 4 kinds of link',
      ),
    ).toBeVisible()
    expect(
      await within(card('One dictionary for four countries')).findByText(
        '42 concepts · 117 country codes',
      ),
    ).toBeVisible()
  })

  it('shows the same example record on every card and through the layers', async () => {
    const fetchMock = stubApi(ROUTES)
    render(<OverviewTab scale={1} />)
    await settled()
    const fit = await screen.findByRole('region', {
      name: 'How they fit together',
    })
    for (const region of [
      card("The company's data"),
      card('The links between records'),
      card('One dictionary for four countries'),
      fit,
    ])
      expect(await within(region).findAllByText('INC_002')).not.toHaveLength(0)

    // The concept is the incident type's neighbour along the ontology link.
    expect(
      within(card('One dictionary for four countries')).getByText(
        'Payment incident',
      ),
    ).toBeVisible()
    expect(within(fit).getByText('Payment incident')).toBeVisible()
    const asked = fetchMock.mock.calls.map(([url]) => String(url))
    expect(
      asked.some(
        (url) =>
          url.includes('/graph/nodes/ITYPE_GR_PLIROMES/neighbours') &&
          url.includes('type=MAPS_TO'),
      ),
    ).toBe(true)

    // The row's columns that name other records, and the links made from them.
    expect(within(fit).getByText('platform version id')).toBeVisible()
    expect(within(fit).getAllByText('PLV_PAYMENTS_3')).not.toHaveLength(0)
    expect(within(fit).getByText(/is related to version/)).toBeVisible()
    expect(within(fit).getByText(/and 23 more/)).toBeVisible()
  })

  it('says when the type is matched to no concept, and claims no match under it', async () => {
    stubApi({
      ...ROUTES,
      '/api/v1/graph/nodes/ITYPE_GR_PLIROMES/neighbours': {
        ...CONCEPT_NEIGHBOURS,
        items: [],
      },
    })
    render(<OverviewTab scale={1} />)
    await settled()
    const fit = await screen.findByRole('region', {
      name: 'How they fit together',
    })
    expect(
      await within(fit).findByText('Its type is matched to no concept.'),
    ).toBeVisible()
    expect(within(fit).queryByText(/is matched to this concept/)).toBeNull()
  })

  it('shows sizes only, with a note, when the world has no example', async () => {
    stubApi({ ...ROUTES, '/api/v1/data-model/example': { incident_id: null } })
    render(<OverviewTab scale={1} />)
    await settled()
    expect(
      await screen.findByText('No example record in this world.'),
    ).toBeVisible()
    expect(screen.queryByText('INC_002')).toBeNull()
    expect(
      within(card("The company's data")).getByText(
        '2 systems · 4 tables · 5,549 rows',
      ),
    ).toBeVisible()
  })

  it("shows one card's error with a retry, and keeps the others", async () => {
    let fail = true
    stubApi({
      ...ROUTES,
      '/api/v1/graph/schema': () =>
        fail ? failure('The graph is not answering.', true) : json(SCHEMA),
    })
    render(<OverviewTab scale={1} />)
    const graph = card('The links between records')
    expect(
      await within(graph).findByText('The graph is not answering.'),
    ).toBeVisible()
    expect(
      await within(card("The company's data")).findByText(
        '2 systems · 4 tables · 5,549 rows',
      ),
    ).toBeVisible()
    fail = false
    fireEvent.click(within(graph).getByRole('button', { name: 'Retry' }))
    expect(
      await within(graph).findByText('4 kinds of record · 4 kinds of link'),
    ).toBeVisible()
  })

  it('shows the example error with a retry, not a blank page', async () => {
    stubApi({
      ...ROUTES,
      '/api/v1/data-model/example': () =>
        failure('The example could not be found.', false, 404),
    })
    render(<OverviewTab scale={1} />)
    const fit = await screen.findByRole('region', {
      name: 'How they fit together',
    })
    expect(
      await within(fit).findByText('The example could not be found.'),
    ).toBeVisible()
    expect(within(fit).getByRole('button', { name: 'Retry' })).toBeVisible()
  })

  it('links each card to its tab', async () => {
    stubApi(ROUTES)
    render(<OverviewTab scale={1} />)
    expect(
      screen.getByRole('link', { name: /Explore tables/ }),
    ).toHaveAttribute('href', '#/data-model?tab=tables')
    expect(
      screen.getByRole('link', { name: /Explore the graph/ }),
    ).toHaveAttribute('href', '#/data-model?tab=graph')
    expect(
      screen.getByRole('link', { name: /Explore concepts/ }),
    ).toHaveAttribute('href', '#/data-model?tab=concepts')
    expect(
      await screen.findByRole('link', {
        name: /8 stories are planted in this data for the test\./,
      }),
    ).toHaveAttribute('href', '#/data-model?tab=stories')
  })

  it('draws the core of the graph from the schema, each kind a link to the Graph tab', async () => {
    stubApi(ROUTES)
    render(<OverviewTab scale={1} />)
    const core = await screen.findByRole('region', {
      name: 'The core of the graph',
    })
    for (const name of [
      'incident, 25 records',
      'game, 120 records',
      'market, 4 records',
    ])
      expect(await within(core).findByRole('link', { name })).toHaveAttribute(
        'href',
        '#/data-model?tab=graph',
      )
    // A kind outside the core is left out.
    expect(
      within(core).queryByRole('link', { name: /business concept/ }),
    ).toBeNull()
    // The lines carry no tags; the links are listed in words, visibly.
    const map = within(core).getByRole('group', {
      name: 'The main kinds of record',
    })
    expect(map).not.toHaveTextContent('affects')
    const words = within(core).getByRole('list', {
      name: 'The main kinds of record, in words',
    })
    expect(
      within(words)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['game is available in market', 'incident affects game'])
    expect(words).toBeVisible()
    expect(
      within(core).getByRole('link', { name: /See every kind of record/ }),
    ).toHaveAttribute('href', '#/data-model?tab=graph')
  })

  it("brings a kind's links forward when it is pointed at or focused", async () => {
    stubApi(ROUTES)
    render(<OverviewTab scale={1} />)
    const incident = await screen.findByRole('link', {
      name: 'incident, 25 records',
    })
    const line = (id: string) =>
      document.querySelector(`[data-link="${id}"]`) as Element
    expect(line('AVAILABLE_IN:Game>Market')).not.toHaveAttribute('data-dimmed')
    fireEvent.mouseEnter(incident)
    expect(line('AFFECTS:Incident>Game')).not.toHaveAttribute('data-dimmed')
    expect(line('AVAILABLE_IN:Game>Market')).toHaveAttribute('data-dimmed')
    expect(screen.getByText('game is available in market')).toHaveAttribute(
      'data-dimmed',
    )
    fireEvent.mouseLeave(incident)
    expect(line('AVAILABLE_IN:Game>Market')).not.toHaveAttribute('data-dimmed')
    fireEvent.focus(screen.getByRole('link', { name: 'market, 4 records' }))
    expect(line('AFFECTS:Incident>Game')).toHaveAttribute('data-dimmed')
  })

  it('says how each layer is built', () => {
    stubApi(ROUTES)
    render(<OverviewTab scale={1} />)
    const notes = screen.getByRole('region', {
      name: 'How each layer is built',
    })
    expect(notes).toHaveTextContent(/program builds the graph from the tables/)
    expect(notes).toHaveTextContent(/copied from a column/)
    expect(notes).toHaveTextContent(/counted from bulk rows/)
    expect(notes).toHaveTextContent(/worked out by a rule/)
    expect(notes).toHaveTextContent(/Only Graph \+ Ontology may follow/)
  })
})

describe('coreLinks', () => {
  it('keeps every schema link between two core kinds, and only those', () => {
    const schema = {
      ...SCHEMA,
      labels: [...CORE_KINDS, 'AppVersion'],
      relationship_types: [
        { type: 'RELATED_TO', from_label: 'SupportCase', to_label: 'Incident' },
        { type: 'CONCERNS', from_label: 'SupportCase', to_label: 'Game' },
        { type: 'FROM_MARKET', from_label: 'SupportCase', to_label: 'Market' },
        { type: 'PLAYS', from_label: 'Player', to_label: 'Game' },
        { type: 'EXPOSED_TO', from_label: 'Player', to_label: 'Campaign' },
        { type: 'PROMOTES', from_label: 'Campaign', to_label: 'Game' },
        { type: 'AFFECTS', from_label: 'Incident', to_label: 'Game' },
        { type: 'AFFECTS_MARKET', from_label: 'Incident', to_label: 'Market' },
        { type: 'RELATED_TO', from_label: 'Incident', to_label: 'Platform' },
        {
          type: 'RELATED_TO_VERSION',
          from_label: 'Incident',
          to_label: 'PlatformVersion',
        },
        {
          type: 'VERSION_OF',
          from_label: 'PlatformVersion',
          to_label: 'Platform',
        },
        { type: 'RUNS_ON', from_label: 'Game', to_label: 'Platform' },
        { type: 'AVAILABLE_IN', from_label: 'Game', to_label: 'Market' },
        { type: 'SIMILAR_TO', from_label: 'Game', to_label: 'Game' },
        {
          type: 'RELATED_TO_APP_VERSION',
          from_label: 'Incident',
          to_label: 'AppVersion',
        },
      ],
    }
    expect(coreLinks(schema)).toHaveLength(13)
    expect(coreLinks(schema).map((l) => l.id)).not.toContain(
      'SIMILAR_TO:Game>Game',
    )
  })
})
