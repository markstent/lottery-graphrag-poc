/**
 * Experiment Home (docs/06 section 11): saved experiment configurations,
 * dataset and model selection. Prototype shows the approved demo
 * configuration; live generation arrives with Phase 9 integration.
 */

import { hrefFor } from '../app/router'
import { EXPERIMENT } from '../mock/content'

const SAVED_EXPERIMENTS = [
  {
    id: 'exp-demo-2026-10',
    label: 'Demo configuration (approved)',
    detail: 'A/B/C comparison · 4 enabled scenarios · dev world seed 2026',
  },
  {
    id: 'exp-baseline-only',
    label: 'Baseline only',
    detail: 'A comparison · conventional RAG reference',
  },
]

export function ExperimentHome() {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <section
        aria-label="Saved experiments"
        className="rounded-card border border-border bg-surface p-4"
      >
        <h2 className="mb-3 text-lg">Saved experiments</h2>
        <ul className="space-y-2">
          {SAVED_EXPERIMENTS.map((experiment) => (
            <li
              key={experiment.id}
              className={`rounded-card border p-3 ${
                experiment.id === EXPERIMENT.experimentId
                  ? 'border-graph/60 bg-surface-raised'
                  : 'border-border'
              }`}
            >
              <p className="text-sm font-medium text-primary">
                {experiment.label}
              </p>
              <p className="mt-0.5 text-xs text-muted">
                {experiment.id} · {experiment.detail}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-label="Configuration"
        className="rounded-card border border-border bg-surface p-4"
      >
        <h2 className="mb-3 text-lg">Configuration</h2>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[9rem_1fr]">
          {(
            [
              ['Dataset', EXPERIMENT.dataset],
              ['Markets', EXPERIMENT.markets.join(', ')],
              [
                'Generation model',
                `${EXPERIMENT.model} (${EXPERIMENT.provider})`,
              ],
              ['Embedding', EXPERIMENT.embedding],
              ['Comparison', 'A vs C (B available)'],
              ['Context budget', 'equal across pipelines'],
            ] as const
          ).map(([term, detail]) => (
            <div key={term} className="contents">
              <dt className="text-muted">{term}</dt>
              <dd className="text-secondary">{detail}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-4 flex gap-2">
          <a
            href={hrefFor('benchmark')}
            className="rounded-chip bg-graph px-4 py-1.5 text-sm font-medium text-background transition-opacity duration-micro hover:opacity-90"
          >
            Run benchmark
          </a>
          <a
            href={hrefFor('scenarios')}
            className="rounded-chip border border-border px-3 py-1.5 text-sm text-secondary transition-colors duration-micro hover:text-primary"
          >
            Configure scenarios
          </a>
        </div>
        <p className="mt-3 text-xs text-muted">
          Prototype: dataset generation and benchmark execution are mocked.
          Phase 9 wires these to the API.
        </p>
      </section>
    </div>
  )
}
