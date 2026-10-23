/**
 * One pipeline's column: its name in its colour and its status, the steps it
 * has taken, and the evidence it has met so far. Everything shown comes from
 * the run state.
 */

import { TriangleAlert } from 'lucide-react'

import { EVIDENCE_STATES } from '../../design/evidence-states'
import { pipeline, type PipelineId } from '../../design/pipelines'
import type { PipelineStatus, RunState } from '../../run/reduce'
import type { Schemas } from '../../api/client'
import {
  evidenceRows,
  evidenceSummary,
  pipelineNotice,
  stageRows,
} from './columns'
import { StageTracker } from './stage-tracker'

const STATUS_WORDS: Record<PipelineStatus, string> = {
  pending: 'Waiting',
  running: 'Running',
  completed: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
  skipped: 'Not started',
}

export function PipelineColumn({
  id,
  run,
  results,
}: {
  id: PipelineId
  run: RunState
  /** The run's stored results, once there are any; they name the records. */
  results: Schemas['QueryResults'] | null
}) {
  const { label, tint, strong } = pipeline(id)
  const state = run.pipelines[id]
  const rows = evidenceRows(id, run, results)
  const notice = pipelineNotice(state)

  return (
    <section
      aria-label={label}
      className="min-w-0 overflow-hidden rounded-card border border-hairline bg-surface"
    >
      <header
        className="flex items-baseline justify-between gap-2 px-4 py-2"
        style={{ backgroundColor: tint }}
      >
        <h2 className="text-base font-semibold" style={{ color: strong }}>
          {label}
        </h2>
        <span className="text-sm font-medium text-text-primary">
          {STATUS_WORDS[state.status]}
        </span>
      </header>
      <div className="space-y-4 p-4">
        <StageTracker rows={stageRows(id, state)} />
        {notice !== null && (
          <p
            role={state.status === 'failed' ? 'alert' : undefined}
            className="flex items-start gap-2 text-sm text-text-primary"
          >
            <TriangleAlert aria-hidden size={16} className="mt-0.5 shrink-0" />
            {notice}
          </p>
        )}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-text-primary">Evidence</h3>
          <p className="tabular text-sm text-text-secondary">
            {evidenceSummary(rows, state.status)}
          </p>
          {rows.length === 0 ? (
            <p className="text-sm text-text-muted">Nothing found yet.</p>
          ) : (
            <ul
              aria-label="Evidence"
              // A scrolling list must be reachable by keyboard.
              tabIndex={0}
              className="relative -m-1 max-h-72 space-y-1 overflow-y-auto p-1"
            >
              {rows.map((row) => {
                const design = EVIDENCE_STATES[row.state]
                const Icon = design.icon
                return (
                  <li key={row.id} className="flex items-start gap-2 text-sm">
                    <Icon
                      aria-hidden
                      size={16}
                      className="mt-0.5 shrink-0 text-text-secondary"
                    />
                    <span className="min-w-0 break-words">
                      <span className="sr-only">{design.label}: </span>
                      {row.title !== null && (
                        <span className="block font-medium text-text-primary">
                          {row.title}
                        </span>
                      )}
                      <span
                        className={
                          row.title === null
                            ? 'font-medium text-text-primary'
                            : 'text-text-muted'
                        }
                      >
                        {row.id}
                      </span>
                      <span className="text-text-muted">{` · ${row.kind}`}</span>
                      {row.detail !== null && (
                        <span className="block text-text-muted">
                          {row.detail}
                        </span>
                      )}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}
