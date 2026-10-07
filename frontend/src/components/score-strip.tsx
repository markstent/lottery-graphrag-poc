/**
 * Score strip after evaluation completes (docs/06 section 10): headline
 * metrics plus extended discovery measures in a disclosure.
 */

import type { ScoreStrip } from '../mock/telemetry'

interface MetricRow {
  label: string
  baseline: number | string
  graph: number | string
  higherIsBetter: boolean
}

function rows(scores: ScoreStrip): MetricRow[] {
  return [
    {
      label: 'Answer correctness',
      baseline: scores.correctness.baseline,
      graph: scores.correctness.graph,
      higherIsBetter: true,
    },
    {
      label: 'Evidence recall',
      baseline: scores.evidenceRecall.baseline,
      graph: scores.evidenceRecall.graph,
      higherIsBetter: true,
    },
    {
      label: 'Grounding',
      baseline: scores.grounding.baseline,
      graph: scores.grounding.graph,
      higherIsBetter: true,
    },
    {
      label: 'Latency',
      baseline: `${(scores.latencyMs.baseline / 1000).toFixed(1)}s`,
      graph: `${(scores.latencyMs.graph / 1000).toFixed(1)}s`,
      higherIsBetter: false,
    },
    {
      label: 'Context tokens',
      baseline: scores.contextTokens.baseline.toLocaleString(),
      graph: scores.contextTokens.graph.toLocaleString(),
      higherIsBetter: false,
    },
  ]
}

function Bar({ value, tone }: { value: number; tone: 'baseline' | 'graph' }) {
  return (
    <div className="h-1.5 w-28 rounded-full bg-border">
      <div
        className={`h-full rounded-full ${tone === 'graph' ? 'bg-graph' : 'bg-baseline'}`}
        style={{ width: `${Math.round(value * 100)}%` }}
      />
    </div>
  )
}

export function ScoreStrip({ scores }: { scores: ScoreStrip }) {
  return (
    <section
      aria-label="Evaluation scores"
      className="panel-reveal rounded-card border border-border bg-surface p-4"
    >
      <h3 className="mb-3 text-sm font-semibold text-secondary">Evaluation</h3>
      <table className="w-full text-sm">
        <caption className="sr-only">
          Evaluation metrics for both pipelines
        </caption>
        <thead>
          <tr className="text-left text-xs text-muted">
            <th scope="col" className="pb-1 font-normal">
              Metric
            </th>
            <th scope="col" className="pb-1 font-normal">
              Current Approach
            </th>
            <th scope="col" className="pb-1 font-normal">
              + Graph &amp; Ontology
            </th>
          </tr>
        </thead>
        <tbody>
          {rows(scores).map((row) => (
            <tr key={row.label} className="border-t border-border">
              <th
                scope="row"
                className="py-1.5 pr-4 font-normal text-secondary"
              >
                {row.label}
              </th>
              <td className="py-1.5 pr-4">
                {typeof row.baseline === 'number' ? (
                  <span className="flex items-center gap-2">
                    <Bar value={row.baseline} tone="baseline" />
                    {row.baseline.toFixed(2)}
                  </span>
                ) : (
                  row.baseline
                )}
              </td>
              <td className="py-1.5">
                {typeof row.graph === 'number' ? (
                  <span className="flex items-center gap-2">
                    <Bar value={row.graph} tone="graph" />
                    {row.graph.toFixed(2)}
                  </span>
                ) : (
                  row.graph
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <details className="mt-3">
        <summary className="cursor-pointer text-xs text-secondary hover:text-primary">
          Extended discovery measures
        </summary>
        <dl className="mt-2 grid grid-cols-3 gap-3 text-xs">
          {(
            [
              ['Relationship discovery', scores.extended.relationshipDiscovery],
              ['Cross-market discovery', scores.extended.crossMarketDiscovery],
              ['Ontology contribution', scores.extended.ontologyContribution],
            ] as const
          ).map(([label, values]) => (
            <div key={label} className="rounded-card border border-border p-2">
              <dt className="text-muted">{label}</dt>
              <dd className="mt-1 flex items-center gap-2 text-secondary">
                <span className="tabular-nums">
                  {values.baseline.toFixed(2)}
                </span>
                <span aria-hidden="true">→</span>
                <span className="text-graph tabular-nums">
                  {values.graph.toFixed(2)}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      </details>
      <p className="mt-3 text-xs text-muted">
        Scores come from the evaluator, never from retrieval. Latency and tokens
        show the cost of the richer context.
      </p>
    </section>
  )
}
