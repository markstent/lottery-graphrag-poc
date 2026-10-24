/** The run's scores per kind of question: bars, paired differences and the ontology-dependent split. */

import { useState } from 'react'

import type { Schemas } from '../../api/client'
import { GroupedBars } from '../../charts/grouped-bars'
import { IntervalPlot } from '../../charts/interval-plot'
import { comparisonRows, splitRows, strataBars } from '../../results/strata'

type Summary = Schemas['SummaryOut']
type Metric = 'evidence_f1' | 'answer'

const METRICS: { id: Metric; label: string; points: string }[] = [
  { id: 'evidence_f1', label: 'Evidence score', points: 'evidence points' },
  { id: 'answer', label: 'Answer score', points: 'answer points' },
]

export function StrataCharts({ summary }: { summary: Summary }) {
  const [metric, setMetric] = useState<Metric>('evidence_f1')
  const { label, points } =
    METRICS.find(({ id }) => id === metric) ?? METRICS[0]
  const bars = strataBars(summary, metric)
  const split = splitRows(summary, metric)
  return (
    <div className="space-y-8">
      <div
        role="group"
        aria-label="Metric"
        className="inline-flex overflow-hidden rounded-chip border border-border"
      >
        {METRICS.map(({ id, label: name }) => (
          <button
            key={id}
            type="button"
            aria-pressed={metric === id}
            onClick={() => setMetric(id)}
            className={`px-4 py-1 text-sm ${metric === id ? 'bg-surface-raised font-semibold text-text-primary' : 'text-text-secondary hover:bg-surface-raised'}`}
          >
            {name}
          </button>
        ))}
      </div>
      <GroupedBars
        title={`${label} by kind of question`}
        groups={bars.groups}
        delta={bars.delta}
        unit="score"
        domain={[0, 1]}
        decimals={2}
      />
      <IntervalPlot
        title={`Paired differences in ${label.toLowerCase()}`}
        description="Difference in points; the line marks zero."
        rows={comparisonRows(summary, metric)}
        unit={points}
        zero
      />
      <div className="space-y-2">
        {split ? (
          <>
            <IntervalPlot
              title={`Ontology-dependent split in ${label.toLowerCase()}`}
              rows={split}
              unit={points}
              zero
            />
            <p className="text-sm text-text-secondary">
              Descriptive: not part of the tested family.
            </p>
          </>
        ) : (
          <p className="text-sm text-text-secondary">
            This run predates the split.
          </p>
        )}
      </div>
    </div>
  )
}
