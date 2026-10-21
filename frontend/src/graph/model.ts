/**
 * The graph view model: a pure function from the recorded graph events of one
 * pipeline to what the canvas and the textual list draw. Every node and edge
 * is a recorded event; the model adds no activity and drops no node.
 *
 * State of a node. It comes only from recorded events, and when several
 * apply the first of this list wins:
 *   selected      graph.candidate.selected named it
 *   discarded     graph.candidate.discarded named it
 *   candidate     graph.candidate.reranked judged it, with no verdict yet
 *   seed          graph.seed.selected named it
 *   concept       graph.ontology.expanded named it
 *   source_record the caller says its evidence is a source record
 *   traversed     graph.node.discovered found it, nothing else applies
 * A node is a concept (`kind`) whenever an ontology expansion named it, even
 * when a verdict gives it another state.
 *
 * Clustering. Above the cap, the nodes that are neither on an evidence path
 * nor seeds are grouped by (hop, label), largest group first (ties by label,
 * then by first event order), until the visible count (nodes outside every
 * cluster plus the clusters) is at most the cap. A group of one is never
 * clustered. If path and seed nodes alone exceed the cap, the view stays
 * above it. A clustered node stays in `nodes` with its `clusterId` and in its
 * cluster's `members`, so nothing is lost.
 */

import type { EvidenceState } from '../design/evidence-states'
import type { GraphEvents } from '../run/reduce'

export const DEFAULT_VISIBLE_NODE_CAP = 60

export interface GraphNodeView {
  id: string
  /** The recorded node label (its type, such as "Game"); the id if none was recorded. */
  label: string
  kind: 'entity' | 'concept'
  state: EvidenceState
  hop: number
  onPath: boolean
  /** True for a node the overlay (configuration B) never discovered. */
  addedByOntology: boolean
  clusterId?: string
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
  hop: number
  count: number
  members: string[]
}

export interface GraphView {
  nodes: GraphNodeView[]
  edges: GraphEdgeView[]
  clusters: GraphCluster[]
  /** Each recorded evidence path as node ids from the seed to the evidence. */
  paths: string[][]
  /** The ids on any path, in path order, each once. */
  path: string[]
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
   * The evidence paths the backend recorded (the selected evidence's `path`
   * in the run's results). Ids with no recorded node are left out.
   */
  paths?: string[][]
  /** Nodes whose evidence is attached as a source record. */
  sourceRecordIds?: ReadonlySet<string>
}

function nodeState(
  node: GraphEvents['nodes'][number],
  isConcept: boolean,
  isSourceRecord: boolean,
): EvidenceState {
  if (node.outcome === 'selected') return 'selected'
  if (node.outcome === 'discarded') return 'discarded'
  if (node.outcome === 'candidate') return 'candidate'
  if (node.seed) return 'seed'
  if (isConcept) return 'concept'
  if (isSourceRecord) return 'source_record'
  return 'traversed'
}

const hasStep = (path: string[], a: string, b: string): boolean =>
  path.some(
    (id, i) =>
      i > 0 &&
      ((path[i - 1] === a && id === b) || (path[i - 1] === b && id === a)),
  )

/** The (hop, label) groups of `nodes`, largest first, ties by label then first event. */
function groupsOf(nodes: GraphNodeView[]): GraphCluster[] {
  const groups = new Map<string, GraphCluster>()
  for (const node of nodes) {
    const id = `cluster:${node.hop}:${node.label}`
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
    (a, b) => b.count - a.count || a.label.localeCompare(b.label),
  )
}

export function graphView(
  events: GraphEvents,
  options: GraphViewOptions,
): GraphView {
  const { cap, focus, overlay, sourceRecordIds = new Set<string>() } = options
  const known = new Set(events.nodes.map((node) => node.id))
  const paths = (options.paths ?? [])
    .map((path) => path.filter((id) => known.has(id)))
    .filter((path) => path.length > 0)
  const path = [...new Set(paths.flat())]
  const concepts = new Set(events.concepts.map((concept) => concept.id))
  const overlayIds = overlay && new Set(overlay.nodes.map((node) => node.id))

  const nodes: GraphNodeView[] = events.nodes.map((node) => ({
    id: node.id,
    label: node.label ?? node.id,
    kind: concepts.has(node.id) ? 'concept' : 'entity',
    state: nodeState(node, concepts.has(node.id), sourceRecordIds.has(node.id)),
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
      onPath: paths.some((p) => hasStep(p, edge.from, edge.to)),
    }
  })

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
  return { nodes, edges, clusters, paths, path }
}
