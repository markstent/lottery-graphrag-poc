/**
 * Benchmark Runner (docs/06 section 15): calm progress view over the
 * completed mock run, with per-question drill-in to replays.
 */

import { hrefFor } from '../app/router'
import { BENCHMARK_RESULTS } from '../mock/content'

const QUESTION_STATUSES = [
  { id: 'Q-001', complexity: 'L1', status: 'ok' },
  { id: 'Q-007', complexity: 'L3', status: 'ok' },
  { id: 'Q-014', complexity: 'L5', status: 'error' },
  { id: 'Q-021', complexity: 'L6', status: 'error' },
  { id: 'Q-027', complexity: 'L4', status: 'ok' },
  { id: 'Q-030', complexity: 'L2', status: 'ok' },
] as const

export function BenchmarkRunner() {
  const results = BENCHMARK_RESULTS
  return (
    <div className="space-y-4">
      <section
        aria-label="Benchmark header"
        className="rounded-card border border-border bg-surface p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg">Benchmark Runner</h2>
            <p className="text-xs text-text-muted">
              {results.benchmarkRunId} · exp-demo-2026-10 · completed
            </p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={hrefFor('experiment')}
              className="rounded-chip border border-border px-3 py-1.5 text-sm text-text-secondary transition-colors duration-micro hover:text-text-primary"
            >
              ← Setup
            </a>
            <a
              href={hrefFor('results', {
                benchmark_run_id: results.benchmarkRunId,
              })}
              className="rounded-chip bg-graph px-4 py-1.5 text-sm font-medium text-background transition-opacity duration-micro hover:opacity-90"
            >
              Open results
            </a>
          </div>
        </div>
      </section>

      <section
        aria-label="Progress"
        className="rounded-card border border-border bg-surface p-4"
      >
        <div className="flex items-center justify-between text-sm text-text-secondary">
          <span>
            {results.questions}/{results.questions} questions complete
          </span>
          <span className="text-xs text-text-muted">
            2 errors recorded and surfaced
          </span>
        </div>
        <div
          className="mt-2 h-2 rounded-full bg-border"
          role="progressbar"
          aria-valuenow={100}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Benchmark progress"
        >
          <div className="h-full w-full rounded-full bg-graph" />
        </div>
        <dl className="mt-3 grid grid-cols-3 gap-3 text-xs">
          {(
            [
              [
                'Correctness',
                `${results.overview.correctness[2].toFixed(2)} (C)`,
              ],
              [
                'Evidence recall',
                `${results.overview.evidenceRecall[2].toFixed(2)} (C)`,
              ],
              [
                'Median latency',
                `${(results.efficiency.latencyMs[2] / 1000).toFixed(1)}s (C)`,
              ],
            ] as const
          ).map(([term, detail]) => (
            <div key={term} className="rounded-card border border-border p-2">
              <dt className="text-text-muted">{term}</dt>
              <dd className="mt-0.5 text-text-secondary tabular-nums">
                {detail}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section
        aria-label="Questions"
        className="rounded-card border border-border bg-surface p-4"
      >
        <h3 className="mb-2 text-sm font-semibold text-text-secondary">
          Questions
        </h3>
        <table className="w-full text-sm">
          <caption className="sr-only">Benchmark question statuses</caption>
          <thead>
            <tr className="text-left text-xs text-text-muted">
              <th scope="col" className="pb-1 font-normal">
                Question
              </th>
              <th scope="col" className="pb-1 font-normal">
                Complexity
              </th>
              <th scope="col" className="pb-1 font-normal">
                Status
              </th>
              <th scope="col" className="pb-1 font-normal">
                Replay
              </th>
            </tr>
          </thead>
          <tbody>
            {QUESTION_STATUSES.map((question) => (
              <tr key={question.id} className="border-t border-border">
                <th
                  scope="row"
                  className="py-1.5 pr-3 font-normal text-text-secondary"
                >
                  {question.id}
                </th>
                <td className="py-1.5 pr-3 text-text-muted">
                  {question.complexity}
                </td>
                <td className="py-1.5 pr-3">
                  {question.status === 'ok' ? (
                    <span className="text-success">● ok</span>
                  ) : (
                    <span className="text-error">● error</span>
                  )}
                </td>
                <td className="py-1.5">
                  <a
                    href={hrefFor('lab', { run: 'RUN-2026-10-07-01' })}
                    className="text-xs text-graph hover:underline"
                  >
                    watch
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-text-muted">
          Prototype: shows a sample of the mock suite. Errors stay visible and
          link to replays; the runner stays calm during automated execution.
        </p>
      </section>
    </div>
  )
}
