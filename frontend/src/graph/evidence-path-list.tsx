/**
 * The text alternative to the graph canvas for its evidence paths: each path
 * the backend recorded as an ordered list, one item per node, naming its
 * state, its label and the relationship that reached it. A step the run did
 * not record is said to be missing, and the items on either side are not
 * joined across it.
 */

import { EVIDENCE_STATES } from '../design/evidence-states'
import { nodeLabel } from '../design/node-labels'
import { relationshipPhrase } from '../design/relationships'
import type { GraphEdgeView, GraphNodeView, GraphView } from './model'

/** "incident affects game" for the edge that makes a hop, read along the edge. */
function stepText(
  edge: GraphEdgeView,
  byId: Map<string, GraphNodeView>,
): string | null {
  const source = byId.get(edge.source)
  const target = byId.get(edge.target)
  return source && target
    ? `${nodeLabel(source.label)} ${relationshipPhrase(edge.relationship)} ${nodeLabel(target.label)}`
    : null
}

export function EvidencePathList({
  view,
  id,
}: {
  view: GraphView
  /** An id for the list, so a canvas can point `aria-describedby` at it. */
  id?: string
}) {
  if (view.recordedPaths.length === 0) {
    return (
      <p id={id} className="text-xs text-text-muted">
        No evidence path was recorded for this pipeline.
      </p>
    )
  }
  const byId = new Map(view.nodes.map((node) => [node.id, node]))
  const edgeById = new Map(view.edges.map((edge) => [edge.id, edge]))
  return (
    <div id={id} className="flex flex-col gap-3">
      {view.recordedPaths.map((path, index) => (
        <section key={path.join('>')} aria-label={`Evidence path ${index + 1}`}>
          <h4 className="text-xs font-medium text-text-primary">
            Evidence path {index + 1} of {view.recordedPaths.length}
          </h4>
          <ol className="list-decimal pl-5 text-xs text-text-primary">
            {path.map((id, hop) => {
              const node = byId.get(id)
              if (!node) {
                return (
                  <li key={`${id}@${hop}`} className="text-text-muted">
                    A step that was not recorded ({id})
                  </li>
                )
              }
              const edgeId = hop > 0 ? view.pathSteps[index][hop - 1] : null
              const edge = edgeId ? edgeById.get(edgeId) : undefined
              const step = edge && stepText(edge, byId)
              return (
                <li key={`${id}@${hop}`}>
                  <span className="font-medium">
                    {EVIDENCE_STATES[node.state].label}
                  </span>
                  {': '}
                  {nodeLabel(node.label)} ({node.id})
                  {node.addedByOntology ? ', added by the ontology' : ''}
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
