import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  DATASET_DETAIL,
  failure,
  MODELS,
  stubApi,
  SUMMARY,
} from '../../test/api-stub'
import { Architecture } from './architecture'
import { stackCounts } from './counts'

const DATASET = {
  ...SUMMARY,
  row_counts: { players: 1200, games: 20, documents: 262 },
}
const GRAPH = {
  nodes_by_label: { Player: 1200, Game: 20, BusinessConcept: 42 },
  relationships_by_type: { PLAYS: 3000, MAPS_TO: 60 },
  ingestion_version: 'ing-test',
  source: 'ingestion' as const,
}
const ONTOLOGY = {
  version: '2.0.0',
  concepts: Array.from({ length: 42 }, (_, i) => ({ concept_id: `C${i}` })),
}

function api(overrides: Record<string, unknown> = {}) {
  return stubApi({
    '/api/v1/datasets': [DATASET],
    '/api/v1/datasets/dev-seed2026': DATASET_DETAIL,
    '/api/v1/graph/stats': GRAPH,
    '/api/v1/ontology': ONTOLOGY,
    '/api/v1/models': MODELS,
    ...overrides,
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('stackCounts', () => {
  it('reads the live counts, keeping the concepts out of the graph records', () => {
    const counts = stackCounts({
      dataset: DATASET,
      detail: DATASET_DETAIL,
      graph: GRAPH,
      ontology: ONTOLOGY as never,
      models: MODELS as never,
    })
    expect(counts).toEqual({
      tables: 3,
      documents: 262,
      passages: 1204,
      graphRecords: 1220,
      graphLinks: 3060,
      graphKinds: 2,
      concepts: 42,
      ontologyVersion: '2.0.0',
      answerModel: 'qwen3:8b',
    })
  })

  it('has no passage count before the text index is built', () => {
    const counts = stackCounts({
      dataset: DATASET,
      detail: { ...DATASET_DETAIL, index_status: null },
      graph: GRAPH,
      ontology: ONTOLOGY as never,
      models: MODELS as never,
    })
    expect(counts.passages).toBeNull()
  })
})

describe('Architecture', () => {
  it('draws the stack with the live counts and gives it in words', async () => {
    api()
    const user = userEvent.setup()
    render(<Architecture />)
    const figure = await screen.findByRole('figure', {
      name: 'How it fits together',
    })
    expect(
      within(figure).getByText('1,220 records · 3,060 links'),
    ).toBeInTheDocument()
    expect(within(figure).getByText('42 business concepts')).toBeInTheDocument()
    expect(
      within(figure).getByText(
        '3 tables · Parquet files · queried with DuckDB',
      ),
    ).toBeInTheDocument()
    expect(
      within(figure).getByText(
        /LiteLLM model gateway → Ollama, answers by qwen3:8b$/,
      ),
    ).toBeInTheDocument()
    // The picture is hidden from a screen reader; its words are not.
    expect(figure.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    await user.click(screen.getByText('The diagram in words'))
    const words = screen.getByText('Graph layer, added for B and C')
    expect(words.tagName).toBe('DT')
    expect(words.nextElementSibling?.textContent).toContain(
      'a Neo4j 5.26 graph of 1,220 records of 2 kinds and 3,060 links',
    )
  })

  it('shows a loading state first', () => {
    api()
    render(<Architecture />)
    expect(
      screen.getByRole('region', { name: 'How it fits together' }),
    ).toHaveAttribute('aria-busy', 'true')
  })

  it('says so when no world is loaded', async () => {
    api({ '/api/v1/datasets': [{ ...DATASET, active: false }] })
    render(<Architecture />)
    expect(
      await screen.findByText(
        'No world is loaded, so there are no counts to show.',
      ),
    ).toBeVisible()
  })

  it('shows the error when a count cannot be read', async () => {
    api({
      '/api/v1/graph/stats': () => failure('Neo4j is not answering', true),
    })
    render(<Architecture />)
    expect(await screen.findByText(/Neo4j is not answering/)).toBeVisible()
    expect(screen.queryByRole('figure')).toBeNull()
  })
})
