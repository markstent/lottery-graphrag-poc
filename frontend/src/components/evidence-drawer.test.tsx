import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { failure, stubApi } from '../test/api-stub'
import { EvidenceDrawer } from './evidence-drawer'

const RECORD = {
  table: 'incidents',
  row: {
    incident_id: 'INC_S007_GR',
    market: 'GR',
    severity: 3,
    affected_systems: ['checkout', 'wallet'],
  },
  graph_node_id: 'INC_S007_GR',
  edges: [{ type: 'AFFECTS', direction: 'out', count: 2 }],
  graph_error: null,
}

const NODE = {
  node_id: 'INC_S007_GR',
  labels: ['Incident'],
  properties: { title: 'Payment outage', market: 'GR' },
  provenance: {
    dataset_id: 'dev-seed2026',
    table: 'incidents',
    row_id: 'INC_S007_GR',
  },
}

afterEach(() => vi.unstubAllGlobals())

describe('EvidenceDrawer', () => {
  it('renders nothing without a source', () => {
    stubApi({})
    render(<EvidenceDrawer source={null} onClose={() => undefined} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows the row first, then where it came from', async () => {
    stubApi({
      '/api/v1/datasets/dev-seed2026/tables/incidents/rows/INC_S007_GR': RECORD,
    })
    render(
      <EvidenceDrawer
        source={{
          kind: 'record',
          datasetId: 'dev-seed2026',
          table: 'incidents',
          rowId: 'INC_S007_GR',
        }}
        onClose={() => undefined}
      />,
    )
    const dialog = await screen.findByRole('dialog', { name: 'Evidence' })
    await screen.findByText('severity')
    const record = within(dialog).getByRole('region', { name: 'Record' })
    expect(
      within(record).getByText('INC_S007_GR', { selector: 'dd' }),
    ).toBeVisible()
    const provenance = within(dialog).getByRole('region', {
      name: 'Provenance',
    })
    expect(provenance).toHaveTextContent('incidents')
    expect(provenance).toHaveTextContent('dev world, 2026')
    expect(provenance).not.toHaveTextContent('seed')
    expect(within(record).getByText('affected systems')).toBeVisible()
    expect(within(record).getByText('checkout, wallet')).toBeVisible()
    expect(record).not.toHaveTextContent('affected_systems')
    expect(record).not.toHaveTextContent('["checkout"')
    expect(
      record.compareDocumentPosition(provenance) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('shows a key once where two keys hold the same value, keeping the id of a node', async () => {
    stubApi({
      '/api/v1/graph/nodes/INC_S007_GR': {
        ...NODE,
        properties: {
          id: 'INC_S007_GR',
          incident_id: 'INC_S007_GR',
          source_record_id: 'INC_S007_GR',
          market: 'GR',
        },
      },
    })
    render(
      <EvidenceDrawer
        source={{ kind: 'node', nodeId: 'INC_S007_GR' }}
        onClose={() => undefined}
      />,
    )
    const record = await screen.findByRole('region', { name: 'Record' })
    await within(record).findByText('market')
    expect(within(record).getAllByText('INC_S007_GR')).toHaveLength(1)
    expect(within(record).getByText('id')).toBeVisible()
    expect(within(record).queryByText('source record id')).toBeNull()
  })

  it('shows the properties of a graph node, then its provenance', async () => {
    stubApi({ '/api/v1/graph/nodes/INC_S007_GR': NODE })
    render(
      <EvidenceDrawer
        source={{ kind: 'node', nodeId: 'INC_S007_GR' }}
        onClose={() => undefined}
      />,
    )
    const dialog = await screen.findByRole('dialog', { name: 'Evidence' })
    await screen.findByText('Payment outage')
    expect(dialog).toHaveTextContent('incident')
    expect(
      within(dialog).getByRole('region', { name: 'Provenance' }),
    ).toHaveTextContent('INC_S007_GR')
  })

  it('shows a loading panel, then an error panel with Retry', async () => {
    const user = userEvent.setup()
    let answers = 0
    stubApi({
      '/api/v1/graph/nodes/X': () =>
        ++answers === 1
          ? failure('The server did not answer.', true)
          : Response.json(NODE),
    })
    render(
      <EvidenceDrawer
        source={{ kind: 'node', nodeId: 'X' }}
        onClose={() => undefined}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('Loading Record')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The server did not answer.',
    )
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() =>
      expect(screen.getByText('Payment outage')).toBeVisible(),
    )
  })

  it('shows relationships and node kinds in plain words', async () => {
    stubApi({
      '/api/v1/datasets/dev-seed2026/tables/incidents/rows/INC_S007_GR': {
        ...RECORD,
        edges: [{ type: 'HAS_CHUNK', direction: 'out', count: 2 }],
      },
      '/api/v1/graph/nodes/INC_S007_GR': {
        ...NODE,
        labels: ['IncidentType', 'DocumentChunk'],
      },
    })
    const record = render(
      <EvidenceDrawer
        source={{
          kind: 'record',
          datasetId: 'dev-seed2026',
          table: 'incidents',
          rowId: 'INC_S007_GR',
        }}
        onClose={() => undefined}
      />,
    )
    const provenance = await screen.findByRole('region', {
      name: 'Provenance',
    })
    expect(provenance).toHaveTextContent('contains passage (outgoing) × 2')
    expect(provenance).not.toHaveTextContent('HAS_CHUNK')
    expect(provenance).not.toHaveTextContent(' x 2')
    record.unmount()

    render(
      <EvidenceDrawer
        source={{ kind: 'node', nodeId: 'INC_S007_GR' }}
        onClose={() => undefined}
      />,
    )
    const dialog = await screen.findByRole('dialog', { name: 'Evidence' })
    await screen.findByText('Payment outage')
    expect(dialog).toHaveTextContent('incident type, passage')
    expect(dialog).not.toHaveTextContent('IncidentType')
  })

  it.each([
    ['GRAPH_QUERY_ERROR', 'The graph could not be queried.'],
    ['OTHER_WORLD', 'The graph holds a different world.'],
    ['SOMETHING_NEW', 'The graph could not be read.'],
  ])('says in words why the graph is missing (%s)', async (code, words) => {
    stubApi({
      '/api/v1/datasets/dev-seed2026/tables/incidents/rows/INC_S007_GR': {
        ...RECORD,
        edges: null,
        graph_error: code,
      },
    })
    render(
      <EvidenceDrawer
        source={{
          kind: 'record',
          datasetId: 'dev-seed2026',
          table: 'incidents',
          rowId: 'INC_S007_GR',
        }}
        onClose={() => undefined}
      />,
    )
    const provenance = await screen.findByRole('region', {
      name: 'Provenance',
    })
    expect(within(provenance).getByText(words)).toBeVisible()
  })

  it('says where the record sits on the evidence path when it is given', async () => {
    stubApi({ '/api/v1/graph/nodes/INC_S007_GR': NODE })
    render(
      <EvidenceDrawer
        source={{ kind: 'node', nodeId: 'INC_S007_GR' }}
        onClose={() => undefined}
        pathPosition={{ path: 2, step: 2, of: 3 }}
      />,
    )
    expect(
      await screen.findByText('Step 2 of 3 on evidence path 2'),
    ).toBeVisible()
  })

  it('shows no path position when none is given', async () => {
    stubApi({ '/api/v1/graph/nodes/INC_S007_GR': NODE })
    render(
      <EvidenceDrawer
        source={{ kind: 'node', nodeId: 'INC_S007_GR' }}
        onClose={() => undefined}
      />,
    )
    await screen.findByText('Payment outage')
    expect(screen.queryByText(/on evidence path/)).toBeNull()
  })

  it('shows a passage as the text the results carry, then its source, with no request', async () => {
    const fetchSpy = stubApi({})
    render(
      <EvidenceDrawer
        source={{
          kind: 'passage',
          title: 'Runbook',
          text: 'Restart the service. Then check.',
          facts: [
            ['Document', 'DOC_1'],
            ['Market', 'Greece'],
          ],
        }}
        onClose={() => undefined}
      />,
    )
    const dialog = await screen.findByRole('dialog', { name: 'Evidence' })
    const record = within(dialog).getByRole('region', { name: 'Record' })
    expect(record).toHaveTextContent('Runbook')
    expect(record).toHaveTextContent('Restart the service. Then check.')
    const provenance = within(dialog).getByRole('region', {
      name: 'Provenance',
    })
    expect(within(provenance).getByText('Greece')).toBeVisible()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('lists the members of a group of folded nodes in plain words, with titles where known', async () => {
    const fetchSpy = stubApi({})
    render(
      <EvidenceDrawer
        source={{
          kind: 'group',
          title: 'Group of 2 incident types',
          members: [
            {
              id: 'ITYPE_A',
              label: 'IncidentType',
              title: 'Application crashes',
            },
            { id: 'ITYPE_B', label: 'IncidentType', title: null },
          ],
        }}
        onClose={() => undefined}
      />,
    )
    const dialog = await screen.findByRole('dialog', { name: 'Evidence' })
    expect(within(dialog).getByText('Group of 2 incident types')).toBeVisible()
    const items = within(dialog).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('incident type ITYPE_A')
    expect(items[0]).toHaveTextContent('Application crashes')
    expect(items[1]).toHaveTextContent('incident type ITYPE_B')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  describe('following a record into the graph', () => {
    const SOURCE = {
      kind: 'record',
      datasetId: 'dev-seed2026',
      table: 'incidents',
      rowId: 'INC_S007_GR',
    } as const
    const ROUTE = {
      '/api/v1/datasets/dev-seed2026/tables/incidents/rows/INC_S007_GR': RECORD,
    }
    const followInto = (nodeId: string) =>
      `#/data-model?tab=graph&node=${nodeId}`

    it('offers a link to the node of the record when the opener asks for one', async () => {
      stubApi(ROUTE)
      render(
        <EvidenceDrawer
          source={SOURCE}
          onClose={() => undefined}
          followInto={followInto}
        />,
      )
      expect(
        await screen.findByRole('link', { name: 'Follow into the graph' }),
      ).toHaveAttribute('href', '#/data-model?tab=graph&node=INC_S007_GR')
    })

    it('offers no link unless asked', async () => {
      stubApi(ROUTE)
      render(<EvidenceDrawer source={SOURCE} onClose={() => undefined} />)
      await screen.findByText('severity')
      expect(screen.queryByRole('link')).toBeNull()
    })

    it('says plainly that a row with no node has none, and offers no link', async () => {
      stubApi({
        '/api/v1/datasets/dev-seed2026/tables/incidents/rows/INC_S007_GR': {
          ...RECORD,
          graph_node_id: null,
          edges: [],
        },
      })
      render(
        <EvidenceDrawer
          source={SOURCE}
          onClose={() => undefined}
          followInto={followInto}
        />,
      )
      const provenance = await screen.findByRole('region', {
        name: 'Provenance',
      })
      expect(provenance).toHaveTextContent('This row has no node in the graph.')
      expect(screen.queryByRole('link')).toBeNull()
    })
  })
})
