/**
 * Conventional RAG pane: real event-driven pipeline stages
 * (docs/06 section 4). Never weakened for contrast: chunking, similarity,
 * reranking and context construction are all shown.
 */

import type { MockCitation, RagPaneState } from '../mock/telemetry'

import { AnswerBlock } from './answer-block'

const STAGES = [
  ['idle', 'Query'],
  ['embedding', 'Embedding'],
  ['retrieving', 'Candidates'],
  ['reranking', 'Rerank'],
  ['assembling', 'Context'],
  ['answering', 'Answer'],
  ['done', 'Done'],
] as const

export function RagPane({
  state,
  onCitation,
}: {
  state: RagPaneState
  onCitation?: (citation: MockCitation) => void
}) {
  const stageIndex = STAGES.findIndex(([key]) => key === state.stage)

  return (
    <section
      aria-label="Current Approach pane (conventional RAG)"
      className="flex flex-col"
    >
      <header className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold tracking-wide text-text-secondary">
          CURRENT APPROACH
          <span className="ml-2 text-xs font-normal text-text-muted">
            vector retrieval over documents and metrics
          </span>
        </h3>
      </header>

      <ol className="mb-3 flex flex-wrap gap-1.5" aria-label="Pipeline stages">
        {STAGES.map(([key, label], index) => (
          <li
            key={key}
            aria-current={index === stageIndex ? 'step' : undefined}
            className={`rounded-chip px-2 py-0.5 text-xs ${
              index < stageIndex
                ? 'bg-surface-raised text-text-secondary'
                : index === stageIndex
                  ? 'border border-baseline text-text-primary'
                  : 'text-text-muted'
            }`}
          >
            {label}
          </li>
        ))}
      </ol>

      {state.chunks.length === 0 ? (
        <p className="rounded-card border border-dashed border-border p-6 text-center text-sm text-text-muted">
          {state.stage === 'idle'
            ? 'Run a question to see semantic retrieval.'
            : state.stage === 'embedding'
              ? 'Embedding the question…'
              : 'Retrieving candidate chunks…'}
        </p>
      ) : (
        <ul className="space-y-2" aria-label="Candidate chunks">
          {state.chunks.map((chunk) => {
            const selected = state.selectedIds.includes(chunk.id)
            return (
              <li
                key={chunk.id}
                className={`rounded-card border p-3 transition-opacity duration-panel ${
                  selected
                    ? 'border-success/60 bg-surface-raised'
                    : 'border-border opacity-60'
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm text-text-primary">
                    {chunk.title}
                  </span>
                  <span className="text-xs text-text-muted">
                    {chunk.sourceType}
                  </span>
                </div>
                <div
                  className="mt-2 h-1.5 rounded-full bg-border"
                  role="meter"
                  aria-label={`Similarity ${chunk.similarity.toFixed(2)}`}
                  aria-valuenow={Math.round(chunk.similarity * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className={`h-full rounded-full ${selected ? 'bg-success' : 'bg-baseline'}`}
                    style={{ width: `${Math.round(chunk.similarity * 100)}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-text-muted">
                  similarity {chunk.similarity.toFixed(2)}
                  {selected ? ' · selected into context' : ' · discarded'}
                </p>
              </li>
            )
          })}
        </ul>
      )}

      {state.tokenCount !== null && (
        <p className="mt-3 text-xs text-text-muted">
          Context assembled: {state.tokenCount.toLocaleString()} tokens
        </p>
      )}

      {state.answer &&
        (onCitation ? (
          <AnswerBlock
            answer={state.answer}
            onCitation={(id) => {
              const citation = state.answer?.citations.find(
                (entry) => entry.id === id,
              )
              if (citation) onCitation(citation)
            }}
          />
        ) : (
          <AnswerBlock answer={state.answer} />
        ))}
    </section>
  )
}
