/**
 * Synthetic answers for the Data Model routes in the mock API: a dictionary of
 * ten tables across five source systems, rows generated from it (paged, and
 * filtered the way the backend filters: the value is read as the column's own
 * type, and a value that does not fit is a 422), records with their graph
 * node, and the graph's schema, counts, nodes and neighbours.
 */

type Kind = 'VARCHAR' | 'INTEGER' | 'DOUBLE' | 'TIMESTAMP'
type Column = [name: string, kind: Kind]

interface TableDef {
  table: string
  system: string
  rows: number
  columns: Column[]
  links?: [column: string, parent: string][]
  /** The graph label the table's rows become, when they become nodes. */
  label?: string
}

const TABLES: TableDef[] = [
  {
    table: 'markets',
    system: 'warehouse',
    rows: 4,
    label: 'Market',
    columns: [
      ['market_id', 'VARCHAR'],
      ['name', 'VARCHAR'],
      ['opened_at', 'TIMESTAMP'],
    ],
  },
  {
    table: 'games',
    system: 'warehouse',
    rows: 120,
    label: 'Game',
    columns: [
      ['game_id', 'VARCHAR'],
      ['name', 'VARCHAR'],
      ['market_id', 'VARCHAR'],
      ['ticket_price', 'DOUBLE'],
      ['launched_at', 'TIMESTAMP'],
    ],
    links: [['market_id', 'markets']],
  },
  {
    table: 'players',
    system: 'warehouse',
    rows: 1200,
    label: 'Player',
    columns: [
      ['player_id', 'VARCHAR'],
      ['market_id', 'VARCHAR'],
      ['segment', 'VARCHAR'],
      ['registered_at', 'TIMESTAMP'],
    ],
    links: [['market_id', 'markets']],
  },
  {
    table: 'tickets',
    system: 'warehouse',
    rows: 4200,
    columns: [
      ['ticket_id', 'VARCHAR'],
      ['game_id', 'VARCHAR'],
      ['player_id', 'VARCHAR'],
      ['quantity', 'INTEGER'],
      ['sold_at', 'TIMESTAMP'],
    ],
    links: [
      ['game_id', 'games'],
      ['player_id', 'players'],
    ],
  },
  {
    table: 'incidents',
    system: 'incident_management',
    rows: 25,
    label: 'Incident',
    columns: [
      ['incident_id', 'VARCHAR'],
      ['market_id', 'VARCHAR'],
      ['summary', 'VARCHAR'],
      ['started_at', 'TIMESTAMP'],
    ],
    links: [['market_id', 'markets']],
  },
  {
    table: 'platforms',
    system: 'release_management',
    rows: 6,
    label: 'Platform',
    columns: [
      ['platform_id', 'VARCHAR'],
      ['name', 'VARCHAR'],
    ],
  },
  {
    table: 'platform_versions',
    system: 'release_management',
    rows: 31,
    label: 'PlatformVersion',
    columns: [
      ['platform_version_id', 'VARCHAR'],
      ['platform_id', 'VARCHAR'],
      ['released_at', 'TIMESTAMP'],
    ],
    links: [['platform_id', 'platforms']],
  },
  {
    table: 'sessions',
    system: 'telemetry_platform',
    rows: 9000,
    columns: [
      ['session_id', 'VARCHAR'],
      ['player_id', 'VARCHAR'],
      ['started_at', 'TIMESTAMP'],
    ],
    links: [['player_id', 'players']],
  },
  {
    table: 'documents',
    system: 'document_store',
    rows: 180,
    label: 'Document',
    columns: [
      ['document_id', 'VARCHAR'],
      ['title', 'VARCHAR'],
      ['market_id', 'VARCHAR'],
    ],
    links: [['market_id', 'markets']],
  },
  {
    table: 'document_chunks',
    system: 'document_store',
    rows: 1204,
    label: 'DocumentChunk',
    columns: [
      ['chunk_id', 'VARCHAR'],
      ['document_id', 'VARCHAR'],
      ['text', 'VARCHAR'],
    ],
    links: [['document_id', 'documents']],
  },
]

export const DATASET_ID = 'dev-seed2026'

export const ROW_COUNTS = Object.fromEntries(
  TABLES.map((t) => [t.table, t.rows]),
)

export const DICTIONARY = TABLES.map((t) => ({
  table: t.table,
  source_system: t.system,
  primary_key: t.columns[0][0],
  columns: t.columns.map(([name, type]) => ({
    name,
    type,
    description: null,
  })),
  foreign_keys: (t.links ?? []).map(([column, parent]) => ({
    column,
    table: parent,
    ref_column: TABLES.find((p) => p.table === parent)!.columns[0][0],
  })),
  provenance: null,
  dictionary_source: 'world',
}))

const MARKETS = ['UK', 'GR', 'AT', 'CZ']
const GAME_NAMES = [
  'Albion Millions',
  'Aegean Gold',
  'Alpine Fortune',
  'Vltava Draw',
]

const prefixOf = (def: TableDef) =>
  def.columns[0][0].replace(/_id$/, '').toUpperCase()

/** Markets carry their country code as the id; every other row is PREFIX_001. */
const idOf = (def: TableDef, n: number) =>
  def.table === 'markets'
    ? MARKETS[n - 1]
    : `${prefixOf(def)}_${String(n).padStart(3, '0')}`

/** The row number an id names in a table, or NaN when it names none. */
const numberOf = (def: TableDef, id: string) =>
  def.table === 'markets'
    ? MARKETS.indexOf(id) + 1
    : id.startsWith(`${prefixOf(def)}_`)
      ? Number(id.slice(prefixOf(def).length + 1))
      : Number.NaN

/** Three distinct timestamps in March 2026, so a filter on one matches a third of a table. */
const stamp = (n: number) => `2026-03-0${1 + (n % 3)}T10:15:00`

function cell(def: TableDef, [name, kind]: Column, n: number): string | number {
  if (name === def.columns[0][0]) return idOf(def, n)
  if (kind === 'TIMESTAMP') return stamp(n)
  if (kind === 'INTEGER') return 1 + (n % 5)
  if (kind === 'DOUBLE') return 1 + (n % 4) * 0.5
  if (name === 'market_id') return MARKETS[n % MARKETS.length]
  if (name === 'name' && def.table === 'markets')
    return ['United Kingdom', 'Greece', 'Austria', 'Czech Republic'][n - 1]
  if (name === 'name')
    return def.table === 'games'
      ? `${GAME_NAMES[n % GAME_NAMES.length]} ${n}`
      : `${def.table.slice(0, -1)} ${n}`
  if (name === 'summary') return `Checkout failed for part of the day (${n})`
  if (name === 'title') return `Weekly report ${n}`
  if (name === 'text')
    return `Sales rose in week ${n % 52} after the promotion.`
  if (name === 'segment') return ['casual', 'regular', 'high value'][n % 3]
  const parent = def.links?.find(([column]) => column === name)?.[1]
  const target = TABLES.find((t) => t.table === parent)
  return target ? idOf(target, 1 + (n % target.rows)) : `${name} ${n}`
}

const row = (def: TableDef, n: number) =>
  Object.fromEntries(def.columns.map((c) => [c[0], cell(def, c, n)]))

/** Whether `value` is a legal value of `kind`, as the backend's cast decides. */
const fits = (kind: Kind, value: string) =>
  kind === 'TIMESTAMP'
    ? /^\d{4}-\d\d-\d\d([T ]\d\d:\d\d(:\d\d)?)?$/.test(value) &&
      !Number.isNaN(Date.parse(value))
    : kind === 'VARCHAR' || !Number.isNaN(Number(value))

const same = (kind: Kind, a: string | number, b: string) =>
  kind === 'TIMESTAMP'
    ? Date.parse(String(a)) === Date.parse(b)
    : kind === 'VARCHAR'
      ? String(a) === b
      : Number(a) === Number(b)

export interface Answer {
  status: number
  body: unknown
}

const failure = (status: number, code: string, message: string): Answer => ({
  status,
  body: { error: { error_code: code, message, retryable: false } },
})

export function rowsOf(table: string, query: URLSearchParams): Answer {
  const def = TABLES.find((t) => t.table === table)
  if (!def) return failure(422, 'VALIDATION_ERROR', `unknown table: ${table}`)
  const offset = Number(query.get('offset') ?? 0)
  const limit = Number(query.get('limit') ?? 50)
  if (limit > 200)
    return failure(422, 'VALIDATION_ERROR', 'limit must be at most 200')
  const column = query.get('column')
  const value = query.get('value')
  let numbers = Array.from({ length: def.rows }, (_, i) => i + 1)
  if (column !== null && value !== null) {
    const found = def.columns.find((c) => c[0] === column)
    if (!found)
      return failure(422, 'VALIDATION_ERROR', `unknown column: ${column}`)
    if (!fits(found[1], value))
      return failure(
        422,
        'VALIDATION_ERROR',
        `'${value}' is not a ${found[1]} value for ${column}`,
      )
    numbers = numbers.filter((n) => same(found[1], cell(def, found, n), value))
  }
  return {
    status: 200,
    body: {
      table,
      offset,
      limit,
      total: numbers.length,
      rows: numbers.slice(offset, offset + limit).map((n) => row(def, n)),
    },
  }
}

export function recordOf(table: string, id: string): Answer {
  const def = TABLES.find((t) => t.table === table)
  const n = def ? numberOf(def, id) : Number.NaN
  if (!def || !(n >= 1 && n <= def.rows))
    return failure(404, 'NOT_FOUND', `no ${table} row with id ${id}`)
  return {
    status: 200,
    body: {
      table,
      row: row(def, n),
      graph_node_id: def.label ? id : null,
      edges: def.label
        ? [
            { type: 'AVAILABLE_IN', direction: 'out', count: 1 },
            { type: 'AFFECTS', direction: 'in', count: 2 },
          ]
        : [],
      graph_error: null,
    },
  }
}

const RELATIONSHIPS: [string, string, string][] = [
  ['AFFECTS', 'Incident', 'Game'],
  ['AFFECTS_MARKET', 'Incident', 'Market'],
  ['AVAILABLE_IN', 'Game', 'Market'],
  ['FROM_MARKET', 'Document', 'Market'],
  ['HAS_CHUNK', 'Document', 'DocumentChunk'],
  ['MAPS_TO', 'Game', 'BusinessConcept'],
  ['MAPS_TO', 'Market', 'BusinessConcept'],
  ['PLAYS', 'Player', 'Game'],
  ['RELATED_TO', 'Incident', 'Platform'],
  ['SIMILAR_TO', 'Game', 'Game'],
  ['VERSION_OF', 'PlatformVersion', 'Platform'],
]

const LABELS = [
  ...TABLES.flatMap((t) => (t.label ? [t.label] : [])),
  'BusinessConcept',
]

export const GRAPH_SCHEMA = {
  labels: LABELS,
  node_tables: Object.fromEntries(
    TABLES.flatMap((t) => (t.label ? [[t.label, t.table]] : [])),
  ),
  relationship_types: RELATIONSHIPS.map(([type, from_label, to_label]) => ({
    type,
    from_label,
    to_label,
  })),
  allow_list: {
    B: [
      'AFFECTS',
      'AFFECTS_MARKET',
      'AVAILABLE_IN',
      'FROM_MARKET',
      'HAS_CHUNK',
      'PLAYS',
      'RELATED_TO',
      'VERSION_OF',
    ],
    C: [
      'AFFECTS',
      'AFFECTS_MARKET',
      'AVAILABLE_IN',
      'FROM_MARKET',
      'HAS_CHUNK',
      'MAPS_TO',
      'PLAYS',
      'RELATED_TO',
      'SIMILAR_TO',
      'VERSION_OF',
    ],
  },
  weights: {},
  caps: {},
  label_version: '2',
}

export const GRAPH_STATS = {
  nodes_by_label: {
    ...Object.fromEntries(
      TABLES.flatMap((t) => (t.label ? [[t.label, t.rows]] : [])),
    ),
    BusinessConcept: 64,
  },
  relationships_by_type: {
    AFFECTS: 41,
    AFFECTS_MARKET: 25,
    AVAILABLE_IN: 310,
    FROM_MARKET: 180,
    HAS_CHUNK: 1204,
    MAPS_TO: 124,
    PLAYS: 5230,
    RELATED_TO: 18,
    SIMILAR_TO: 260,
    VERSION_OF: 31,
  },
  ingestion_version: '2/9f3c1a',
  source: 'ingestion',
}

/** A graph node for a table row id, or null for an id no table holds. */
export function graphNode(id: string) {
  for (const def of TABLES) {
    const n = numberOf(def, id)
    if (def.label && n >= 1 && n <= def.rows)
      return {
        node_id: id,
        labels: [def.label],
        properties: { id, ...row(def, n) },
        provenance: { table: def.table, row_id: id, dataset_id: DATASET_ID },
      }
  }
  return null
}

export function neighboursOf(id: string, limit: number): Answer {
  const node = graphNode(id)
  if (!node) return failure(404, 'NOT_FOUND', `no graph node with id ${id}`)
  const items = [
    ['AVAILABLE_IN', 'out', 'UK'],
    ['AFFECTS', 'in', 'INCIDENT_007'],
    ['AFFECTS', 'in', 'INCIDENT_011'],
    ['PLAYS', 'in', 'PLAYER_014'],
    ['PLAYS', 'in', 'PLAYER_208'],
    ['SIMILAR_TO', 'out', 'GAME_042'],
  ]
    .flatMap(([rel_type, direction, other]) => {
      const found = graphNode(other)
      return found && found.node_id !== id
        ? [{ rel_type, direction, node: found }]
        : []
    })
    .slice(0, limit)
  return { status: 200, body: { node_id: id, items, truncated: false } }
}
