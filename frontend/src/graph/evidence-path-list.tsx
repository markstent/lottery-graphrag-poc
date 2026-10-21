/**
 * The text alternative to the graph canvas: each evidence path the backend
 * recorded as an ordered list, one item per node, naming its state, its label
 * and the relationship that reached it. Where the recorded relationships hold
 * no step between two neighbouring nodes, the item says nothing about one.
 */

import { EVIDENCE_STATES } from '../design/evidence-states'
import { relationshipPhrase } from '../design/relationships'
import type { GraphEdgeView, GraphNodeView, GraphView } from './model'

function stepBetween(
  edges: GraphEdgeView[],
  from: GraphNodeView,
  to: GraphNodeView,
): string | null {
  const forward = edges.find((e) => e.source === from.id && e.target === to.id)
  if (forward)
    return `${from.label} ${relationshipPhrase(forward.relationship)} ${to.label}`
  const backward = edges.find((e) => e.source === to.id && e.target === from.id)
  return backward
    ? `${to.label} ${relationshipPhrase(backward.relationship)} ${from.label}`
    : null
}

export function EvidencePathList({ view }: { view: GraphView }) {
  if (view.paths.length === 0) {
    return (
      <p className="text-xs text-text-muted">
        No evidence path was recorded for this pipeline.
      </p>
    )
  }
  const byId = new Map(view.nodes.map((node) => [node.id, node]))
  return (
    <div className="flex flex-col gap-3">
      {view.paths.map((path, index) => (
        <section key={path.join('>')} aria-label={`Evidence path ${index + 1}`}>
          <h4 className="text-xs font-medium text-text-primary">
            Evidence path {index + 1} of {view.paths.length}
          </h4>
          <ol className="list-decimal pl-5 text-xs text-text-primary">
            {path.map((id, hop) => {
              const node = byId.get(id)
              if (!node) return null
              const previous = hop > 0 ? byId.get(path[hop - 1]) : undefined
              const step = previous && stepBetween(view.edges, previous, node)
              return (
                <li key={id}>
                  <span className="font-medium">
                    {EVIDENCE_STATES[node.state].label}
                  </span>
                  {': '}
                  {node.label} ({node.id})
                  {step ? (
                    <span className="text-text-muted">, {step}</span>
                  ) : null}
                </li>
              )
            })}
          </ol>
        </section>
      ))}
    </div>
  )
}
