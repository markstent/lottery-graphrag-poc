/**
 * Answers for the Data Model routes in the mock API, from a capture of the
 * dev world (`scripts/capture-data-model.mjs`): its dictionary, graph schema
 * and counts as the API gave them, and rows of every table (a table over the
 * cap is a sample spread across the whole table). Rows are paged and filtered
 * the way the backend does: the value is read as the column's own type, and a
 * value that does not fit is a 422. A record's graph node, its edge summary
 * and a node's neighbours are worked out from the rows themselves, by the
 * dictionary's foreign keys and the graph schema's relationship types, so
 * nothing about the graph is listed by hand.
 */

import captured from './fixtures/data-model-world.json' with { type: 'json' }

interface Column {
  name: string
  type: string
}
interface ForeignKey {
  column: string
  table: string
  ref_column: string
}
interface TableDef {
  table: string
  source_system: string
  primary_key: string
  columns: Column[]
  foreign_keys: ForeignKey[]
}
type Row = Record<string, unknown>
type Node = ReturnType<typeof nodeOf>

const world = captured as unknown as {
  dataset_id: string
  dictionary: TableDef[]
  schema: {
    labels: string[]
    allow_list: Record<string, string[]>
    node_tables: Record<string, string>
    relationship_types: { type: string; from_label: string; to_label: string }[]
  }
  stats: unknown
  rows: Record<string, Row[]>
}

export const DATASET_ID = world.dataset_id
export const DICTIONARY = world.dictionary
export const GRAPH_SCHEMA = world.schema
export const GRAPH_STATS = world.stats
export const ROW_COUNTS = Object.fromEntries(
  Object.entries(world.rows).map(([table, rows]) => [table, rows.length]),
)

export interface Answer {
  status: number
  body: unknown
}

const failure = (status: number, code: string, message: string): Answer => ({
  status,
  body: { error: { error_code: code, message, retryable: false } },
})

const tableDef = (table: string) =>
  world.dictionary.find((t) => t.table === table)

/** Whether `value` is a legal value of `type`, as the backend's cast decides. */
function fits(type: string, value: string): boolean {
  if (type === 'TIMESTAMP')
    return (
      /^\d{4}-\d\d-\d\d([T ]\d\d:\d\d(:\d\d)?)?$/.test(value) &&
      !Number.isNaN(Date.parse(value))
    )
  if (type === 'DATE')
    return /^\d{4}-\d\d-\d\d$/.test(value) && !Number.isNaN(Date.parse(value))
  if (type === 'BOOLEAN') return /^(true|false)$/i.test(value)
  if (type === 'INTEGER') return /^-?\d+$/.test(value)
  if (type === 'VARCHAR') return true
  return value.trim() !== '' && !Number.isNaN(Number(value))
}

function same(type: string, cell: unknown, value: string): boolean {
  if (cell === null || cell === undefined) return false
  if (type === 'TIMESTAMP' || type === 'DATE')
    return Date.parse(String(cell)) === Date.parse(value)
  if (type === 'BOOLEAN') return String(cell) === value.toLowerCase()
  if (type === 'VARCHAR') return String(cell) === value
  return Number(cell) === Number(value)
}

export function rowsOf(table: string, query: URLSearchParams): Answer {
  const def = tableDef(table)
  if (!def) return failure(422, 'VALIDATION_ERROR', `unknown table: ${table}`)
  const offset = Number(query.get('offset') ?? 0)
  const limit = Number(query.get('limit') ?? 50)
  if (limit > 200)
    return failure(422, 'VALIDATION_ERROR', 'limit must be at most 200')
  const column = query.get('column')
  const value = query.get('value')
  let rows = world.rows[table]
  if (column !== null && value !== null) {
    const found = def.columns.find((c) => c.name === column)
    if (!found)
      return failure(422, 'VALIDATION_ERROR', `unknown column: ${column}`)
    if (!fits(found.type, value))
      return failure(
        422,
        'VALIDATION_ERROR',
        `'${value}' is not a ${found.type} value for ${column}`,
      )
    rows = rows.filter((row) => same(found.type, row[column], value))
  }
  return {
    status: 200,
    body: {
      table,
      offset,
      limit,
      total: rows.length,
      rows: rows.slice(offset, offset + limit),
    },
  }
}

// ---- the graph, worked out from the rows ----

const labelOfTable = Object.fromEntries(
  Object.entries(world.schema.node_tables).map(([label, table]) => [
    table,
    label,
  ]),
)

function nodeOf(label: string, table: string, row: Row, id: string) {
  const def = tableDef(table)!
  return {
    node_id: id,
    labels: [label],
    properties: {
      id,
      ...row,
      // The graph names a node's title `name`, whatever the table calls it.
      name: row[Object.keys(row).find((key) => /(^|_)name$/.test(key)) ?? ''],
      source_record_id: id,
      source_system: def.source_system,
      source_table: table,
    },
    provenance: { table, row_id: id, dataset_id: DATASET_ID },
  }
}

/** Every row of a table that becomes nodes, by node id (the primary key). */
const nodes = new Map<string, Node>()
for (const [table, label] of Object.entries(labelOfTable)) {
  const key = tableDef(table)!.primary_key
  for (const row of world.rows[table]) {
    const id = String(row[key])
    nodes.set(id, nodeOf(label, table, row, id))
  }
}

const relationshipBetween = (from: string, to: string) =>
  world.schema.relationship_types.find(
    (r) => r.from_label === from && r.to_label === to,
  )?.type

interface Edge {
  type: string
  from: string
  to: string
}
const edges = new Map<string, Edge>()

function link(a: string, b: string) {
  const [x, y] = [nodes.get(a), nodes.get(b)]
  if (!x || !y || a === b) return
  const forward = relationshipBetween(x.labels[0], y.labels[0])
  const backward = relationshipBetween(y.labels[0], x.labels[0])
  const edge = forward
    ? { type: forward, from: a, to: b }
    : backward
      ? { type: backward, from: b, to: a }
      : null
  if (edge) edges.set(`${edge.type}:${edge.from}>${edge.to}`, edge)
}

/**
 * The parent node table a column points at: the dictionary's foreign key, or
 * a node table whose primary key has the column's name (a player_id column).
 */
const parentOf = (def: TableDef, column: string) =>
  def.foreign_keys.find((fk) => fk.column === column)?.table ??
  world.dictionary.find(
    (t) => t.primary_key === column && labelOfTable[t.table] !== undefined,
  )?.table

for (const def of world.dictionary) {
  const parents = def.columns
    .map((c) => [c.name, parentOf(def, c.name)] as const)
    .filter(
      (pair): pair is readonly [string, string] =>
        pair[1] !== undefined &&
        pair[1] !== def.table &&
        labelOfTable[pair[1]] !== undefined,
    )
  for (const row of world.rows[def.table]) {
    const ids = parents.map(([column]) => row[column]).filter((v) => v != null)
    const own = labelOfTable[def.table] ? [String(row[def.primary_key])] : []
    // A node table links its row to what it points at; any other table that
    // points at two or more nodes is a link between them.
    const group = own.length ? [own[0], ...ids.map(String)] : ids.map(String)
    if (own.length) for (const id of ids) link(own[0], String(id))
    else
      for (let i = 0; i < group.length; i++)
        for (let j = i + 1; j < group.length; j++) link(group[i], group[j])
  }
}

/** A graph node by id, or null for an id no node table holds. */
export const graphNode = (id: string) => nodes.get(id) ?? null

/** A node's neighbours, the rarer kinds of relationship first, so a cap keeps the varied ones. */
function itemsOf(id: string) {
  const items = [...edges.values()].flatMap((edge) => {
    const other = edge.from === id ? edge.to : edge.to === id ? edge.from : null
    const node = other === null ? null : nodes.get(other)
    return node
      ? [
          {
            rel_type: edge.type,
            direction: edge.from === id ? 'out' : 'in',
            node,
          },
        ]
      : []
  })
  const size = (type: string) => items.filter((i) => i.rel_type === type).length
  return items.sort((a, b) => size(a.rel_type) - size(b.rel_type))
}

export function neighboursOf(id: string, limit: number): Answer {
  if (!nodes.has(id))
    return failure(404, 'NOT_FOUND', `no graph node with id ${id}`)
  const items = itemsOf(id)
  return {
    status: 200,
    body: {
      node_id: id,
      items: items.slice(0, limit),
      truncated: items.length > limit,
    },
  }
}

export function recordOf(table: string, id: string): Answer {
  const def = tableDef(table)
  if (!def) return failure(422, 'VALIDATION_ERROR', `unknown table: ${table}`)
  const found = world.rows[table].filter(
    (r) => String(r[def.primary_key]) === id,
  )
  if (found.length === 0)
    return failure(
      404,
      'NOT_FOUND',
      `no ${table} row with ${def.primary_key} ${id}`,
    )
  if (found.length > 1)
    return failure(
      409,
      'CONFLICT',
      `row id ${id} is not unique in ${table}; filter its rows page instead`,
    )
  const isNode = labelOfTable[table] !== undefined
  const summary = new Map<
    string,
    { type: string; direction: string; count: number }
  >()
  for (const { rel_type, direction } of isNode ? itemsOf(id) : []) {
    const key = `${rel_type}:${direction}`
    const entry = summary.get(key) ?? { type: rel_type, direction, count: 0 }
    entry.count += 1
    summary.set(key, entry)
  }
  return {
    status: 200,
    body: {
      table,
      row: found[0],
      graph_node_id: isNode ? id : null,
      edges: [...summary.values()],
      graph_error: null,
    },
  }
}
