/** What a run says: three tiles and its headline sentences, or for a quick check only a warning. */

import type { Schemas } from '../../api/client'
import { EVIDENCE_LABELS, evidenceMetric, methodBadge } from '../../app/method'
import { percent } from '../../app/score-words'
import { StatTile } from '../../charts/stat-tile'
import { pipeline, type PipelineId } from '../../design/pipelines'
import { selectionText, type RunStanding } from '../../results/runs'
import { printsIntervalBelowFloor, tiles } from '../../results/strata'

type Run = Schemas['BenchmarkRunOut']
type Summary = Schemas['SummaryOut']

export const QUICK_CHECK_WARNING =
  'A quick check tests the scoring code with a stand-in model. Its numbers are not results.'

export const BELOW_FLOOR_NOTE =
  'Intervals over fewer than six groups predate the rule; charts omit them.'

/** The recorded headlines, never rewritten; a run from before the group floor gets a note under them. */
const Headlines = ({ summary }: { summary: Summary }) => (
  <div className="space-y-1">
    <ul className="list-disc space-y-1 pl-5 text-sm text-text-primary">
      {summary.headlines.map((line, index) => (
        <li key={`${index}-${line}`}>{line}</li>
      ))}
    </ul>
    {printsIntervalBelowFloor(summary) && (
      <p className="text-sm text-text-secondary">{BELOW_FLOOR_NOTE}</p>
    )}
  </div>
)

/** The method the run was made under, in words: never colour alone. */
const MethodBadge = ({ method }: { method: string }) => (
  <p>
    <span className="inline-block rounded-chip border border-border px-2 py-0.5 text-sm font-medium text-text-primary">
      {methodBadge(method)}
    </span>
  </p>
)

export function Verdict({
  run,
  summary,
  method,
  kind,
}: {
  run: Run
  summary: Summary
  /** The method the run was made under, as the API reports it. */
  method: string
  kind: RunStanding
}) {
  const evidence = evidenceMetric(method)
  if (kind === 'quick-check')
    return (
      <div className="space-y-3">
        <MethodBadge method={method} />
        <Headlines summary={summary} />
        <p className="text-sm font-medium text-text-primary">
          {QUICK_CHECK_WARNING}
        </p>
      </div>
    )
  return (
    <div className="space-y-4">
      <MethodBadge method={method} />
      {kind === 'subset' && (
        <p className="text-sm font-medium text-text-primary">
          <span className="mr-1 rounded-chip border border-border px-2 py-0.5">
            Subset run
          </span>{' '}
          {selectionText(run.selection)}
        </p>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {tiles(summary, evidence).map(
          ({ pipeline: id, evidence: cell, answer }) => (
            <div
              key={id}
              role="group"
              aria-label={`${pipeline(id as PipelineId).label} ${EVIDENCE_LABELS[evidence].toLowerCase()}`}
              className="space-y-1"
            >
              <StatTile
                label={`${EVIDENCE_LABELS[evidence]}: ${pipeline(id as PipelineId).label}`}
                value={cell.mean}
                unit=""
                decimals={2}
                gap="Missing"
              />
              <div className="tabular text-sm text-text-secondary">
                {`Answer score ${percent(answer.mean)}`}
              </div>
            </div>
          ),
        )}
      </div>
      <Headlines summary={summary} />
    </div>
  )
}
