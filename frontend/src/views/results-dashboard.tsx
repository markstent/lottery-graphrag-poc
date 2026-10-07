/**
 * Results Dashboard (docs/06 section 16): A/B/C outcomes with table-first,
 * chart-second rendering and failure drill-in.
 */

import { hrefFor } from '../app/router'
import { BENCHMARK_RESULTS } from '../mock/content'

const CONFIGS = [
  'A · Current Approach',
  'B · + Graph',
  'C · + Graph & Ontology',
] as const

function MetricCard({
  label,
  values,
}: {
  label: string
  values: readonly [number, number, number]
}) {
  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <h3 className="text-xs text-muted">{label}</h3>
      <table className="mt-2 w-full text-sm">
        <tbody>
          {CONFIGS.map((config, index) => (
            <tr key={config}>
              <th
                scope="row"
                className="py-0.5 pr-2 text-left font-normal text-secondary"
              >
                {config}
              </th>
              <td className="py-0.5 text-right">
                <span className="flex items-center justify-end gap-2">
                  <span className="h-1.5 w-24 rounded-full bg-border">
                    <span
                      className={`block h-full rounded-full ${index === 2 ? 'bg-graph' : 'bg-baseline'}`}
                      style={{ width: `${Math.round(values[index] * 100)}%` }}
                    />
                  </span>
                  <span className="w-10 text-right tabular-nums">
                    {values[index].toFixed(2)}
                  </span>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function ResultsDashboard() {
  const results = BENCHMARK_RESULTS
  return (
    <div className="space-y-4">
      <section
        aria-label="Results header"
        className="rounded-card border border-border bg-surface p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg">Results Dashboard</h2>
            <p className="text-xs text-muted">
              benchmark run {results.benchmarkRunId} · {results.questions}{' '}
              questions · same world, corpus, embedding and generation models
            </p>
          </div>
          <a
            href={hrefFor('benchmark', {
              benchmark_run_id: results.benchmarkRunId,
            })}
            className="rounded-chip border border-border px-3 py-1.5 text-sm text-secondary transition-colors duration-micro hover:text-primary"
          >
            Open runner
          </a>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-3">
        <MetricCard
          label="Answer correctness"
          values={results.overview.correctness}
        />
        <MetricCard
          label="Evidence recall"
          values={results.overview.evidenceRecall}
        />
        <MetricCard label="Grounding" values={results.overview.grounding} />
      </div>

      <section
        aria-label="By complexity"
        className="rounded-card border border-border bg-surface p-4"
      >
        <h3 className="mb-2 text-sm font-semibold text-secondary">
          Correctness by complexity
        </h3>
        <table className="w-full text-sm">
          <caption className="sr-only">
            Correctness per complexity level and configuration
          </caption>
          <thead>
            <tr className="text-left text-xs text-muted">
              <th scope="col" className="pb-1 font-normal">
                Level
              </th>
              {CONFIGS.map((config) => (
                <th key={config} scope="col" className="pb-1 font-normal">
                  {config}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {results.byComplexity.map((row) => (
              <tr key={row.level} className="border-t border-border">
                <th
                  scope="row"
                  className="py-1.5 pr-3 font-normal text-secondary"
                >
                  {row.level} <span className="text-muted">· {row.label}</span>
                </th>
                {[row.baseline, row.graphRelationships, row.graphOntology].map(
                  (value, index) => (
                    <td key={index} className="py-1.5">
                      <span className="flex items-center gap-2">
                        <span className="h-1.5 w-24 rounded-full bg-border">
                          <span
                            className={`block h-full rounded-full ${index === 2 ? 'bg-graph' : 'bg-baseline'}`}
                            style={{ width: `${Math.round(value * 100)}%` }}
                          />
                        </span>
                        <span className="w-10 tabular-nums">
                          {value.toFixed(2)}
                        </span>
                      </span>
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section
          aria-label="By market"
          className="rounded-card border border-border bg-surface p-4"
        >
          <h3 className="mb-2 text-sm font-semibold text-secondary">
            Correctness by market
          </h3>
          <ul className="space-y-2 text-sm">
            {results.byMarket.map((row) => (
              <li key={row.market} className="flex items-center gap-3">
                <span className="w-32 shrink-0 text-secondary">
                  {row.market}
                </span>
                {[row.baseline, row.graphRelationships, row.graphOntology].map(
                  (value, index) => (
                    <span
                      key={index}
                      className="h-1.5 flex-1 rounded-full bg-border"
                    >
                      <span
                        className={`block h-full rounded-full ${index === 2 ? 'bg-graph' : 'bg-baseline'}`}
                        style={{ width: `${Math.round(value * 100)}%` }}
                      />
                    </span>
                  ),
                )}
                <span className="w-10 text-right tabular-nums text-muted">
                  {row.graphOntology.toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section
          aria-label="Efficiency"
          className="rounded-card border border-border bg-surface p-4"
        >
          <h3 className="mb-2 text-sm font-semibold text-secondary">
            Efficiency
          </h3>
          <table className="w-full text-sm">
            <tbody>
              <tr>
                <th
                  scope="row"
                  className="py-1 pr-3 text-left font-normal text-secondary"
                >
                  Median latency
                </th>
                <td className="text-muted tabular-nums">
                  {results.efficiency.latencyMs
                    .map((ms) => `${(ms / 1000).toFixed(1)}s`)
                    .join(' · ')}
                </td>
              </tr>
              <tr>
                <th
                  scope="row"
                  className="py-1 pr-3 text-left font-normal text-secondary"
                >
                  Context tokens
                </th>
                <td className="text-muted tabular-nums">
                  {results.efficiency.contextTokens.join(' · ')}
                </td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted">
            Order: A · B · C. Graph context costs more tokens and latency.
          </p>
        </section>
      </div>

      <section
        aria-label="Failure analysis"
        className="rounded-card border border-border bg-surface p-4"
      >
        <h3 className="mb-2 text-sm font-semibold text-secondary">
          Failure analysis
        </h3>
        <ul className="space-y-2">
          {results.failures.map((failure) => (
            <li
              key={`${failure.questionId}-${failure.pipeline}`}
              className="rounded-card border border-border p-3 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-chip bg-surface-raised px-2 py-0.5 text-xs text-muted">
                  {failure.questionId} · {failure.complexity} · pipeline{' '}
                  {failure.pipeline}
                </span>
                <a
                  href={hrefFor('lab', { run: MOCK_RUN_ID })}
                  className="text-xs text-graph hover:underline"
                >
                  watch a replay
                </a>
              </div>
              <p className="mt-1 text-secondary">{failure.note}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

const MOCK_RUN_ID = 'RUN-2026-10-07-01'
