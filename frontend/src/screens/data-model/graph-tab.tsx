/**
 * The Graph tab: the graph's kinds of record sized by count, with the
 * relationships between them, for the relationships each approach may follow
 * or the whole schema; choosing a kind shows its properties and a sample
 * node. A node address in the route (`?node=`) shows that node with a bounded
 * set of its neighbours, which is where "Follow into the graph" lands.
 */

import { ArrowRight } from 'lucide-react'
import { useState, type ReactNode } from 'react'

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
import { GraphWhy } from './why'
import { ClickHint, ExploreSteps, Trail } from './explore'
import { STEPS } from './explore-steps'
import { NEXT_STEP } from './explorer'
import { nodeLabel } from '../../design/node-labels'
import { pipeline } from '../../design/pipelines'
import {
  RELATIONSHIP_SOURCES,
  relationshipPhrase,
} from '../../design/relationships'
import { Diagram } from './meta-graph'
import {
  count,
  metaGraphModel,
  relationshipRows,
  type AllowList,
  type DiagramEdge,
  type DiagramNode,
  type RelationshipRow,
} from './model'
import { MISSING } from '../../app/score-words'
import { ScrollBox } from '../../components/scroll-box'

type Node = Schemas['NodeOut']

/** How many neighbours of a node are asked for; the server allows 100. */
export const NEIGHBOUR_LIMIT = 20

const MODES: { id: AllowList; label: string }[] = [
  { id: 'B', label: pipeline('B').label },
  { id: 'C', label: pipeline('C').label },
  { id: 'full', label: 'All links' },
]

/** Links to documents, which every approach reaches by text search instead. */
const DOCUMENT_LINKS = new Set(['HAS_CHUNK', 'REFERENCES'])

/** The groups of the table: who may walk a kind of link, and why when not both. */
const LINK_GROUPS: readonly {
  id: string
  title: string
  why?: string
  holds: (row: RelationshipRow) => boolean
}[] = [
  {
    id: 'both',
    title: 'Followed by Graph and Graph + Ontology',
    holds: (row) => row.follower === 'both',
  },
  {
    id: 'b',
    title: 'Followed by Graph only',
    holds: (row) => row.follower === 'B',
  },
  {
    id: 'c',
    title: 'Followed by Graph + Ontology only',
    why: 'These come from the ontology.',
    holds: (row) => row.follower === 'C',
  },
  {
    id: 'documents',
    title: 'Followed by neither',
    why: 'Documents are found by text search, in all three approaches.',
    holds: (row) => row.follower === 'neither' && DOCUMENT_LINKS.has(row.type),
  },
  {
    id: 'focus',
    title: 'Followed by neither',
    why: 'Left out to keep the search focused: these are many, or lead to many records.',
    holds: (row) => row.follower === 'neither' && !DOCUMENT_LINKS.has(row.type),
  },
]

function RelationshipTable({ rows }: { rows: RelationshipRow[] }) {
  return (
    <section aria-labelledby="links-title" className="space-y-2">
      <h2
        id="links-title"
        className="text-base font-semibold text-text-primary"
      >
        Kinds of link
      </h2>
      <p className="max-w-prose text-sm text-text-secondary">
        A link joins two records, such as an incident and the game it affects.
        Each row says what a kind of link joins, where it is made from, and how
        many there are. Graph and Graph + Ontology search by moving along links;
        some kinds are left out on purpose, and each group says why.
      </p>
      <ScrollBox label="Kinds of link">
        <table className="w-full max-w-6xl border-collapse text-sm text-text-primary">
          <thead>
            <tr className="border-b border-hairline text-left text-text-secondary">
              <th scope="col" className="py-2 pr-4 font-semibold">
                What it links
              </th>
              <th scope="col" className="py-2 pr-4 font-semibold">
                Made from
              </th>
              <th scope="col" className="py-2 pl-3 text-right font-semibold">
                How many
              </th>
            </tr>
          </thead>
          {LINK_GROUPS.map((group) => {
            const members = rows.filter(group.holds)
            if (members.length === 0) return null
            return (
              <tbody key={group.id}>
                <tr>
                  <th
                    scope="colgroup"
                    colSpan={3}
                    className="pb-1 pt-4 text-left font-normal"
                  >
                    <span className="font-semibold">{group.title}</span>
                    {group.why && (
                      <span className="text-text-secondary">{` - ${group.why}`}</span>
                    )}
                  </th>
                </tr>
                {members.map((row) => (
                  <tr key={row.type} className="border-b border-hairline">
                    <th
                      scope="row"
                      className="py-1.5 pr-4 text-left font-normal"
                    >
                      {row.sentences.join('; ')}
                    </th>
                    <td className="py-1.5 pr-4 text-text-secondary">
                      {RELATIONSHIP_SOURCES[row.type] ?? MISSING}
                    </td>
                    <td className="tabular py-1.5 pl-3 text-right">
                      {row.total === null ? MISSING : count(row.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            )
          })}
        </table>
      </ScrollBox>
    </section>
  )
}

const ALL_KINDS = {
  label: 'All kinds of record',
  href: hrefFor('data-model', { tab: 'graph' }),
}

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
          <p className="text-sm text-text-secondary">{`Built from ${table}. One sample record:`}</p>
          <Properties node={load.data} />
          <a
            href={hrefFor('data-model', {
              tab: 'graph',
              node: load.data.node_id,
            })}
            className={NEXT_STEP}
          >
            Open this record in the graph
            <ArrowRight aria-hidden="true" className="size-4" />
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
  about,
}: {
  schema: Schemas['GraphSchema']
  stats: Schemas['GraphStats']
  scale: number
  /** How the graph is built, between the map and the table of links. */
  about: ReactNode
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
  const { nodes, isolated, hasOutside } = model
  const rows = relationshipRows(schema, stats)
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
        aria-labelledby="links-shown"
        className="flex flex-wrap items-center gap-2"
      >
        <span id="links-shown" className="text-sm text-text-secondary">
          Show the links followed by
        </span>
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
          ? `All ${typeCount.size} kinds of link.${hasOutside ? ' Dashed grey lines: followed by neither approach.' : ''}`
          : `${MODES.find((m) => m.id === mode)?.label} follows ${followed} of the ${typeCount.size} kinds of link.`}
      </p>
      <p className="text-sm text-text-secondary">
        Each box is a kind of record, with how many there are; each line is a
        kind of link.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <ClickHint>Click a box for its details and a sample record.</ClickHint>
        {label !== null && (
          <button
            type="button"
            onClick={() => setLabel(null)}
            className="rounded-chip border border-border px-2 py-0.5 text-sm text-text-primary hover:bg-surface-raised"
          >
            Show all links again
          </button>
        )}
      </div>
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
          aria-label="Kinds with no links"
          className="flex flex-wrap items-center gap-2 text-sm text-text-secondary"
        >
          <h2 className="text-base font-semibold text-text-primary">
            Reference lists with no links
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
      {about}
      <RelationshipTable rows={rows} />
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
        <Trail steps={[ALL_KINDS, { label: nodeId }]} />
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
      <Trail
        steps={[
          ALL_KINDS,
          {
            label: `${titleOf(node)} (${node.labels.map(nodeLabel).join(', ')})`,
          },
        ]}
        hint="Click any record around it to move there. Its details are on the right."
      />
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
        message="None yet."
        error={load.status === 'error' ? load.error : undefined}
        onRetry={load.retry}
      />
    )
  return (
    <div className="space-y-4">
      <ExploreSteps steps={STEPS.graph} />
      <KindsMap
        schema={load.data.schema}
        stats={load.data.stats}
        scale={scale}
        about={<GraphWhy caps={load.data.schema.caps} />}
      />
    </div>
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
