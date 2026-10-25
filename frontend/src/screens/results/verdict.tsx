/** What a run says: three tiles and its headline sentences, or for a quick check only a warning. */

import type { Schemas } from '../../api/client'
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
      {kind === 'subset' && (
        <p className="text-sm font-medium text-text-primary">
          <span className="mr-1 rounded-chip border border-border px-2 py-0.5">
            Subset run
          </span>{' '}
          {selectionText(run.selection)}
        </p>
      )}
      <div className="grid grid-cols-3 gap-4">
        {tiles(summary).map(({ pipeline: id, evidence, answer }) => (
          <div
            key={id}
            role="group"
            aria-label={`${pipeline(id as PipelineId).label} evidence score`}
            className="space-y-1"
          >
            <StatTile
              label={`Evidence score: ${pipeline(id as PipelineId).label}`}
              value={evidence.mean}
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
      <Headlines summary={summary} />
    </div>
  )
}
