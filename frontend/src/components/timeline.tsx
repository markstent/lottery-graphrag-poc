/**
 * Execution timeline: one row per telemetry event, replayable
 * (UX-LIVE-004). Selecting a row rewinds both panes to that moment.
 */

import type { TimelineEntry } from '../mock/telemetry'

const STREAM_LABEL = {
  rag: 'RAG',
  graph: 'GRAPH',
  evaluation: 'EVAL',
} as const

const KIND_LABEL: Record<string, string> = {
  query_received: 'query received',
  embedding_started: 'embedding started',
  embedding_completed: 'embedding completed',
  candidates_retrieved: 'candidates retrieved',
  similarity_scored: 'similarity scored',
  reranking_completed: 'reranking completed',
  context_selected: 'context selected',
  context_assembled: 'context assembled',
  answer_streaming: 'answer streaming',
  answer_completed: 'answer completed',
  seed_resolution: 'seeds resolved',
  traversal_started: 'traversal started',
  relationship_traversed: 'relationship traversed',
  ontology_mapping_applied: 'ontology mapping applied',
  candidate_rejected: 'candidate rejected',
  evidence_selected: 'evidence selected',
  evaluation_completed: 'evaluation completed',
}

export function Timeline({
  timeline,
  played,
  onSelect,
}: {
  timeline: TimelineEntry[]
  played: number
  onSelect: (count: number) => void
}) {
  return (
    <section aria-label="Execution timeline">
      <h3 className="mb-2 text-sm font-semibold text-text-secondary">
        Execution timeline
      </h3>
      {timeline.length === 0 ? (
        <p className="rounded-card border border-dashed border-border p-4 text-center text-sm text-text-muted">
          Events appear here as the pipelines execute. Select an event to
          rewind.
        </p>
      ) : (
        <ol className="max-h-56 space-y-1 overflow-y-auto rounded-card border border-border bg-surface p-2">
          {timeline.map((entry, index) => {
            const isPast = index < played
            return (
              <li key={`${entry.stream}-${entry.index}`}>
                <button
                  type="button"
                  onClick={() => onSelect(index + 1)}
                  aria-current={index === played - 1 ? 'true' : undefined}
                  className={`flex w-full items-center gap-2 rounded-chip px-2 py-1 text-left text-xs transition-colors duration-micro ${
                    isPast
                      ? index === played - 1
                        ? 'border border-graph/60 bg-surface-raised text-text-primary'
                        : 'text-text-secondary hover:bg-surface-raised'
                      : 'text-text-muted'
                  }`}
                >
                  <span className="w-12 shrink-0 tabular-nums">
                    {(entry.t / 1000).toFixed(1)}s
                  </span>
                  <span
                    className={`w-12 shrink-0 rounded-chip px-1 text-center ${
                      entry.stream === 'graph'
                        ? 'bg-graph/15 text-graph'
                        : entry.stream === 'rag'
                          ? 'bg-baseline/15 text-text-secondary'
                          : 'bg-ontology/15 text-ontology'
                    }`}
                  >
                    {STREAM_LABEL[entry.stream]}
                  </span>
                  <span>{KIND_LABEL[entry.kind] ?? entry.kind}</span>
                </button>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
