/**
 * The newest official run by kind of question: one measure at a time, chosen
 * with a switch, as grouped bars for A, B and C. Overview and Help's chapter
 * 12 show it; the figures are the run's summary means, drawn as given.
 */

import { useState } from 'react'

import type { Finding, KindFigures, KindMetric } from '../app/latest-run'
import { GroupedBars } from '../charts/grouped-bars'

/** What evidence recall is called on the screens a reader meets first. */
export const EVIDENCE_LABEL = 'Evidence found'

/** What the two judges' mark is called on those screens. */
export const MARK_LABEL = "Judges' mark"

/** Each measure the chart can show, by its name on the screen. */
const KIND_LABELS: Record<KindMetric, string> = {
  answer: 'Answer score',
  evidence_recall: EVIDENCE_LABEL,
  judge_mark: MARK_LABEL,
}

/** The kinds of question as a short name, for the chart. */
const KIND_NAMES: Record<string, string> = {
  H1: 'Several linked records',
  H2: 'Matching terms across countries',
  H2_name: 'Local-language names',
  H3: 'Single facts',
  H5: 'Hidden patterns',
}

export function KindChart({
  kinds,
  clear,
}: {
  /** Each kind of question's mean per approach, by measure. */
  kinds: Record<KindMetric, KindFigures[]>
  /** The differences that passed their test, marked on their kind. */
  clear: readonly Finding[]
}) {
  const [metric, setMetric] = useState<KindMetric>('answer')
  const marks = (stratum: string) =>
    clear.some((f) => f.stratum === stratum && f.metric === metric)
      ? ' (clear result)'
      : stratum === 'H2_name'
        ? ' (not tested)'
        : ''
  const shown = (Object.keys(KIND_LABELS) as KindMetric[]).filter(
    (id) => kinds[id].length > 0,
  )
  const groups = kinds[metric].map(({ stratum, values }) => ({
    key: stratum,
    label: `${KIND_NAMES[stratum] ?? stratum}${marks(stratum)}`,
    values: Object.fromEntries(
      Object.entries(values).map(([id, v]) => [
        id,
        v === null ? null : v * 100,
      ]),
    ),
  }))
  const name = KIND_LABELS[metric]
  return (
    <div className="space-y-3">
      <div
        role="group"
        aria-label="Score shown"
        className="inline-flex overflow-hidden rounded-chip border border-border"
      >
        {shown.map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={metric === id}
            onClick={() => setMetric(id)}
            className={`px-4 py-1 text-sm ${metric === id ? 'bg-surface-raised font-semibold text-text-primary' : 'text-text-secondary hover:bg-surface-raised'}`}
          >
            {KIND_LABELS[id]}
          </button>
        ))}
      </div>
      <GroupedBars
        title={`${name} by kind of question`}
        groups={groups}
        unit="%"
        domain={[0, 100]}
        decimals={0}
        valueLabels
      />
    </div>
  )
}
