/** A small synthetic world for the Data Model component tests. */

import type { Schemas } from '../../api/client'

export const DATASET = {
  dataset_id: 'dev-seed2026',
  generator_version: '0.2.0',
  world_seed: 2026,
  scenario_seed: 7,
  profile: 'dev',
  row_counts: { markets: 4, games: 120, tickets: 5400, incidents: 25 },
  active: true,
} satisfies Schemas['DatasetSummary']

const column = (name: string, type = 'VARCHAR') => ({
  name,
  type,
  description: null,
})

const table = (
  name: string,
  source_system: string,
  columns: Schemas['ColumnOut'][],
  foreign_keys: Schemas['ForeignKeyOut'][] = [],
): Schemas['TableSchemaOut'] => ({
  table: name,
  source_system,
  primary_key: columns[0].name,
  columns,
  foreign_keys,
  provenance: null,
  dictionary_source: 'world',
})

export const DICTIONARY: Schemas['TableSchemaOut'][] = [
  table('markets', 'warehouse', [column('market_id'), column('name')]),
  table(
    'games',
    'warehouse',
    [
      column('game_id'),
      column('name'),
      column('market_id'),
      column('launched_at', 'TIMESTAMP'),
    ],
    [{ column: 'market_id', table: 'markets', ref_column: 'market_id' }],
  ),
  table(
    'tickets',
    'warehouse',
    [column('ticket_id'), column('game_id'), column('sold_at', 'TIMESTAMP')],
    [{ column: 'game_id', table: 'games', ref_column: 'game_id' }],
  ),
  table(
    'incidents',
    'incident_management',
    [column('incident_id'), column('market_id'), column('summary')],
    [{ column: 'market_id', table: 'markets', ref_column: 'market_id' }],
  ),
]

export const GAME_ROWS = (offset: number, count: number, total = 120) => ({
  table: 'games',
  offset,
  limit: 50,
  total,
  rows: Array.from({ length: count }, (_, i) => ({
    game_id: `GAME_${String(offset + i + 1).padStart(3, '0')}`,
    name: `Albion Millions ${offset + i + 1}`,
    market_id: 'UK',
    launched_at: '2026-03-04T10:15:00',
  })),
})

export const SCHEMA: Schemas['GraphSchema'] = {
  labels: ['Game', 'Incident', 'Market', 'BusinessConcept'],
  node_tables: { Game: 'games', Incident: 'incidents', Market: 'markets' },
  relationship_types: [
    { type: 'AFFECTS', from_label: 'Incident', to_label: 'Game' },
    { type: 'AVAILABLE_IN', from_label: 'Game', to_label: 'Market' },
    { type: 'MAPS_TO', from_label: 'Game', to_label: 'BusinessConcept' },
    { type: 'MAPS_TO', from_label: 'Market', to_label: 'BusinessConcept' },
    { type: 'SIMILAR_TO', from_label: 'Game', to_label: 'Game' },
  ],
  allow_list: {
    B: ['AFFECTS', 'AVAILABLE_IN'],
    C: ['AFFECTS', 'AVAILABLE_IN', 'MAPS_TO', 'SIMILAR_TO'],
  },
  weights: {},
  caps: {},
  label_version: '2',
}

export const STATS: Schemas['GraphStats'] = {
  nodes_by_label: { Game: 120, Incident: 25, Market: 4, BusinessConcept: 30 },
  relationships_by_type: {
    AFFECTS: 34,
    AVAILABLE_IN: 310,
    MAPS_TO: 124,
    SIMILAR_TO: 60,
  },
  ingestion_version: '2/abc',
  source: 'ingestion',
}

export const GAME_NODE: Schemas['NodeOut'] = {
  node_id: 'GAME_001',
  labels: ['Game'],
  properties: { id: 'GAME_001', name: 'Albion Millions 1', market_id: 'UK' },
  provenance: {
    table: 'games',
    row_id: 'GAME_001',
    dataset_id: 'dev-seed2026',
  },
}

export const NEIGHBOURS = (truncated = false): Schemas['Neighbours'] => ({
  node_id: 'GAME_001',
  truncated,
  items: [
    {
      rel_type: 'AFFECTS',
      direction: 'in',
      node: {
        node_id: 'INC_007',
        labels: ['Incident'],
        properties: { id: 'INC_007', summary: 'Checkout failed' },
        provenance: null,
      },
    },
    {
      rel_type: 'AVAILABLE_IN',
      direction: 'out',
      node: {
        node_id: 'UK',
        labels: ['Market'],
        properties: { id: 'UK', name: 'United Kingdom' },
        provenance: null,
      },
    },
  ],
})
