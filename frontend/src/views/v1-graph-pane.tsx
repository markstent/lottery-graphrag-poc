/**
 * The v1 Graph & Ontology pane and evidence graph (docs/06 §5), moved onto the
 * new canvas through `toGraphView`, which turns the v1 mock pane state into a
 * `GraphView`. Phase 6 replaces both views and this file with them.
 */

import { AnswerBlock } from '../components/answer-block'
import type { EvidenceState } from '../design/evidence-states'
import { GraphCanvas } from '../graph/graph-canvas'
import { GraphLegend } from '../graph/graph-legend'
import type { GraphEdgeView, GraphNodeView, GraphView } from '../graph/model'
import type {
  GraphNode,
  GraphNodeState,
  GraphPaneState,
} from '../mock/telemetry'

const KIND_LABEL: Record<GraphNode['kind'], string> = {
  market: 'Market',
  game: 'Game',
  platform: 'Platform',
  platform_version: 'PlatformVersion',
  incident: 'Incident',
  document: 'Document',
  concept: 'BusinessConcept',
}

const STATE: Record<GraphNodeState, EvidenceState> = {
  seed: 'seed',
  active: 'traversed',
  traversed: 'traversed',
  candidate: 'candidate',
  selected: 'selected',
  discarded: 'discarded',
  ontology: 'concept',
  source_record: 'source_record',
}

/** The v1 pane state as a graph view; the v1 mock records no hops or clusters. */
function toGraphView(state: GraphPaneState): GraphView {
  const path = state.evidencePath
  const nodes: GraphNodeView[] = [...state.nodes.values()].map((node) => ({
    id: node.id,
    label: KIND_LABEL[node.kind],
    kind: node.kind === 'concept' ? 'concept' : 'entity',
    state: STATE[node.state],
    outcome:
      node.state === 'selected' ||
      node.state === 'discarded' ||
      node.state === 'candidate'
        ? node.state
        : 'discovered',
    hop: 0,
    onPath: path.includes(node.id),
    addedByOntology: false,
  }))
  const stateOf = new Map(nodes.map((node) => [node.id, node.state]))
  const edges: GraphEdgeView[] = [...state.edges.values()].map((edge) => ({
    id: edge.id,
    source: edge.from,
    target: edge.to,
    relationship: edge.label,
    state: stateOf.get(edge.to) ?? 'traversed',
    onPath: edge.state === 'evidence_path',
  }))
  return {
    nodes,
    edges,
    clusters: [],
    paths: path.length > 0 ? [path] : [],
    recordedPaths: path.length > 0 ? [path] : [],
    pathRecorded: path.length > 0,
    droppedPathIds: [],
    pathSteps: path.length > 1 ? [path.slice(1).map(() => null)] : [],
    path,
  }
}

/** The graph of one mock run, with its legend. */
export function EvidenceGraph({
  state,
  height,
  settled,
  onSelect,
}: {
  state: GraphPaneState
  height: string
  /** True once the run has finished, so the final graph is laid out whole. */
  settled: boolean
  onSelect: (id: string) => void
}) {
  return (
    <>
      <div className={height}>
        <GraphCanvas
          view={toGraphView(state)}
          onSelectNode={onSelect}
          focusMode={false}
          presentation={false}
          pipeline="C"
          mode="live"
          settled={settled}
        />
      </div>
      <div className="mt-2">
        <GraphLegend pipeline="C" />
      </div>
    </>
  )
}

export function GraphPane({
  state,
  onCitation,
}: {
  state: GraphPaneState
  onCitation?: (nodeId: string) => void
}) {
  const nodes = [...state.nodes.values()]

  const headline =
    state.stage === 'idle'
      ? 'Entities appear here as they are resolved.'
      : state.stage === 'seeding'
        ? 'Resolving starting points from the question…'
        : state.stage === 'traversing'
          ? 'Traversing relationships…'
          : state.stage === 'selecting'
            ? 'Selecting evidence paths…'
            : state.stage === 'answering'
              ? 'Generating the answer…'
              : 'Traversal complete.'

  return (
    <section aria-label="Graph and Ontology pane" className="flex flex-col">
      <header className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold tracking-wide text-graph">
          + GRAPH &amp; ONTOLOGY
          <span className="ml-2 text-xs font-normal text-text-muted">
            relationships and canonical concepts
          </span>
        </h3>
      </header>

      <p className="mb-2 text-sm text-text-secondary" role="status">
        {headline}
      </p>

      {nodes.length === 0 ? (
        <p className="rounded-card border border-dashed border-border p-6 text-center text-sm text-text-muted">
          Pick a question chip above or press Run to watch the starting points
          and graph traversal unfold.
        </p>
      ) : (
        <>
          <EvidenceGraph
            state={state}
            height="h-[420px]"
            settled={state.stage === 'done'}
            onSelect={(id) => onCitation?.(id)}
          />
        </>
      )}

      {state.evidencePath.length > 0 && (
        <p className="mt-3 text-xs text-success" aria-label="Evidence path">
          Evidence path: {state.evidencePath.join(' → ')}
        </p>
      )}

      {state.tokenCount !== null && (
        <p className="mt-1 text-xs text-text-muted">
          Context assembled: {state.tokenCount.toLocaleString()} tokens
        </p>
      )}

      {state.answer &&
        (onCitation ? (
          <AnswerBlock answer={state.answer} onCitation={onCitation} />
        ) : (
          <AnswerBlock answer={state.answer} />
        ))}
    </section>
  )
}
