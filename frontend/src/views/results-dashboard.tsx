/**
 * Results Dashboard (docs/06 section 16): A/B/C outcomes with table-first,
 * chart-second rendering and failure drill-in.
 *
 * Data source: the latest published benchmark run from the API (the
 * harness's own aggregate, never recomputed here). When the API has no run
 * or is unreachable, the committed validation run from
 * docs/evaluation/harness-validation.md is shown instead and labelled.
 * When the published run is benchmark v2, which this screen cannot render
 * yet, a notice with its kind, label and headlines replaces the dashboard.
 */

import { useEffect, useState } from 'react'

import { hrefFor } from '../app/router'
import { Disclosure } from '../components/doc'
import { BENCHMARK_RESULTS, type BenchmarkResults } from '../mock/content'
import {
  fetchBenchmarkResults,
  type BenchmarkV2Notice,
} from '../api/backend-run'

const QUESTION_STATUSES = [
  { id: 'Q-001', complexity: 'L1', status: 'ok' },
  { id: 'Q-007', complexity: 'L3', status: 'ok' },
  { id: 'Q-014', complexity: 'L5', status: 'error' },
  { id: 'Q-021', complexity: 'L6', status: 'error' },
  { id: 'Q-027', complexity: 'L4', status: 'ok' },
  { id: 'Q-030', complexity: 'L2', status: 'ok' },
] as const

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
      <h3 className="text-xs text-text-muted">{label}</h3>
      <table className="mt-2 w-full text-sm">
        <tbody>
          {CONFIGS.map((config, index) => (
            <tr key={config}>
              <th
                scope="row"
                className="py-0.5 pr-2 text-left font-normal text-text-secondary"
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

type Source = 'api' | 'committed'

/** Stopgap until the product phase renders benchmark v2 results. */
function BenchmarkV2Section({ notice }: { notice: BenchmarkV2Notice }) {
  return (
    <section
      aria-label="Benchmark v2 run"
      className="rounded-card border border-border bg-surface p-4"
    >
      <h2 className="text-lg font-semibold text-text-primary">
        Results Dashboard
      </h2>
      <p className="mt-1 text-sm text-text-secondary">
        A benchmark v2 run is published: run{' '}
        <span className="font-mono">{notice.runId}</span>, kind{' '}
        <span className="font-mono">{notice.runKind}</span>
        {notice.label && (
          <>
            , labelled{' '}
            <strong className="text-text-primary">{notice.label}</strong>
          </>
        )}
        .
      </p>
      <p className="mt-1 text-sm text-text-secondary">
        The full results screen for benchmark v2 arrives in the product phase.
        Until then, these are the run&apos;s headlines as the harness wrote
        them:
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-text-primary">
        {notice.headlines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  )
}

export function ResultsDashboard() {
  const [results, setResults] = useState<BenchmarkResults>(BENCHMARK_RESULTS)
  const [source, setSource] = useState<Source>('committed')
  const [v2Notice, setV2Notice] = useState<BenchmarkV2Notice | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchBenchmarkResults()
      .then((published) => {
        if (cancelled || !published) return
        if (published.schema === 'v2') {
          setV2Notice(published.notice)
          return
        }
        setResults(published.results)
        setSource('api')
      })
      .catch(() => {
        // API offline or broken run: keep the committed validation run.
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (v2Notice) return <BenchmarkV2Section notice={v2Notice} />

  return (
    <div className="space-y-4">
      <section
        aria-label="Results header"
        className="rounded-card border border-border bg-surface p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-graph">
              30-question Evaluation Harness
            </p>
            <h2 className="mt-0.5 text-lg font-semibold text-text-primary">
              Results Dashboard
            </h2>
            <p className="text-xs text-text-muted">
              benchmark run {results.benchmarkRunId} · {results.questions}{' '}
              questions · same world, corpus, embedding and generation models
              {source === 'committed' && ' · committed validation run'}
            </p>
          </div>
          <a
            href={hrefFor('results', {
              benchmark_run_id: results.benchmarkRunId,
            })}
            className="rounded-chip border border-border px-3 py-1.5 text-sm text-text-secondary transition-colors duration-micro hover:text-text-primary"
          >
            Open runner
          </a>
        </div>
        <div className="mt-3 rounded-card border border-graph/30 bg-surface-raised p-3 text-xs text-text-secondary">
          <strong className="text-text-primary">Key finding:</strong> Across the
          30 benchmark questions, adding the knowledge graph and ontology lifts
          evidence recall from{' '}
          <span className="font-mono text-text-primary">
            {results.overview.evidenceRecall[0].toFixed(2)}
          </span>{' '}
          (Conventional RAG) to{' '}
          <span className="font-mono font-semibold text-graph">
            {results.overview.evidenceRecall[2].toFixed(2)}
          </span>{' '}
          (Graph + Ontology) and answer correctness from{' '}
          <span className="font-mono text-text-primary">
            {results.overview.correctness[0].toFixed(2)}
          </span>{' '}
          to{' '}
          <span className="font-mono font-semibold text-graph">
            {results.overview.correctness[2].toFixed(2)}
          </span>
          , with the largest gains on multi-hop (L4) and cross-market (L5)
          questions.
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
        <h3 className="mb-2 text-sm font-semibold text-text-secondary">
          Correctness by complexity
        </h3>
        <table className="w-full text-sm">
          <caption className="sr-only">
            Correctness per complexity level and configuration
          </caption>
          <thead>
            <tr className="text-left text-xs text-text-muted">
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
                  className="py-1.5 pr-3 font-normal text-text-secondary"
                >
                  {row.level}{' '}
                  <span className="text-text-muted">· {row.label}</span>
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
        {results.byMarket.length > 0 && (
          <section
            aria-label="By market"
            className="rounded-card border border-border bg-surface p-4"
          >
            <h3 className="mb-2 text-sm font-semibold text-text-secondary">
              Correctness by market
            </h3>
            <ul className="space-y-2 text-sm">
              {results.byMarket.map((row) => (
                <li key={row.market} className="flex items-center gap-3">
                  <span className="w-32 shrink-0 text-text-secondary">
                    {row.market}
                  </span>
                  {[
                    row.baseline,
                    row.graphRelationships,
                    row.graphOntology,
                  ].map((value, index) => (
                    <span
                      key={index}
                      className="h-1.5 flex-1 rounded-full bg-border"
                    >
                      <span
                        className={`block h-full rounded-full ${index === 2 ? 'bg-graph' : 'bg-baseline'}`}
                        style={{ width: `${Math.round(value * 100)}%` }}
                      />
                    </span>
                  ))}
                  <span className="w-10 text-right tabular-nums text-text-muted">
                    {row.graphOntology.toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section
          aria-label="Efficiency"
          className="rounded-card border border-border bg-surface p-4"
        >
          <h3 className="mb-2 text-sm font-semibold text-text-secondary">
            Efficiency
          </h3>
          <table className="w-full text-sm">
            <tbody>
              <tr>
                <th
                  scope="row"
                  className="py-1 pr-3 text-left font-normal text-text-secondary"
                >
                  Median latency
                </th>
                <td className="text-text-muted tabular-nums">
                  {results.efficiency.latencyMs
                    .map((ms) => `${(ms / 1000).toFixed(1)}s`)
                    .join(' · ')}
                </td>
              </tr>
              <tr>
                <th
                  scope="row"
                  className="py-1 pr-3 text-left font-normal text-text-secondary"
                >
                  Context tokens
                </th>
                <td className="text-text-muted tabular-nums">
                  {results.efficiency.contextTokens.join(' · ')}
                </td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2 text-xs text-text-muted">
            Order: A · B · C. Graph context costs more tokens and latency.
          </p>
        </section>
      </div>

      <section
        aria-label="Failure analysis"
        className="rounded-card border border-border bg-surface p-4"
      >
        <h3 className="mb-2 text-sm font-semibold text-text-secondary">
          Failure analysis
        </h3>
        <ul className="space-y-2">
          {results.failures.map((failure) => (
            <li
              key={`${failure.questionId}-${failure.pipeline}`}
              className="rounded-card border border-border p-3 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-chip bg-surface-raised px-2 py-0.5 text-xs text-text-muted">
                  {failure.questionId} · {failure.complexity}
                  {failure.pipeline
                    ? ` · pipeline ${failure.pipeline}`
                    : ' · not scored'}
                </span>
                <a
                  href={hrefFor('live-lab', { run: MOCK_RUN_ID })}
                  className="text-xs text-graph hover:underline"
                >
                  watch a replay
                </a>
              </div>
              <p className="mt-1 text-text-secondary">{failure.note}</p>
            </li>
          ))}
          {results.failures.length === 0 && (
            <li className="text-sm text-text-muted">No failures recorded.</li>
          )}
        </ul>
      </section>

      <Disclosure
        summary="Benchmark execution & question status log"
        note={`${results.questions}/${results.questions} questions complete · sample status drill-in`}
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-text-secondary">
            <span>
              Run {results.benchmarkRunId} · {results.questions}/
              {results.questions} questions complete
            </span>
            <a
              href={hrefFor('results', {
                benchmark_run_id: results.benchmarkRunId,
              })}
              className="text-graph hover:underline"
            >
              Open standalone runner ↗
            </a>
          </div>
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
                      href={hrefFor('live-lab', { run: MOCK_RUN_ID })}
                      className="text-xs text-graph hover:underline"
                    >
                      watch
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Disclosure>
    </div>
  )
}

const MOCK_RUN_ID = 'RUN-2026-10-07-01'
