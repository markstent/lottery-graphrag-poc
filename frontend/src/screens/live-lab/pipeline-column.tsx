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
  contextLine,
  evidenceRows,
  evidenceSummary,
  pipelineNotice,
  stageRows,
  targetLine,
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
  canOpen,
  onOpen,
  oldMethod = false,
}: {
  id: PipelineId
  run: RunState
  /** A recording of the old method, which keeps its own step names. */
  oldMethod?: boolean
  /** The run's stored results, once there are any; they name the records. */
  results: Schemas['QueryResults'] | null
  /** Whether a row's record can be shown in the evidence drawer yet. */
  canOpen: (recordId: string) => boolean
  onOpen: (recordId: string) => void
}) {
  const { label, tint, strong } = pipeline(id)
  const state = run.pipelines[id]
  const rows = evidenceRows(id, run, results)
  const notice = pipelineNotice(state)
  const target = targetLine(id, run)
  const context = contextLine(state)

  return (
    <section
      aria-label={label}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-card border border-hairline bg-surface"
    >
      <header
        className="flex shrink-0 items-baseline justify-between gap-2 px-4 py-2"
        style={{ backgroundColor: tint }}
      >
        <h2 className="text-base font-semibold" style={{ color: strong }}>
          {label}
        </h2>
        <span className="text-sm font-medium text-text-primary">
          {STATUS_WORDS[state.status]}
        </span>
      </header>
      {/* The panel scrolls inside itself, so it is reachable by keyboard. */}
      <div
        role="group"
        aria-label={`${label} progress`}
        tabIndex={0}
        className="relative min-h-0 flex-1 space-y-4 overflow-y-auto p-4"
      >
        <StageTracker rows={stageRows(id, state, oldMethod)} />
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
          {target !== null && (
            <p className="text-sm text-text-secondary">{target}</p>
          )}
          {context !== null && (
            <p className="tabular text-sm text-text-secondary">{context}</p>
          )}
          {rows.length === 0 ? (
            <p className="text-sm text-text-muted">Nothing found yet.</p>
          ) : (
            <ul aria-label="Evidence" className="space-y-1">
              {rows.map((row) => {
                const design = EVIDENCE_STATES[row.state]
                const Icon = design.icon
                const body = (
                  <>
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
                      {row.place !== null && (
                        <span className="block text-text-muted">
                          {row.place}
                        </span>
                      )}
                      {row.detail !== null && (
                        <span className="block text-text-muted">
                          {row.detail}
                        </span>
                      )}
                    </span>
                  </>
                )
                return (
                  <li key={row.id} className="text-sm">
                    {canOpen(row.id) ? (
                      <button
                        type="button"
                        onClick={() => onOpen(row.id)}
                        className="flex w-full items-start gap-2 rounded-chip text-left hover:bg-surface-raised"
                      >
                        {body}
                      </button>
                    ) : (
                      <div className="flex items-start gap-2">{body}</div>
                    )}
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
