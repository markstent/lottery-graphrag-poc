/** The judge's five scores (0 to 2) per approach, and how often it agrees with the answer score. */

import type { Schemas } from '../../api/client'
import { DataTable } from '../../charts/data-table'
import { PIPELINES } from '../../design/pipelines'
import { CAPTIONS, MEASURES, TABLE_HEADS } from '../../results/labels'
import { agreement, judgeRows } from '../../results/strata'
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
        rowHeader={MEASURES.judge}
        columns={PIPELINES.map(({ label }) => label)}
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
