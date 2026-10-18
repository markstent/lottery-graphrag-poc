/**
 * Graph & Ontology pane: seed resolution, traversal, candidate handling and
 * evidence selection, driven purely by graph telemetry events (docs/06 §5).
 */

import type { GraphPaneState } from '../mock/telemetry'

import { AnswerBlock } from './answer-block'
import { GraphCanvas, GraphLegend } from './graph-canvas'

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
        ? 'Resolving seeds from the question…'
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
          <span className="ml-2 text-xs font-normal text-muted">
            relationships and canonical concepts
          </span>
        </h3>
      </header>

      <p className="mb-2 text-sm text-secondary" role="status">
        {headline}
      </p>

      {nodes.length === 0 ? (
        <p className="rounded-card border border-dashed border-border p-6 text-center text-sm text-muted">
          Pick a question chip above or press Run to watch entity seeds and
          graph traversal unfold.
        </p>
      ) : (
        <>
          <div className="rounded-card border border-border bg-surface p-2">
            <GraphCanvas state={state} />
          </div>
          <div className="mt-2">
            <GraphLegend />
          </div>
        </>
      )}

      {state.evidencePath.length > 0 && (
        <p className="mt-3 text-xs text-success" aria-label="Evidence path">
          Evidence path: {state.evidencePath.join(' → ')}
        </p>
      )}

      {state.tokenCount !== null && (
        <p className="mt-1 text-xs text-muted">
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
