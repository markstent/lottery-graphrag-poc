/** Time, context size and evidence per 1,000 tokens: the table for every kind of question, and two charts for all questions. */

import type { Schemas } from '../../api/client'
import { DataTable } from '../../charts/data-table'
import { GroupedBars } from '../../charts/grouped-bars'
import { niceTicks } from '../../charts/scale'
import { PIPELINES } from '../../design/pipelines'
import { CAPTIONS, MEASURES, TABLE_HEADS } from '../../results/labels'
import { efficiencyRows, STRATUM_LABELS } from '../../results/strata'
import { RunBadge } from './run-badge'

type Summary = Schemas['SummaryOut']

const CHARTS = [
  { metric: 'latency_ms', title: MEASURES.latency },
  { metric: 'context_tokens', title: MEASURES.context },
] as const

export function EfficiencyPanel({
  summary,
  badge,
}: {
  summary: Summary
  badge?: string
}) {
  return (
    <div className="space-y-4">
      <RunBadge label={badge} />
      <p className="text-sm text-text-secondary">
        Means per question, without intervals.
      </p>
      <div className="grid grid-cols-2 gap-6">
        {CHARTS.map(({ metric, title }) => {
          const values = Object.fromEntries(
            PIPELINES.map(({ id }) => [
              id,
              summary.metrics.overall?.[metric]?.[id]?.mean ?? null,
            ]),
          )
          const top = Math.max(0, ...Object.values(values).map((v) => v ?? 0))
          return (
            <GroupedBars
              key={metric}
              title={title}
              groups={[
                { key: 'overall', label: STRATUM_LABELS.overall, values },
              ]}
              unit={title}
              domain={[0, niceTicks([0, top], 5).at(-1) ?? 1]}
              decimals={0}
            />
          )
        })}
      </div>
      <DataTable
        caption={CAPTIONS.efficiency}
        rowHeader={TABLE_HEADS.kindApproach}
        columns={[MEASURES.latency, MEASURES.context, MEASURES.efficiency]}
        rows={efficiencyRows(summary)}
      />
    </div>
  )
}
