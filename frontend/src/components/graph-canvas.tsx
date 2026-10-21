/**
 * 2D evidence-led graph rendering (docs/ux/graph-visualisation-spec.md).
 *
 * Every node and edge corresponds to a received telemetry event; layout is a
 * deterministic layered arrangement (columns = hop depth from seeds) so the
 * picture is stable across replays. Progressive reveal only: nothing is drawn
 * before its event arrives.
 */

import { useMemo } from 'react'

import type { GraphNodeState, GraphPaneState } from '../mock/telemetry'

interface Position {
  x: number
  y: number
  depth: number
}

const COLUMN_WIDTH = 148
const ROW_HEIGHT = 90
const MARGIN = 60

/** Deterministic layered layout: depth via BFS over revealed edges. */
function computeLayout(state: GraphPaneState): {
  positions: Map<string, Position>
  width: number
  height: number
} {
  const positions = new Map<string, Position>()
  const depthOf = new Map<string, number>()
  const queue: string[] = []

  for (const [id, node] of state.nodes) {
    if (node.state === 'seed') {
      depthOf.set(id, 0)
      queue.push(id)
    }
  }
  while (queue.length > 0) {
    const id = queue.shift() as string
    const depth = depthOf.get(id) as number
    for (const [, edge] of state.edges) {
      if (
        edge.from === id &&
        !depthOf.has(edge.to) &&
        state.nodes.has(edge.to)
      ) {
        depthOf.set(edge.to, depth + 1)
        queue.push(edge.to)
      }
    }
  }
  // Unreachable nodes (e.g. ontology concepts) sit in the deepest column.
  const maxDepth = Math.max(0, ...depthOf.values())
  for (const id of state.nodes.keys()) {
    if (!depthOf.has(id)) depthOf.set(id, maxDepth)
  }

  const rows = new Map<number, number>()
  for (const [id, node] of state.nodes) {
    const depth = depthOf.get(id) as number
    const row = rows.get(depth) ?? 0
    rows.set(depth, row + 1)
    positions.set(id, {
      x: MARGIN + depth * COLUMN_WIDTH,
      y: MARGIN + row * ROW_HEIGHT,
      depth,
    })
    // Keep the label kind for callers that render it; silence unused warnings.
    void node
  }

  const columns = maxDepth + 1
  const maxRows = Math.max(1, ...rows.values())
  return {
    positions,
    width: MARGIN * 2 + columns * COLUMN_WIDTH - (COLUMN_WIDTH - 36),
    height: MARGIN * 2 + maxRows * ROW_HEIGHT - (ROW_HEIGHT - 36),
  }
}

const NODE_FILL: Record<GraphNodeState, string> = {
  seed: 'var(--color-graph)',
  traversed: 'var(--color-surface-raised)',
  active: 'var(--color-surface-raised)',
  candidate: 'var(--color-surface-raised)',
  selected: 'var(--color-success)',
  discarded: 'var(--color-background)',
  ontology: 'var(--color-ontology)',
  source_record: 'var(--color-surface-raised)',
}

const NODE_STROKE: Record<GraphNodeState, string> = {
  seed: 'var(--color-graph)',
  traversed: 'var(--color-graph)',
  active: 'var(--color-graph)',
  candidate: 'var(--color-warning)',
  selected: 'var(--color-success)',
  discarded: 'var(--color-border)',
  ontology: 'var(--color-ontology)',
  source_record: 'var(--color-border)',
}

const EDGE_STROKE: Record<string, string> = {
  candidate: 'var(--color-warning)',
  active: 'var(--color-graph)',
  traversed: 'var(--color-text-muted)',
  evidence_path: 'var(--color-success)',
}

const STATE_LABEL: Record<GraphNodeState, string> = {
  seed: 'seed',
  traversed: 'traversed',
  active: 'active traversal',
  candidate: 'candidate',
  selected: 'selected evidence',
  discarded: 'discarded',
  ontology: 'ontology concept',
  source_record: 'source record',
}

export function GraphCanvas({
  state,
  compact = false,
}: {
  state: GraphPaneState
  compact?: boolean
}) {
  const { positions, width, height } = useMemo(
    () => computeLayout(state),
    [state],
  )
  const nodes = [...state.nodes.values()]
  const edges = [...state.edges.values()]

  const summary =
    nodes.length === 0
      ? 'Graph is empty. Entities appear as they are resolved.'
      : `Graph with ${nodes.length} nodes and ${edges.length} relationships. ` +
        nodes
          .map((node) => `${node.label}: ${STATE_LABEL[node.state]}`)
          .join('; ')

  return (
    <div>
      <svg
        role="img"
        aria-label={summary}
        viewBox={`0 0 ${Math.max(width, 320)} ${Math.max(height, 160)}`}
        className={`w-full ${compact ? 'max-h-64' : ''}`}
      >
        {edges.map((edge) => {
          const from = positions.get(edge.from)
          const to = positions.get(edge.to)
          if (!from || !to) return null
          const mx = (from.x + to.x) / 2
          const my = (from.y + to.y) / 2
          return (
            <g key={edge.id} className="node-reveal">
              <line
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke={EDGE_STROKE[edge.state]}
                strokeWidth={edge.state === 'evidence_path' ? 3 : 1.5}
                strokeDasharray={edge.state === 'candidate' ? '4 3' : undefined}
                opacity={edge.state === 'traversed' ? 0.5 : 1}
              />
              {/* Label the evidence path once, not on every edge. */}
              {edge.state === 'evidence_path' &&
                edge.id === state.evidencePath[0] && (
                  <text
                    x={mx}
                    y={my - 8}
                    textAnchor="middle"
                    className="fill-success text-xs label-halo"
                  >
                    evidence path
                  </text>
                )}
            </g>
          )
        })}
        {nodes.map((node) => {
          const position = positions.get(node.id)
          if (!position) return null
          const isDocument = node.kind === 'document'
          return (
            <g
              key={node.id}
              className="node-reveal"
              transform={`translate(${position.x}, ${position.y})`}
              opacity={node.state === 'discarded' ? 0.45 : 1}
            >
              {isDocument ? (
                <rect
                  x={-16}
                  y={-13}
                  width={32}
                  height={26}
                  rx={4}
                  fill={NODE_FILL[node.state]}
                  stroke={NODE_STROKE[node.state]}
                  strokeWidth={2}
                  strokeDasharray={
                    node.state === 'discarded' ? '3 2' : undefined
                  }
                />
              ) : (
                <circle
                  r={17}
                  fill={NODE_FILL[node.state]}
                  stroke={NODE_STROKE[node.state]}
                  strokeWidth={2}
                  strokeDasharray={
                    node.state === 'candidate' || node.state === 'discarded'
                      ? '3 2'
                      : undefined
                  }
                />
              )}
              {node.kind === 'concept' && (
                <circle r={5} fill="var(--color-background)" stroke="none" />
              )}
              <text
                y={33}
                textAnchor="middle"
                fill="var(--color-text-primary)"
                className="text-xs font-medium label-halo"
              >
                {node.label}
              </text>
            </g>
          )
        })}
      </svg>
      <ul className="sr-only">
        {nodes.map((node) => (
          <li key={node.id}>
            {node.label}: {STATE_LABEL[node.state]}
          </li>
        ))}
      </ul>
    </div>
  )
}

const LEGEND: Array<[GraphNodeState, string]> = [
  ['seed', 'Seed'],
  ['traversed', 'Traversed'],
  ['candidate', 'Candidate'],
  ['selected', 'Selected evidence'],
  ['discarded', 'Discarded'],
  ['ontology', 'Ontology concept'],
  ['source_record', 'Source record'],
]

export function GraphLegend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary">
      {LEGEND.map(([state, label]) => (
        <li key={state} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block size-2.5 rounded-full border-2"
            style={{
              background: NODE_FILL[state],
              borderColor: NODE_STROKE[state],
            }}
          />
          {label}
        </li>
      ))}
    </ul>
  )
}
