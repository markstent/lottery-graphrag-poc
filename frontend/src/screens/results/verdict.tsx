/** What a run says: three tiles and its headline sentences, or for a quick check only a warning. */

import type { Schemas } from '../../api/client'
import { EVIDENCE_LABEL } from '../../app/method'
import { percent } from '../../app/score-words'
import { StatTile } from '../../charts/stat-tile'
import { DisagreementNote } from '../../components/disagreement-note'
import { pipeline, type PipelineId } from '../../design/pipelines'
import {
  selectionText,
  standingWord,
  type RunStanding,
} from '../../results/runs'
import { intervalTestDisagreements, tiles } from '../../results/strata'

type Run = Schemas['BenchmarkRunOut']
type Summary = Schemas['SummaryOut']

export const QUICK_CHECK_WARNING =
  'A quick check tests the scoring code with a stand-in model. Its numbers are not results.'

/**
 * The recorded headlines, never rewritten. A run whose charts are shown also
 * gets the count of tested cells whose interval and test disagree, which
 * those charts draw.
 */
const Headlines = ({
  summary,
  charted = false,
}: {
  summary: Summary
  /** Whether the paired differences are drawn below, as for every run but a quick check. */
  charted?: boolean
}) => (
  <div className="space-y-1">
    <ul className="list-disc space-y-1 pl-5 text-sm text-text-primary">
      {summary.headlines.map((line, index) => (
        <li key={`${index}-${line}`}>{line}</li>
      ))}
    </ul>
    {charted && (
      <DisagreementNote
        count={intervalTestDisagreements(summary.comparisons)}
      />
    )}
  </div>
)

export function Verdict({
  run,
  summary,
  kind,
}: {
  run: Run
  summary: Summary
  kind: RunStanding
}) {
  if (kind === 'quick-check')
    return (
      <div className="space-y-3">
        <Headlines summary={summary} />
        <p className="text-sm font-medium text-text-primary">
          {QUICK_CHECK_WARNING}
        </p>
      </div>
    )
  return (
    <div className="space-y-4">
      {kind !== 'result' && (
        <p className="text-sm font-medium text-text-primary">
          <span className="mr-1 rounded-chip border border-border px-2 py-0.5">
            {standingWord(run)}
          </span>{' '}
          {selectionText(run.selection)}
        </p>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {tiles(summary).map(({ pipeline: id, evidence: cell, answer }) => (
          <div
            key={id}
            role="group"
            aria-label={`${pipeline(id as PipelineId).label} ${EVIDENCE_LABEL.toLowerCase()}`}
            className="space-y-1"
          >
            <StatTile
              label={`${EVIDENCE_LABEL}: ${pipeline(id as PipelineId).label}`}
              value={cell.mean}
              unit=""
              decimals={2}
              gap="Missing"
            />
            <div className="tabular text-sm text-text-secondary">
              {`Answer score ${percent(answer.mean)}`}
            </div>
          </div>
        ))}
      </div>
      <Headlines summary={summary} charted />
    </div>
  )
}
