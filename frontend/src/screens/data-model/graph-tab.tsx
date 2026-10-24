/**
 * The Graph tab: the graph's kinds of record sized by count, with the
 * relationships between them, for the relationships each approach may follow
 * or the whole schema; choosing a kind shows its properties and a sample
 * node. A node address in the route (`?node=`) shows that node with a bounded
 * set of its neighbours, which is where "Follow into the graph" lands.
 */

import { useState } from 'react'

import {
  getDictionary,
  getGraphSchema,
  getGraphStats,
  getNeighbours,
  getNode,
  getRows,
  listDatasets,
  type Schemas,
} from '../../api/client'
import { distinctFields, plainName, plainValue } from '../../app/plain-words'
import { hrefFor } from '../../app/router'
import { useLoad } from '../../app/use-load'
import { Drawer } from '../../components/drawer'
import { Panel } from '../../components/panel'
import { nodeLabel } from '../../design/node-labels'
import { pipeline } from '../../design/pipelines'
import { relationshipPhrase } from '../../design/relationships'
import { Diagram } from './meta-graph'
import {
  metaGraphModel,
  type AllowList,
  type DiagramEdge,
  type DiagramNode,
} from './model'

type Node = Schemas['NodeOut']

/** How many neighbours of a node are asked for; the server allows 100. */
export const NEIGHBOUR_LIMIT = 20

const MODES: { id: AllowList; label: string }[] = [
  { id: 'B', label: pipeline('B').label },
  { id: 'C', label: pipeline('C').label },
  { id: 'full', label: 'Full schema' },
]

const backToKinds = (
  <a
    href={hrefFor('data-model', { tab: 'graph' })}
    className="text-sm text-text-primary underline"
  >
    All kinds of record
  </a>
)

function Properties({ node }: { node: Node }) {
  return (
    <dl className="space-y-2">
      {distinctFields(node.properties).map(([name, value]) => (
        <div key={name} className="grid grid-cols-[9rem_1fr] gap-x-4 text-sm">
          <dt className="text-text-muted">{plainName(name)}</dt>
          <dd className="min-w-0 break-words text-text-primary">
            {plainValue(value)}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** The first row of the kind's table, followed to its graph node; null when the table is empty. */
async function sampleOf(
  table: string,
  signal: AbortSignal,
): Promise<Node | null> {
  const worlds = await listDatasets(signal)
  const world = worlds.find((w) => w.active) ?? worlds[0]
  if (!world) return null
  const dictionary = await getDictionary(world.dataset_id, signal)
  const key = dictionary.find((t) => t.table === table)?.primary_key
  if (!key) return null
  const page = await getRows(world.dataset_id, table, { limit: 1 }, signal)
  const row = page.rows[0]
  return row ? getNode(String(row[key]), signal) : null
}

function SampleNode({ table }: { table: string }) {
  const load = useLoad((signal) => sampleOf(table, signal), `sample/${table}`)
  const empty = load.status === 'ready' && load.data === null
  return (
    <Panel
      title="Details"
      state={empty ? 'empty' : load.status}
      message="No rows, so no sample."
      error={load.status === 'error' ? load.error : undefined}
      onRetry={load.retry}
    >
      {load.status === 'ready' && load.data && (
        <div className="space-y-3">
          <p className="text-sm text-text-secondary">{`Built from ${table}. One sample node:`}</p>
          <Properties node={load.data} />
          <a
            href={hrefFor('data-model', {
              tab: 'graph',
              node: load.data.node_id,
            })}
            className="block text-sm font-medium text-text-primary underline"
          >
            Open this node in the graph
          </a>
        </div>
      )}
    </Panel>
  )
}

function Details({
  label,
  schema,
  onClose,
}: {
  label: string | null
  schema: Schemas['GraphSchema']
  onClose: () => void
}) {
  const table = label === null ? undefined : schema.node_tables[label]
  return (
    <Drawer
      open={label !== null}
      title={label === null ? '' : nodeLabel(label)}
      onClose={onClose}
    >
      {label !== null && table === undefined && (
        <Panel
          title="Details"
          state="disabled"
          message="Built from the ontology: no sample row."
        />
      )}
      {table !== undefined && <SampleNode key={table} table={table} />}
    </Drawer>
  )
}

function KindsMap({
  schema,
  stats,
  scale,
}: {
  schema: Schemas['GraphSchema']
  stats: Schemas['GraphStats']
  scale: number
}) {
  const [mode, setMode] = useState<AllowList>('full')
  // The kind chosen stays chosen (its lines are tagged, the rest pale) when
  // its details are closed, until the reader clears it.
  const [label, setLabel] = useState<string | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const choose = (id: string) => {
    setLabel(id)
    setDetailsOpen(true)
  }
  const model = metaGraphModel(schema, stats, mode, scale)
  const { nodes, isolated, types, hasOutside } = model
  const edges = model.edges.map((edge) => {
    const touches = edge.source === label || edge.target === label
    return {
      ...edge,
      tagged: touches,
      faint: label !== null && !touches,
    }
  })
  const typeCount = new Set(schema.relationship_types.map((r) => r.type))
  const followed = mode === 'full' ? null : schema.allow_list[mode]?.length

  return (
    <div className="space-y-3">
      <div
        role="radiogroup"
        aria-label="Relationships shown"
        className="flex flex-wrap gap-2"
      >
        {MODES.map((option) => (
          <label
            key={option.id}
            className="flex cursor-pointer items-center gap-2 rounded-chip border border-border px-3 py-1 text-sm text-text-primary has-[:checked]:bg-surface-raised has-[:checked]:font-semibold has-[:focus-visible]:outline-2"
          >
            <input
              type="radio"
              name="allow-list"
              checked={mode === option.id}
              onChange={() => setMode(option.id)}
            />
            {option.label}
          </label>
        ))}
      </div>
      <p className="text-sm text-text-secondary">
        {followed === null
          ? `Every relationship in the schema, ${typeCount.size} types.${hasOutside ? ' Dashed grey lines are followed by neither approach.' : ''}`
          : `${MODES.find((m) => m.id === mode)?.label} follows ${followed} of the ${typeCount.size} relationship types.`}
      </p>
      <p className="text-sm text-text-secondary">
        Choose a kind of record.
        {label !== null && (
          <button
            type="button"
            onClick={() => setLabel(null)}
            className="ml-3 rounded-chip border border-border px-2 py-0.5 text-text-primary hover:bg-surface-raised"
          >
            Show all relationships
          </button>
        )}
      </p>
      <Diagram
        nodes={nodes}
        edges={edges}
        label="Kinds of record"
        selected={label}
        onSelect={choose}
        scale={scale}
      />
      {isolated.length > 0 && (
        <section
          aria-label="Kinds with no relationships"
          className="flex flex-wrap items-center gap-2 text-sm text-text-secondary"
        >
          <h2 className="text-base font-semibold text-text-primary">
            No relationships in the schema
          </h2>
          {isolated.map((node) => (
            <button
              key={node.id}
              type="button"
              aria-pressed={label === node.id}
              aria-label={`${node.title}, ${node.detail}`}
              onClick={() => choose(node.id)}
              className="rounded-chip border border-border px-3 py-1 text-text-primary hover:bg-surface-raised aria-pressed:bg-surface-raised aria-pressed:font-semibold"
            >
              {`${node.title} · ${node.detail}`}
            </button>
          ))}
        </section>
      )}
      <section aria-label="Relationships">
        <h2 className="text-base font-semibold text-text-primary">
          Relationships
        </h2>
        <ul className="mt-2 columns-3 gap-6 text-sm text-text-primary">
          {types.map((line) => (
            <li key={line.type} className="break-inside-avoid py-0.5">
              {line.text}
              {line.note && (
                <span className="text-text-muted">{` (${line.note})`}</span>
              )}
            </li>
          ))}
        </ul>
      </section>
      <Details
        label={detailsOpen ? label : null}
        schema={schema}
        onClose={() => setDetailsOpen(false)}
      />
    </div>
  )
}

const titleOf = (node: Node): string => {
  const { name, title } = node.properties
  return typeof name === 'string'
    ? name
    : typeof title === 'string'
      ? title
      : node.node_id
}

function FocusedNode({ nodeId, scale }: { nodeId: string; scale: number }) {
  const load = useLoad(async (signal) => {
    const [node, neighbours] = await Promise.all([
      getNode(nodeId, signal),
      getNeighbours(nodeId, { limit: NEIGHBOUR_LIMIT }, signal),
    ])
    return { node, neighbours }
  }, `node/${nodeId}`)
  if (load.status !== 'ready')
    return (
      <div className="space-y-3">
        {backToKinds}
        <Panel
          title="Node"
          state={load.status}
          error={load.status === 'error' ? load.error : undefined}
          onRetry={load.retry}
        />
      </div>
    )

  const { node, neighbours } = load.data
  const unique = new Map(neighbours.items.map((i) => [i.node.node_id, i.node]))
  const nodes: DiagramNode[] = [
    ...[node, ...unique.values()].map((n) => ({
      id: n.node_id,
      title: titleOf(n),
      detail: n.labels.map(nodeLabel).join(', '),
      width: Math.round(Math.max(190, titleOf(n).length * 12 + 40) * scale),
    })),
  ]
  const edges: DiagramEdge[] = neighbours.items.map((item) => ({
    id: `${item.rel_type}:${item.direction}:${item.node.node_id}`,
    source: item.direction === 'out' ? node.node_id : item.node.node_id,
    target: item.direction === 'out' ? item.node.node_id : node.node_id,
    label: relationshipPhrase(item.rel_type),
  }))

  return (
    <div className="space-y-3">
      {backToKinds}
      <div className="grid grid-cols-[minmax(0,1fr)_26rem] items-start gap-4">
        <div className="space-y-3">
          <Diagram
            nodes={nodes}
            edges={edges}
            label={`${titleOf(node)} and its neighbours`}
            selected={node.node_id}
            scale={scale}
            onSelect={(id) => {
              if (id !== node.node_id)
                window.location.hash = hrefFor('data-model', {
                  tab: 'graph',
                  node: id,
                })
            }}
          />
          {neighbours.truncated && (
            <p className="text-sm text-text-secondary">
              {`Showing the first ${NEIGHBOUR_LIMIT}.`}
            </p>
          )}
        </div>
        <Panel title="Properties" state="ready">
          <div className="space-y-3">
            {node.provenance && (
              <p className="text-sm text-text-secondary">
                {`Built from ${node.provenance.table}, row ${node.provenance.row_id}`}
              </p>
            )}
            <Properties node={node} />
          </div>
        </Panel>
      </div>
    </div>
  )
}

function Kinds({ scale }: { scale: number }) {
  const load = useLoad(async (signal) => {
    const [schema, stats] = await Promise.all([
      getGraphSchema(signal),
      getGraphStats(signal),
    ])
    return { schema, stats }
  }, 'graph-map')
  const empty = load.status === 'ready' && load.data.schema.labels.length === 0
  if (load.status !== 'ready' || empty)
    return (
      <Panel
        title="Kinds of record"
        state={empty ? 'empty' : load.status}
        message="The graph has no kinds of record yet."
        error={load.status === 'error' ? load.error : undefined}
        onRetry={load.retry}
      />
    )
  return (
    <KindsMap schema={load.data.schema} stats={load.data.stats} scale={scale} />
  )
}

export function GraphTab({
  params,
  scale,
}: {
  params: URLSearchParams
  scale: number
}) {
  const nodeId = params.get('node')
  return nodeId === null ? (
    <Kinds scale={scale} />
  ) : (
    <FocusedNode nodeId={nodeId} scale={scale} />
  )
}
