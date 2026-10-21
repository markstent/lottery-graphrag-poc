/**
 * Experiment Home (docs/06 section 11): saved experiment configurations,
 * dataset and model selection. Prototype shows the approved demo
 * configuration; live generation arrives with Phase 9 integration.
 *
 * 2026-10-10 addition: a "start here" strip at the top gives the app a
 * guided reading order (Live Lab → Evidence → Results); the approved
 * configuration content below is unchanged.
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

const START_HERE = [
  {
    step: '1',
    title: 'Watch it answer',
    body: 'Run a saved question in Live Lab and watch standard RAG and the graph pipeline side by side.',
    target: 'live-lab' as const,
    label: 'Open Live Lab',
  },
  {
    step: '2',
    title: 'Check the proof',
    body: 'Click any citation to see the document chunk or graph node behind it, with full provenance.',
    target: 'live-lab' as const,
    label: 'Open Live Lab',
  },
  {
    step: '3',
    title: 'Read the scoreline',
    body: 'Results publishes the benchmark outcome: what the graph and ontology add over the baseline.',
    target: 'results' as const,
    label: 'Open Results',
  },
]

export function ExperimentHome() {
  return (
    <div className="space-y-4">
      <section
        aria-label="Start here"
        className="rounded-card border border-border bg-surface p-4"
      >
        <h2 className="text-lg">Start here</h2>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-text-secondary">
          This app measures what a knowledge graph and an enterprise ontology
          add to AI retrieval over a synthetic lottery enterprise. The quickest
          way to understand it is to follow one question through the app:
        </p>
        <ol className="mt-3 grid gap-3 md:grid-cols-3">
          {START_HERE.map((item) => (
            <li
              key={item.step}
              className="flex flex-col rounded-card border border-border bg-surface-raised p-3"
            >
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="flex h-6 w-6 items-center justify-center rounded-full border border-graph/60 text-xs font-semibold text-graph"
                >
                  {item.step}
                </span>
                <p className="text-sm font-medium text-text-primary">
                  {item.title}
                </p>
              </div>
              <p className="mt-1.5 flex-1 text-sm leading-relaxed text-text-secondary">
                {item.body}
              </p>
              <a
                href={hrefFor(item.target)}
                className="mt-2 text-sm font-medium text-graph hover:underline"
              >
                {item.label} →
              </a>
            </li>
          ))}
        </ol>
      </section>

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
                <p className="text-sm font-medium text-text-primary">
                  {experiment.label}
                </p>
                <p className="mt-0.5 text-xs text-text-muted">
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
                <dt className="text-text-muted">{term}</dt>
                <dd className="text-text-secondary">{detail}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 flex gap-2">
            <a
              href={hrefFor('results')}
              className="rounded-chip bg-graph px-4 py-1.5 text-sm font-medium text-background transition-opacity duration-micro hover:opacity-90"
            >
              Run benchmark
            </a>
            <a
              href={hrefFor('data-model')}
              className="rounded-chip border border-border px-3 py-1.5 text-sm text-text-secondary transition-colors duration-micro hover:text-text-primary"
            >
              Configure scenarios
            </a>
          </div>
          <p className="mt-3 text-xs text-text-muted">
            Prototype: dataset generation and benchmark execution are mocked.
            Phase 9 wires these to the API.
          </p>
        </section>
      </div>
    </div>
  )
}
