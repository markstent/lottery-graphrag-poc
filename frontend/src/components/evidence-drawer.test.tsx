import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { failure, stubApi } from '../test/api-stub'
import { EvidenceDrawer } from './evidence-drawer'

const RECORD = {
  table: 'incidents',
  row: { incident_id: 'INC_S007_GR', market: 'GR', severity: 3 },
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
    expect(provenance).toHaveTextContent('dev-seed2026')
    expect(
      record.compareDocumentPosition(provenance) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
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
    expect(dialog).toHaveTextContent('Incident')
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
})
