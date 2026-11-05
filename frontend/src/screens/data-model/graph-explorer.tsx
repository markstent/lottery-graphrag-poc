/**
 * The Graph tab (D-115): one record and its neighbours on the explorer
 * layout. Find a record by its id or choose a kind of record on the left (a
 * kind opens a sample record), see the record and its neighbours one step out
 * in the middle, and where it came from and its links on the right. Many
 * neighbours of one kind of link are one box (`neighbour-groups.ts`); choosing
 * the box lists them on the right. The record and the open box are in the
 * address (`tab=graph&node=<id>&group=<type>:<direction>`); with no record in
 * the address it opens on the example incident the Overview follows.
 */

import { ArrowLeft, ArrowRight } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'

import {
  getDataModelExample,
  getDictionary,
  getGraphSchema,
  getGraphStats,
  getNeighbours,
  getNode,
  getOntology,
  getRows,
  listDatasets,
  type Schemas,
} from '../../api/client'
import { ApiError } from '../../api/http'
import { distinctFields, plainName, plainValue } from '../../app/plain-words'
import { hrefFor } from '../../app/router'
import { useLoad } from '../../app/use-load'
import { ErrorNote } from '../../components/error-note'
import { Panel, SkeletonBar } from '../../components/panel'
import { nodeLabel } from '../../design/node-labels'
import { linkLines, relationshipPhrase } from '../../design/relationships'
import { graphAbout } from './about-copy'
import { AboutContent } from './about'
import { Explorer, ListSearch, NEXT_STEP, PickList } from './explorer'
import { KindsOfLink } from './graph-tab'
import { Diagram } from './meta-graph'
import {
  count,
  FOLLOWED_BY,
  FOLLOWER_ORDER,
  followerOf,
  otherKinds,
  type DiagramEdge,
  type DiagramNode,
} from './model'
import {
  GROUP_THRESHOLD,
  groupNeighbours,
  titleOf,
  type DiagramGroup,
} from './neighbour-groups'

type Node = Schemas['NodeOut']
type Schema = Schemas['GraphSchema']

/** How many neighbours one request asks for: the most the server gives. */
export const NEIGHBOUR_LIMIT = 100

/** Box titles in the drawing are drawn at the page's base type size. */
const TITLE_PX = 16

const STEPS = [
  'Choose a kind or find a record',
  'The record and its neighbours',
  'Its details',
] as const

const NOTE = 'text-sm text-text-secondary'
const NO_RECORD = 'No record with that id.'
const CHOOSE = 'Find a record by its id, or choose a kind of record.'
/** A group's members scroll inside their column below this height, as the Tables list. */
const COLUMN_SCROLL = 'max-h-[calc(100vh-14rem)] overflow-y-auto pr-1'

const show = (params: Record<string, string>) => {
  window.location.hash = hrefFor('data-model', { tab: 'graph', ...params })
}

const notFound = (error: Error) =>
  error instanceof ApiError && error.status === 404

const kindOf = (node: Node) => nodeLabel(node.labels[0] ?? 'record')

/** The record, with the neighbours the drawing needs. */
async function loadNeighbourhood(id: string, signal: AbortSignal) {
  const [node, first] = await Promise.all([
    getNode(id, signal),
    getNeighbours(id, { limit: NEIGHBOUR_LIMIT }, signal),
  ])
  // One page of neighbours can miss a kind of link with few neighbours behind
  // one with many; those few are drawn one by one, so ask for them by type.
  const key = (type: string, direction: string) => `${type}:${direction}`
  const read = new Map<string, number>()
  for (const item of first.items) {
    const k = key(item.rel_type, item.direction)
    read.set(k, (read.get(k) ?? 0) + 1)
  }
  const missing = new Set(
    (node.edges ?? [])
      .filter(
        (e) =>
          e.count <= GROUP_THRESHOLD &&
          (read.get(key(e.type, e.direction)) ?? 0) < e.count,
      )
      .map((e) => e.type),
  )
  const more = await Promise.all(
    [...missing].map((type) =>
      getNeighbours(id, { type, limit: NEIGHBOUR_LIMIT }, signal),
    ),
  )
  const items = new Map(
    [first, ...more]
      .flatMap((page) => page.items)
      .map((i) => [`${i.rel_type}:${i.direction}:${i.node.node_id}`, i]),
  )
  return { node, items: [...items.values()] }
}

/**
 * The id of a record of `label` to open: the first row of its table, or the
 * ontology's first concept for concepts, which come from the ontology file;
 * null when there is none.
 */
async function sampleOf(
  label: string,
  schema: Schema,
  signal: AbortSignal,
): Promise<string | null> {
  const table = schema.node_tables[label]
  if (table === undefined) {
    if (label !== 'BusinessConcept') return null
    const ontology = await getOntology(signal)
    return ontology.concepts[0]?.concept_id ?? null
  }
  const worlds = await listDatasets(signal)
  const world = worlds.find((w) => w.active) ?? worlds[0]
  if (!world) return null
  const dictionary = await getDictionary(world.dataset_id, signal)
  const key = dictionary.find((t) => t.table === table)?.primary_key
  if (!key) return null
  const page = await getRows(world.dataset_id, table, { limit: 1 }, signal)
  const row = page.rows[0]
  return row ? String(row[key]) : null
}

type Note =
  | { kind: 'none' }
  | { kind: 'busy' }
  | { kind: 'message'; text: string }
  | { kind: 'error'; error: Error; retry: () => void }

/** Left: a search box that opens a record by its id, then the kinds of record. */
function RecordFinder({
  schema,
  stats,
  chosen,
}: {
  schema: Schema
  stats: Schemas['GraphStats']
  chosen: string | undefined
}) {
  const [query, setQuery] = useState('')
  const [note, setNote] = useState<Note>({ kind: 'none' })
  const pending = useRef<AbortController | null>(null)
  useEffect(() => () => pending.current?.abort(), [])

  /** Runs `find`, then opens the record it names or says why it cannot. */
  const go = (
    find: (signal: AbortSignal) => Promise<string | null>,
    none: string,
  ) => {
    pending.current?.abort()
    const controller = new AbortController()
    pending.current = controller
    setNote({ kind: 'busy' })
    find(controller.signal).then(
      (id) => {
        if (controller.signal.aborted) return
        if (id === null) setNote({ kind: 'message', text: none })
        else {
          setNote({ kind: 'none' })
          show({ node: id })
        }
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        const err = error instanceof Error ? error : new Error(String(error))
        setNote(
          notFound(err)
            ? { kind: 'message', text: NO_RECORD }
            : { kind: 'error', error: err, retry: () => go(find, none) },
        )
      },
    )
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const id = query.trim()
    if (id === '') return
    go((signal) => getNode(id, signal).then((node) => node.node_id), NO_RECORD)
  }

  const choose = (label: string) => {
    const kind = nodeLabel(label)
    const none =
      schema.node_tables[label] === undefined
        ? `${kind[0].toUpperCase()}${kind.slice(1)} records are not built from a table, so there is no sample.`
        : `There are no ${kind} records yet, so there is no sample.`
    go((signal) => sampleOf(label, schema, signal), none)
  }

  return (
    <div className="space-y-4">
      <form role="search" onSubmit={submit} className="flex flex-wrap gap-2">
        <div className="min-w-48 flex-1">
          <ListSearch
            label="Find a record by id"
            value={query}
            onChange={setQuery}
          />
        </div>
        <button
          type="submit"
          className="shrink-0 rounded-chip border border-border px-3 py-2 text-sm font-medium text-text-primary hover:bg-surface-raised"
        >
          Open
        </button>
      </form>
      {note.kind === 'busy' && (
        <p role="status" className={NOTE}>
          Opening the record
        </p>
      )}
      {note.kind === 'message' && <p className={NOTE}>{note.text}</p>}
      {note.kind === 'error' && (
        <ErrorNote error={note.error} retry={note.retry} />
      )}
      <PickList
        label="Kinds of record"
        searchable={false}
        groups={[
          {
            name: 'Kinds of record',
            items: schema.labels.map((label) => ({
              id: label,
              title: nodeLabel(label),
              detail:
                stats.nodes_by_label[label] === undefined
                  ? undefined
                  : count(stats.nodes_by_label[label]),
            })),
          },
        ]}
        chosen={chosen}
        onChoose={choose}
      />
    </div>
  )
}

/** The kinds of record the schema puts at the other end of each of `node`'s links. */
const kindsAround =
  (schema: Schema, node: Node) => (type: string, direction: 'out' | 'in') =>
    otherKinds(schema, node.labels[0] ?? '', type, direction)

/** A box wide enough for its bold title and its detail line, in drawing units. */
const boxWidth = (title: string, detail: string, scale: number) => {
  // Capitals and digits are wider than small letters in the bold title.
  const wide = title.replace(/[^A-Z0-9_]/g, '').length
  const titleWidth = wide * 12.5 + (title.length - wide) * 10.5
  return Math.round(
    Math.max(140, titleWidth + 32, detail.length * 8.5 + 32) * scale,
  )
}

/** The longest box title, in characters; a longer name is cut short so the drawing fits its column. */
const TITLE_CHARS = 22

const shortTitle = (title: string) =>
  title.length <= TITLE_CHARS
    ? title
    : `${title.slice(0, TITLE_CHARS - 1).trimEnd()}…`

/** Middle: the record in the centre, its neighbours and groups around it. */
function Neighbourhood({
  node,
  groups,
  open,
  scale,
}: {
  node: Node
  groups: DiagramGroup[]
  open: string | null
  scale: number
}) {
  const centreTitle = shortTitle(titleOf(node))
  const centre: DiagramNode = {
    id: node.node_id,
    title: centreTitle,
    detail: kindOf(node),
    width: boxWidth(centreTitle, kindOf(node), scale),
  }
  // A neighbour linked in two ways is one box with two lines. Every box sits
  // to the right of the record, so the drawing fits its column; a link that
  // comes in is drawn with its arrow back at the record.
  const boxes = new Map<string, DiagramNode>()
  const edges: DiagramEdge[] = []
  for (const group of groups) {
    const boxId = group.node?.node_id ?? group.id
    if (boxId === node.node_id) continue
    const detail = group.node ? kindOf(group.node) : 'click to list them'
    // A group of several kinds is named in full on the right, where it fits.
    const title = shortTitle(
      (group.kinds?.length ?? 0) > 1
        ? `${count(group.total)} records`
        : group.label,
    )
    boxes.set(boxId, {
      id: boxId,
      title,
      detail,
      width: boxWidth(title, detail, scale),
    })
    edges.push({
      id: group.id,
      source: node.node_id,
      target: boxId,
      label: relationshipPhrase(group.type),
      reversed: group.direction === 'in',
    })
  }
  const isGroup = new Set(groups.filter((g) => !g.node).map((g) => g.id))

  return (
    <div className="space-y-3">
      <div>
        <p className="text-base font-semibold text-text-primary">
          {titleOf(node)}
        </p>
        <p className={NOTE}>
          {titleOf(node) === node.node_id
            ? kindOf(node)
            : `${node.node_id} · ${kindOf(node)}`}
        </p>
        <p className={`mt-1 ${NOTE}`}>
          {`Its neighbours, one step out. More than ${GROUP_THRESHOLD} of one kind of link are one box. Click a record to move there, or a box to list its records.`}
        </p>
      </div>
      {boxes.size === 0 ? (
        <p className={NOTE}>It has no links in the graph.</p>
      ) : (
        // Centred in the column, like the wireframe; a wider drawing scrolls from its left edge.
        <div className="[&_svg]:mx-auto [&_svg]:block">
          <Diagram
            nodes={[centre, ...boxes.values()]}
            edges={edges}
            label={`${titleOf(node)} and its neighbours`}
            selected={open ?? node.node_id}
            scale={scale}
            titlePx={TITLE_PX * scale}
            onSelect={(id) => {
              if (id === node.node_id || id === open)
                show({ node: node.node_id })
              else if (isGroup.has(id)) show({ node: node.node_id, group: id })
              else show({ node: id })
            }}
          />
        </div>
      )}
    </div>
  )
}

/** Right, with a group open: its members, each opening its record. */
function GroupMembers({
  node,
  group,
  schema,
}: {
  node: Node
  group: DiagramGroup
  schema: Schema
}) {
  const load = useLoad(
    (signal) =>
      getNeighbours(
        node.node_id,
        { type: group.type, limit: NEIGHBOUR_LIMIT },
        signal,
      ).then((page) =>
        page.items.filter((i) => i.direction === group.direction),
      ),
    `members/${node.node_id}/${group.id}`,
  )
  const kinds = kindsAround(schema, node)
  const [line] = linkLines(
    [{ type: group.type, direction: group.direction, count: group.total }],
    (type, direction) => {
      const found = kinds(type, direction)
      return found.length === 1 ? found[0] : undefined
    },
  )

  return (
    <div className="space-y-4">
      <a
        href={hrefFor('data-model', { tab: 'graph', node: node.node_id })}
        className="inline-flex items-center gap-1.5 text-sm text-text-secondary underline-offset-4 hover:text-text-primary hover:underline"
      >
        <ArrowLeft aria-hidden size={16} />
        {`Back to ${titleOf(node)}`}
      </a>
      <section aria-labelledby="group-title" className="space-y-3">
        <div>
          <h3
            id="group-title"
            className="text-base font-semibold text-text-primary"
          >
            {group.label}
          </h3>
          <p className={NOTE}>{line}. Choose one to open it.</p>
        </div>
        {load.status === 'loading' && (
          <div role="status" className="space-y-3">
            <span className="sr-only">Loading the records</span>
            <SkeletonBar />
            <SkeletonBar className="w-5/6" />
          </div>
        )}
        {load.status === 'error' && (
          <ErrorNote error={load.error} retry={load.retry} />
        )}
        {load.status === 'ready' && (
          <>
            {load.data.length < group.total && (
              <p
                className={NOTE}
              >{`Showing the first ${count(load.data.length)} of ${count(group.total)}.`}</p>
            )}
            <div className={COLUMN_SCROLL}>
              <PickList
                label="Search these records"
                groups={[
                  {
                    items: load.data.map(({ node: member }) => ({
                      id: member.node_id,
                      title: titleOf(member),
                      // Two records can share a name, such as two meeting notes.
                      detail:
                        titleOf(member) === member.node_id
                          ? undefined
                          : member.node_id,
                    })),
                  },
                ]}
                chosen={undefined}
                onChoose={(id) => show({ node: id })}
              />
            </div>
          </>
        )}
      </section>
    </div>
  )
}

/** Right: where the record came from, its links by who follows them, and its fields. */
function NodeDetails({ node, schema }: { node: Node; schema: Schema }) {
  const kinds = kindsAround(schema, node)
  const kindOfLink = (type: string, direction: 'out' | 'in') => {
    const found = kinds(type, direction)
    return found.length === 1 ? found[0] : undefined
  }
  const edges = node.edges ?? []
  const byFollower = FOLLOWER_ORDER.map((follower) => ({
    follower,
    lines: linkLines(
      edges.filter((e) => followerOf(schema, e.type) === follower),
      kindOfLink,
    ),
  })).filter(({ lines }) => lines.length > 0)

  return (
    <div className="space-y-5">
      <section aria-labelledby="node-from" className="space-y-2">
        <h3 id="node-from" className="text-sm font-semibold text-text-primary">
          Where it comes from
        </h3>
        {node.provenance ? (
          <>
            <p
              className={NOTE}
            >{`From ${plainName(node.provenance.table)}, row ${node.provenance.row_id}`}</p>
            <a
              href={hrefFor('data-model', {
                tab: 'tables',
                table: node.provenance.table,
                row: node.provenance.row_id,
              })}
              className={`${NEXT_STEP} mt-1`}
            >
              See its table row
              <ArrowRight aria-hidden size={16} />
            </a>
          </>
        ) : (
          <p className={NOTE}>It is not built from a table row.</p>
        )}
      </section>
      <section
        aria-labelledby="node-links"
        className="space-y-3 border-t border-hairline pt-4"
      >
        <h3 id="node-links" className="text-sm font-semibold text-text-primary">
          Its links
        </h3>
        {byFollower.length === 0 && (
          <p className={NOTE}>It has no links in the graph.</p>
        )}
        {byFollower.map(({ follower, lines }) => (
          <section
            key={follower}
            aria-labelledby={`follower-${follower}`}
            className="space-y-1"
          >
            <h4 id={`follower-${follower}`} className={NOTE}>
              {FOLLOWED_BY[follower]}
            </h4>
            <ul className="space-y-1 text-sm text-text-primary">
              {lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        ))}
      </section>
      <dl className="space-y-3 border-t border-hairline pt-4 text-sm">
        {distinctFields(node.properties).map(([name, value]) => (
          <div key={name}>
            <dt className="text-text-muted">{plainName(name)}</dt>
            <dd className="break-words text-text-primary">
              {plainValue(value)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function Loading({ what }: { what: string }) {
  return (
    <div role="status" className="space-y-3">
      <span className="sr-only">{`Loading ${what}`}</span>
      <SkeletonBar className="w-2/3" />
      <SkeletonBar />
      <SkeletonBar className="w-5/6" />
    </div>
  )
}

function GraphRecord({
  nodeId,
  groupId,
  schema,
  stats,
  scale,
}: {
  nodeId: string | null
  groupId: string | null
  schema: Schema
  stats: Schemas['GraphStats']
  scale: number
}) {
  const load = useLoad(
    (signal) =>
      nodeId === null
        ? Promise.resolve(null)
        : loadNeighbourhood(nodeId, signal),
    `neighbourhood/${nodeId}`,
  )
  const data = load.status === 'ready' ? load.data : null
  const groups =
    data === null
      ? []
      : groupNeighbours(
          data.items,
          data.node.edges ?? [],
          GROUP_THRESHOLD,
          kindsAround(schema, data.node),
        )
  const group = groups.find((g) => g.id === groupId && !g.node)

  const main =
    load.status === 'loading' ? (
      <Loading what="the record" />
    ) : load.status === 'error' ? (
      notFound(load.error) ? (
        <p className={NOTE}>{NO_RECORD}</p>
      ) : (
        <ErrorNote error={load.error} retry={load.retry} />
      )
    ) : data === null ? (
      <p className={NOTE}>{CHOOSE}</p>
    ) : (
      <Neighbourhood
        node={data.node}
        groups={groups}
        open={group?.id ?? null}
        scale={scale}
      />
    )
  const detail =
    load.status === 'loading' ? (
      <Loading what="its details" />
    ) : data === null ? (
      <p className={NOTE}>{CHOOSE}</p>
    ) : group ? (
      <GroupMembers node={data.node} group={group} schema={schema} />
    ) : (
      <NodeDetails node={data.node} schema={schema} />
    )

  return (
    <Explorer
      steps={STEPS}
      about={
        <div className="space-y-8">
          <AboutContent copy={graphAbout(schema.caps)} />
          <KindsOfLink schema={schema} stats={stats} />
        </div>
      }
      list={
        <RecordFinder
          schema={schema}
          stats={stats}
          chosen={data?.node.labels[0]}
        />
      }
      main={main}
      detail={detail}
    />
  )
}

export function GraphExplorer({
  params,
  scale,
}: {
  params: URLSearchParams
  scale: number
}) {
  const named = params.get('node')
  const graph = useLoad(async (signal) => {
    const [schema, stats] = await Promise.all([
      getGraphSchema(signal),
      getGraphStats(signal),
    ])
    return { schema, stats }
  }, 'graph-explorer')
  // The example is only asked for when the address names no record.
  const example = useLoad(
    (signal) =>
      named === null
        ? getDataModelExample(signal).then((e) => e.incident_id ?? null)
        : Promise.resolve(null),
    `graph-example/${named === null}`,
  )

  const empty =
    graph.status === 'ready' && graph.data.schema.labels.length === 0
  if (graph.status !== 'ready' || empty)
    return (
      <Panel
        title="Graph"
        state={empty ? 'empty' : graph.status}
        message="The graph has not been built yet."
        error={graph.status === 'error' ? graph.error : undefined}
        onRetry={graph.retry}
      />
    )
  if (named === null && example.status !== 'ready')
    return (
      <Panel
        title="Graph"
        state={example.status}
        error={example.status === 'error' ? example.error : undefined}
        onRetry={example.retry}
      />
    )

  return (
    <GraphRecord
      nodeId={named ?? (example.status === 'ready' ? example.data : null)}
      groupId={params.get('group')}
      schema={graph.data.schema}
      stats={graph.data.stats}
      scale={scale}
    />
  )
}
