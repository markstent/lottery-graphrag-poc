/** The run's scores per kind of question: bars, paired differences and the ontology-dependent split. */

import { useState } from 'react'

import type { Schemas } from '../../api/client'
import { EVIDENCE_LABELS, type EvidenceMetric } from '../../app/method'
import { GroupedBars } from '../../charts/grouped-bars'
import { IntervalPlot } from '../../charts/interval-plot'
import {
  comparisonRows,
  splitRows,
  strataBars,
  type ShownMetric,
} from '../../results/strata'

type Summary = Schemas['SummaryOut']

/** The run's evidence metric and the answer score, each with its words. */
const metricsOf = (
  evidence: EvidenceMetric,
): { id: ShownMetric; label: string; points: string }[] => [
  { id: evidence, label: EVIDENCE_LABELS[evidence], points: 'evidence points' },
  { id: 'answer', label: 'Answer score', points: 'answer points' },
]

export function StrataCharts({
  summary,
  evidence,
  badge,
}: {
  summary: Summary
  /** The evidence metric the run's method compares. */
  evidence: EvidenceMetric
  /** Beside every chart: what kind of run these numbers come from, when it is not a result. */
  badge?: string
}) {
  const METRICS = metricsOf(evidence)
  const [metric, setMetric] = useState<ShownMetric>(evidence)
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
        gapNotes={bars.gapNotes}
        badge={badge}
        unit="score"
        domain={[0, 1]}
        decimals={2}
      />
      <IntervalPlot
        title={`Paired differences in ${label.toLowerCase()}`}
        rows={comparisonRows(summary, metric)}
        unit={points}
        zero
        badge={badge}
      />
      <section aria-labelledby="split-heading" className="space-y-2">
        <h3
          id="split-heading"
          className="text-base font-semibold text-text-primary"
        >
          Ontology-dependent split
        </h3>
        {split ? (
          <IntervalPlot
            title={`Differences in ${label.toLowerCase()}, by question group`}
            description="Descriptive: not part of the tested family."
            rows={split}
            unit={points}
            zero
            badge={badge}
          />
        ) : (
          <p className="text-sm text-text-secondary">
            This run predates the split.
          </p>
        )}
      </section>
    </div>
  )
}
