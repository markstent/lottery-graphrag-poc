/**
 * Answer presentation shared by both Live Lab panes.
 */

import type { MockAnswer } from '../mock/telemetry'

export function AnswerBlock({
  answer,
  onCitation,
}: {
  answer: MockAnswer
  onCitation?: (citationId: string) => void
}) {
  return (
    <div className="panel-reveal mt-4 rounded-card border border-border bg-surface-raised p-4">
      <p className="text-sm leading-relaxed text-text-primary">{answer.text}</p>
      <ul className="mt-3 flex flex-wrap gap-2">
        {answer.citations.map((citation) => (
          <li key={citation.id}>
            <button
              type="button"
              onClick={() => onCitation?.(citation.id)}
              className="rounded-chip border border-border bg-surface px-2 py-1 text-xs text-text-secondary transition-colors duration-micro hover:border-graph hover:text-text-primary"
              aria-label={`Inspect citation ${citation.label}`}
            >
              {citation.kind === 'graph-node'
                ? '🔗'
                : citation.kind === 'document'
                  ? '📄'
                  : '📊'}{' '}
              {citation.label}
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-text-muted">
        {answer.latencyMs / 1000}s latency ·{' '}
        {answer.contextTokens.toLocaleString()} context tokens
      </p>
    </div>
  )
}
