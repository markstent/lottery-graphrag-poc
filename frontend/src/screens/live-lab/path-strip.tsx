/**
 * The evidence paths of B or C as compact rows: each node a button that opens
 * it, joined by the recorded relationship in plain words. It appears only
 * once the pipeline has recorded its paths (graph.evidence_path.completed).
 * A path that is only the beginning of a longer one is left out, since the
 * longer one shows it. The first few paths show; the rest open on request.
 */

import { ArrowLeft, ArrowRight } from 'lucide-react'
import { useMemo, useState } from 'react'

import type { Schemas } from '../../api/client'
import { nodeLabel } from '../../design/node-labels'
import { pipeline } from '../../design/pipelines'
import { relationshipPhrase } from '../../design/relationships'
import type { GraphView } from '../../graph/model'
import type { RunState } from '../../run/reduce'
import { pipelineView, type GraphPipeline } from './graph-views'

/** Paths shown before "Show all". */
const SHOWN_PATHS = 4

/** The recorded paths, each with the edges of its hops; shorter beginnings dropped. */
function strips(view: GraphView) {
  const nodes = new Map(view.nodes.map((n) => [n.id, n]))
  const edges = new Map(view.edges.map((e) => [e.id, e]))
  const all = view.recordedPaths.map((ids, index) => ({
    ids,
    hops: ids.slice(1).map((_, hop) => {
      const edgeId = view.pathSteps[index][hop]
      return edgeId ? (edges.get(edgeId) ?? null) : null
    }),
  }))
  const begins = (a: string[], b: string[]) =>
    a.length < b.length && a.every((id, i) => id === b[i])
  return {
    nodes,
    paths: all.filter((p) => !all.some((q) => begins(p.ids, q.ids))),
  }
}

export function PathStrip({
  id,
  state,
  results,
  onOpen,
}: {
  id: GraphPipeline
  state: RunState
  results: Schemas['QueryResults'] | null
  onOpen: (pipeline: GraphPipeline, nodeId: string) => void
}) {
  const [all, setAll] = useState(false)
  const view = useMemo(
    () =>
      pipelineView({
        state,
        results,
        id,
        cap: Number.POSITIVE_INFINITY,
        focus: false,
      }),
    [state, results, id],
  )
  const { nodes, paths } = useMemo(() => strips(view), [view])
  if (!view.pathRecorded || paths.length === 0) return null
  const { label, tint, strong } = pipeline(id)
  const shown = all ? paths : paths.slice(0, SHOWN_PATHS)
  return (
    <section
      aria-label={`${label} evidence path`}
      className="min-w-0 overflow-hidden rounded-card border border-hairline bg-surface"
    >
      <h3
        className="px-4 py-2 text-base font-semibold"
        style={{ backgroundColor: tint, color: strong }}
      >
        {label}
      </h3>
      <div className="space-y-2 p-4">
        {shown.map((path, index) => (
          <ol
            key={path.ids.join('>')}
            aria-label={`Path ${index + 1}`}
            className="flex flex-wrap items-center gap-x-1 gap-y-2"
          >
            {path.ids.map((nodeId, hop) => {
              const node = nodes.get(nodeId)
              const edge = hop > 0 ? path.hops[hop - 1] : null
              const along = edge?.target === nodeId
              const Arrow = along ? ArrowRight : ArrowLeft
              return (
                <li
                  key={`${nodeId}@${hop}`}
                  className="flex items-center gap-1"
                >
                  {hop > 0 && (
                    <span className="flex items-center gap-1 px-1 text-sm text-text-secondary">
                      <Arrow aria-hidden size={14} />
                      {edge
                        ? relationshipPhrase(edge.relationship)
                        : 'a link that was not recorded'}
                    </span>
                  )}
                  {node ? (
                    <button
                      type="button"
                      data-node-id={nodeId}
                      onClick={() => onOpen(id, nodeId)}
                      className="rounded-chip border border-border bg-surface px-2 py-1 text-left text-sm text-text-primary hover:bg-surface-raised"
                    >
                      <span className="font-medium">
                        {nodeLabel(node.label)}
                      </span>{' '}
                      <span className="text-text-secondary">{nodeId}</span>
                      {node.addedByOntology && (
                        <span className="font-semibold"> + ontology</span>
                      )}
                    </button>
                  ) : (
                    <span className="text-sm text-text-muted">
                      a step that was not recorded
                    </span>
                  )}
                </li>
              )
            })}
          </ol>
        ))}
        {paths.length > SHOWN_PATHS && (
          <button
            type="button"
            aria-expanded={all}
            onClick={() => setAll(!all)}
            className="rounded-chip border border-border px-3 py-1 text-sm text-text-primary hover:bg-surface-raised"
          >
            {all ? 'Show fewer paths' : `Show all ${paths.length} paths`}
          </button>
        )}
      </div>
    </section>
  )
}
