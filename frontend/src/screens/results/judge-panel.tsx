/** The judge's five scores (0 to 2) per kind of question and approach, and how often it agrees with the answer score. */

import type { Schemas } from '../../api/client'
import { DataTable } from '../../charts/data-table'
import { CAPTIONS, TABLE_HEADS } from '../../results/labels'
import {
  agreement,
  isThresholdAgreement,
  JUDGE_LABELS,
  judgeRows,
  MIN_PAIRS_FOR_KAPPA,
} from '../../results/strata'
import { RunBadge } from './run-badge'

type Summary = Schemas['SummaryOut']

/** How a method v0.3 run's agreement is read; a v0.2 run's table stands as it was published. */
const SPLIT_NOTE = `Agreement: the judge's level (0, 1, 2) matches the answer score's (0, partly, 1). Weighted kappa allows for chance; shown from ${MIN_PAIRS_FOR_KAPPA} judged answers.`

export function JudgePanel({
  summary,
  badge,
}: {
  summary: Summary
  badge?: string
}) {
  const judged = summary.judge_agreement
  // A run of method v0.3 splits agreement into answers that answered and abstained.
  const split = judged !== null && !isThresholdAgreement(judged)
  return (
    <div className="space-y-4">
      <RunBadge label={badge} />
      <DataTable
        caption={CAPTIONS.judge}
        rowHeader={TABLE_HEADS.kindApproach}
        columns={Object.values(JUDGE_LABELS)}
        rows={judgeRows(summary)}
      />
      <div className="space-y-2">
        {split && (
          <p className="max-w-prose text-sm text-text-secondary">
            {SPLIT_NOTE}
          </p>
        )}
        <DataTable
          caption={CAPTIONS.agreement}
          rowHeader={TABLE_HEADS.group}
          columns={[
            TABLE_HEADS.pairs,
            TABLE_HEADS.agreement,
            split ? TABLE_HEADS.weightedKappa : TABLE_HEADS.kappa,
          ]}
          rows={agreement(summary) ?? []}
        />
      </div>
    </div>
  )
}
