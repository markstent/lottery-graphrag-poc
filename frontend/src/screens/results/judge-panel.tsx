/** The judge's five scores (0 to 2) per kind of question and approach, and how often it agrees with the answer score. */

import type { Schemas } from '../../api/client'
import { DataTable } from '../../charts/data-table'
import { CAPTIONS, TABLE_HEADS } from '../../results/labels'
import { agreement, JUDGE_LABELS, judgeRows } from '../../results/strata'
import { RunBadge } from './run-badge'

type Summary = Schemas['SummaryOut']

export function JudgePanel({
  summary,
  badge,
}: {
  summary: Summary
  badge?: string
}) {
  return (
    <div className="space-y-4">
      <RunBadge label={badge} />
      <DataTable
        caption={CAPTIONS.judge}
        rowHeader={TABLE_HEADS.kindApproach}
        columns={Object.values(JUDGE_LABELS)}
        rows={judgeRows(summary)}
      />
      <DataTable
        caption={CAPTIONS.agreement}
        rowHeader={TABLE_HEADS.group}
        columns={[TABLE_HEADS.pairs, TABLE_HEADS.agreement, TABLE_HEADS.kappa]}
        rows={agreement(summary) ?? []}
      />
    </div>
  )
}
