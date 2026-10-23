/**
 * The graph view model: a pure function from the recorded graph events of one
 * pipeline to what the canvas and the textual list draw. Every node and edge
 * is a recorded event; the model adds no activity and drops no node.
 *
 * State of a node. A node's role comes first, then its outcome, all from
 * recorded events:
 *   seed          graph.seed.selected named it
 *   concept       graph.ontology.expanded named it (when it is not a seed)
 * every other node shows its outcome, the first that applies:
 *   selected      graph.candidate.selected named it
 *   discarded     graph.candidate.discarded named it
 *   candidate     graph.candidate.reranked judged it, with no verdict yet
 *   source_record the run's results attach structured source-record facts to it
 *   traversed     graph.node.discovered found it, nothing else applies
 * `outcome` is carried by every node, so a seed or concept that was selected
 * or set aside can still be badged with its verdict.
 *
 * Clustering. Above the cap, the nodes that are neither on an evidence path
 * nor seeds are grouped by (hop, label), largest group first (ties by label,
 * then by first event order), until the visible count (nodes outside every
 * cluster plus the clusters) is at most the cap. A group of one is never
 * clustered. If path and seed nodes alone exceed the cap, the view stays
 * above it. A clustered node stays in `nodes` with its `clusterId` and in its
 * cluster's `members`, so nothing is lost. With `focus` on, the cap no longer
 * applies: every group of two or more such nodes is clustered, so only the
 * evidence paths and the seeds stand alone.
 *
 * Evidence paths and source records come from the run's results, which exist
 * only when the run is over. They are ignored until the events show the path
 * was recorded (`graph.evidence_path.completed` sets `events.evidencePath`),
 * so a replay never shows a path before its event.
 *
 * The ontology overlay (`addedByOntology`) compares C with the events of B it
 * is given. A caller replaying a run gives B's events up to the same cursor,
 * so mid-replay a node reads as "added by the ontology" when C has found it
 * and B has not found it yet, which is not the same as B never finding it.
 * Phase 6 should decide whether the overlay waits for B's final graph.
 */

import type { EvidenceState } from '../design/evidence-states'
import type { GraphEvents, GraphNode } from '../run/reduce'

/**
 * The cap that keeps labels readable on a 1920 by 1080 screen (e2e/graph-canvas-200.spec.ts
 * checks the type size on the screen at this cap).
 */
export const DEFAULT_VISIBLE_NODE_CAP = 24

export interface GraphNodeView {
  id: string
  /** The recorded node label (its type, such as "Game"); the id if none was recorded. */
  label: string
  kind: 'entity' | 'concept'
  /** The role (seed, concept) or else the outcome. */
  state: EvidenceState
  /** The verdict the events gave, whatever the role. */
  outcome: GraphNode['outcome']
  /** Steps from a seed; null when no discovery recorded it. */
  hop: number | null
  onPath: boolean
  /** True for a node the overlay (configuration B) never discovered. */
  addedByOntology: boolean
  clusterId?: string
  /**
   * The id of the group whose place the canvas draws this node in, when it
   * stands in for a group of which it is the only member revealed so far
   * (`withClustersOf`). It has no `clusterId`: a group is drawn from two members.
   */
  slot?: string
}

export interface GraphEdgeView {
  id: string
  source: string
  target: string
  /** The recorded relationship type, such as "AFFECTS". */
  relationship: string
  /** The state of the node the edge reaches. */
  state: EvidenceState
  onPath: boolean
}

export interface GraphCluster {
  id: string
  label: string
  /** Null for the group of nodes whose hop is unknown. */
  hop: number | null
  count: number
  members: string[]
}

export interface GraphView {
  nodes: GraphNodeView[]
  edges: GraphEdgeView[]
  clusters: GraphCluster[]
  /**
   * Each recorded evidence path as node ids from the seed to the evidence,
   * with the ids that have no recorded node left out.
   */
  paths: string[][]
  /**
   * The same paths exactly as recorded, unknown ids included, so a list can
   * show where a step is missing instead of joining its neighbours.
   */
  recordedPaths: string[][]
  /** True once the pipeline has recorded its evidence paths (the path event has arrived). */
  pathRecorded: boolean
  /** Ids on a recorded path that have no recorded node, in order of appearance. */
  droppedPathIds: string[]
  /**
   * For each recorded path, the id of the edge of each hop (entry `i` is the
   * hop from position `i` to `i + 1`); null where either end has no recorded
   * node or no edge was recorded between them.
   */
  pathSteps: (string | null)[][]
  /** The ids on any path, in path order, each once. */
  path: string[]
}

/** A path as the run's results carry it: node ids and how the last node was reached. */
export interface RecordedPath {
  ids: string[]
  /** The relationship type that reached the last node, when the result names one. */
  lastRelationship?: string
}

export interface GraphViewOptions {
  cap: number
  /**
   * Cluster every group of two or more off-path, non-seed nodes whatever the
   * cap, so only the evidence path and the seeds stand alone.
   */
  focus: boolean
  /** Configuration B's events when `events` are C's. */
  overlay?: GraphEvents
  /**
   * The evidence paths the backend recorded, used only once
   * `events.evidencePath` is set. A bare id list matches every
   * edge between neighbours. A `RecordedPath` that names the relationship of
   * its last hop matches only edges of that type, and takes the edge that
   * runs along the path before one that runs against it. Ids with no recorded
   * node are left out of `paths` and listed in `droppedPathIds`.
   */
  paths?: (string[] | RecordedPath)[]
  /**
   * Nodes whose evidence is a source record (`sourceRecordsFromResult`), used
   * only once `events.evidencePath` is set.
   */
  sourceRecordIds?: ReadonlySet<string>
}

function nodeState(
  node: GraphNode,
  isConcept: boolean,
  isSourceRecord: boolean,
): EvidenceState {
  if (node.seed) return 'seed'
  if (isConcept) return 'concept'
  if (node.outcome === 'selected') return 'selected'
  if (node.outcome === 'discarded') return 'discarded'
  if (node.outcome === 'candidate') return 'candidate'
  return isSourceRecord ? 'source_record' : 'traversed'
}

/** The edges that make the hop from `a` to `b`, narrowed to `type` when one is given. */
function stepEdges(
  edges: GraphEdgeView[],
  a: string,
  b: string,
  type: string | undefined,
): GraphEdgeView[] {
  const between = edges.filter(
    (e) =>
      (e.source === a && e.target === b) || (e.source === b && e.target === a),
  )
  if (type === undefined) return between
  const typed = between.filter((e) => e.relationship === type)
  const along = typed.filter((e) => e.source === a)
  return along.length > 0 ? along : typed
}

/** Where a node or group sits, in words; a hop that was never recorded says so. */
export function hopWords(hop: number | null): string {
  if (hop === null) return 'distance from the starting point not recorded'
  if (hop === 0) return 'at the starting point'
  return `${hop} ${hop === 1 ? 'step' : 'steps'} from the starting point`
}

/** The (hop, label) groups of `nodes`, largest first, ties by label then first event. */
function groupsOf(nodes: GraphNodeView[]): GraphCluster[] {
  const groups = new Map<string, GraphCluster>()
  for (const node of nodes) {
    const id = `cluster:${node.hop ?? 'unknown'}:${node.label}`
    const group = groups.get(id) ?? {
      id,
      label: node.label,
      hop: node.hop,
      count: 0,
      members: [],
    }
    group.count += 1
    group.members.push(node.id)
    groups.set(id, group)
  }
  // The sort is stable and the map keeps first-seen order, so equal groups
  // stay in the order of their first event.
  return [...groups.values()].sort(
    (a, b) =>
      b.count - a.count || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0),
  )
}

export function graphView(
  events: GraphEvents,
  options: GraphViewOptions,
): GraphView {
  const { cap, focus, overlay } = options
  // The results are not recorded until the path event: ignore them before.
  const recorded = events.evidencePath !== null
  const sourceRecordIds = recorded
    ? (options.sourceRecordIds ?? new Set<string>())
    : new Set<string>()
  const known = new Set(events.nodes.map((node) => node.id))
  const given = (recorded ? (options.paths ?? []) : []).map((p) =>
    Array.isArray(p) ? { ids: p } : p,
  )
  const recordedPaths = given.map((p) => p.ids).filter((ids) => ids.length > 0)
  const droppedPathIds = [
    ...new Set(recordedPaths.flat().filter((id) => !known.has(id))),
  ]
  const paths = recordedPaths
    .map((ids) => ids.filter((id) => known.has(id)))
    .filter((ids) => ids.length > 0)
  const path = [...new Set(paths.flat())]
  const concepts = new Set(events.concepts.map((concept) => concept.id))
  const overlayIds = overlay && new Set(overlay.nodes.map((node) => node.id))

  const nodes: GraphNodeView[] = events.nodes.map((node) => ({
    id: node.id,
    label: node.label ?? node.id,
    kind: concepts.has(node.id) ? 'concept' : 'entity',
    state: nodeState(node, concepts.has(node.id), sourceRecordIds.has(node.id)),
    outcome: node.outcome,
    hop: node.hop,
    onPath: path.includes(node.id),
    addedByOntology: overlayIds !== undefined && !overlayIds.has(node.id),
  }))
  const stateOf = new Map(nodes.map((node) => [node.id, node.state]))

  const seen = new Map<string, number>()
  const edges: GraphEdgeView[] = events.relationships.map((edge) => {
    const key = `${edge.from}>${edge.type}>${edge.to}`
    const n = seen.get(key) ?? 0
    seen.set(key, n + 1)
    return {
      id: n === 0 ? key : `${key}#${n}`,
      source: edge.from,
      target: edge.to,
      relationship: edge.type,
      state: stateOf.get(edge.to) ?? 'traversed',
      onPath: false,
    }
  })
  const pathSteps = given
    .filter((p) => p.ids.length > 0)
    .map((p) =>
      p.ids.slice(1).map((id, i) => {
        const from = p.ids[i]
        if (!known.has(from) || !known.has(id)) return null
        const last = i === p.ids.length - 2 ? p.lastRelationship : undefined
        const found = stepEdges(edges, from, id, last)
        for (const edge of found) edge.onPath = true
        return found[0]?.id ?? null
      }),
    )

  const clusters: GraphCluster[] = []
  if (focus || nodes.length > cap) {
    let visible = nodes.length
    const seeds = new Set(events.nodes.filter((n) => n.seed).map((n) => n.id))
    const free = nodes.filter((node) => !node.onPath && !seeds.has(node.id))
    for (const group of groupsOf(free)) {
      if (!focus && visible <= cap) break
      if (group.count < 2) continue
      clusters.push(group)
      visible -= group.count - 1
      const members = new Set(group.members)
      for (const node of nodes)
        if (members.has(node.id)) node.clusterId = group.id
    }
  }
  return {
    nodes,
    edges,
    clusters,
    paths,
    recordedPaths,
    pathRecorded: recorded,
    droppedPathIds,
    pathSteps,
    path,
  }
}

/**
 * `view` with its nodes grouped the way `final` groups them, and each group
 * counting only the members `view` has so far. A replay draws the final
 * graph's layout, so a node must sit in the group (or stand alone) it will
 * have at the end, or it would have no place on the canvas. A group with one
 * revealed member is not drawn as a group (the model never groups one node):
 * the member carries the group's id as its `slot` instead.
 */
export function withClustersOf(view: GraphView, final: GraphView): GraphView {
  const clusterOf = new Map(final.nodes.map((n) => [n.id, n.clusterId]))
  const present = new Set(view.nodes.map((n) => n.id))
  const revealed = final.clusters
    .map((c) => {
      const members = c.members.filter((id) => present.has(id))
      return { ...c, members, count: members.length }
    })
    .filter((c) => c.count > 0)
  // A group is drawn once two of its members are revealed; before that the
  // lone member is drawn as itself, in the group's place.
  const drawn = new Set(revealed.filter((c) => c.count >= 2).map((c) => c.id))
  const nodes = view.nodes.map(({ clusterId: _ignored, ...node }) => {
    const clusterId = clusterOf.get(node.id)
    if (clusterId === undefined) return node
    return drawn.has(clusterId)
      ? { ...node, clusterId }
      : { ...node, slot: clusterId }
  })
  return {
    ...view,
    nodes,
    clusters: revealed.filter((c) => drawn.has(c.id)),
  }
}
