/**
 * Help (operator and presenter documentation, served in-app).
 *
 * Content mirrors the committed documentation: docs/demo/presentation.md,
 * docs/07-api-event-spec.md, docs/evaluation/harness-validation.md and
 * RELEASE.md. Numbers quoted here are the committed validation results,
 * never invented for presentation.
 *
 * 2026-10-18 SaaS polish: consolidated from 8 sections to 5 scannable
 * sections, eliminated duplicated screen catalogue cards, and tucked
 * reference tables into disclosures where appropriate.
 */

import { hrefFor } from '../app/router'
import {
  Callout,
  Card,
  Code,
  CommandBlock,
  Disclosure,
  PageHero,
  Rail,
  Section,
  Steps,
  Table,
} from '../components/doc'

const NAV_SECTIONS = [
  { id: 'big-picture', label: 'How it works' },
  { id: 'tour', label: 'Quick tour' },
  { id: 'numbers', label: 'Scores & metrics' },
  { id: 'backend', label: 'Backend & ops' },
  { id: 'reference', label: 'Glossary & access' },
]

function Toc() {
  return (
    <nav
      aria-label="Help sections"
      className="lg:sticky lg:top-6 lg:self-start"
    >
      <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted">
        On this page
      </p>
      <ol className="space-y-1 text-sm">
        {NAV_SECTIONS.map((section, index) => (
          <li key={section.id}>
            <a
              href={`#/help?section=${section.id}`}
              onClick={(event) => {
                event.preventDefault()
                document
                  .getElementById(`help-${section.id}`)
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
              className="flex items-baseline gap-2 rounded-chip px-3 py-1 text-secondary transition-colors duration-micro hover:bg-surface-raised hover:text-primary"
            >
              <span
                aria-hidden
                className="w-4 shrink-0 text-right text-xs tabular-nums text-muted"
              >
                {index + 1}
              </span>
              {section.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  )
}

function PipelineComparison() {
  return (
    <div className="space-y-3">
      <Rail
        items={[
          { label: 'Embed the question' },
          { label: 'Vector search', note: 'shared index' },
          { label: 'Rerank candidates' },
        ]}
      />
      <div className="grid gap-3 md:grid-cols-3">
        <Card
          title="A · Conventional RAG"
          footer={
            <p className="text-xs font-medium uppercase tracking-wide text-muted">
              Credible baseline
            </p>
          }
        >
          <p>
            Selects top document chunks within the token budget and answers from
            those chunks alone.
          </p>
        </Card>
        <Card
          title="B · + Graph"
          footer={
            <p className="text-xs font-medium uppercase tracking-wide text-graph">
              + Graph relationships
            </p>
          }
        >
          <p>
            Resolves entity seeds from the question, traverses a bounded 2-hop
            neighbourhood, and combines node facts with document chunks.
          </p>
        </Card>
        <Card
          title="C · + Ontology"
          footer={
            <p className="text-xs font-medium uppercase tracking-wide text-ontology">
              + Enterprise ontology
            </p>
          }
        >
          <p>
            Everything in B, plus <Code>MAPS_TO</Code> concept expansion across
            markets so a pattern in one country is found from another's
            question.
          </p>
        </Card>
      </div>
    </div>
  )
}

export function Help() {
  return (
    <div className="grid gap-6 lg:grid-cols-[200px_1fr]">
      <Toc />

      <div className="space-y-8">
        <PageHero
          eyebrow="Help"
          title="Your guide to the Semantic Context Lab"
          lead="This application measures what a knowledge graph and an enterprise ontology add to AI retrieval over a synthetic lottery enterprise (UK, GR, AT, CZ). Every record is synthetic, deterministic and safe to inspect."
        >
          <div className="grid gap-2 text-sm sm:grid-cols-3">
            <a
              className="rounded-card border border-border bg-surface-raised p-3 transition-colors duration-micro hover:border-graph/50"
              href={hrefFor('lab')}
            >
              <span className="font-medium text-primary">Presenting?</span>
              <span className="text-secondary"> Open Live Lab.</span>
            </a>
            <a
              className="rounded-card border border-border bg-surface-raised p-3 transition-colors duration-micro hover:border-graph/50"
              href={hrefFor('results')}
            >
              <span className="font-medium text-primary">Evaluating?</span>
              <span className="text-secondary"> Inspect Results.</span>
            </a>
            <a
              className="rounded-card border border-border bg-surface-raised p-3 transition-colors duration-micro hover:border-graph/50"
              href={hrefFor('dictionary')}
            >
              <span className="font-medium text-primary">
                Exploring schema?
              </span>
              <span className="text-secondary"> Open Data Dictionary.</span>
            </a>
          </div>
        </PageHero>

        <Section
          id="big-picture"
          title="How it works"
          lead="One question, three retrieval pipelines, one controlled lab."
        >
          <p>
            All three pipelines share the same embedding model, vector
            collection, reranker, generator and context budget. Pipeline B is
            identical to C minus the ontology step, isolating the value of each
            layer. Authoritative quantities stay in the Parquet warehouse; Neo4j
            stores relationships, concepts and provenance pointers.
          </p>
          <PipelineComparison />
          <Callout title="Built-in guardrails">
            Graph traversal is bounded by configuration (depth 2, max 200 nodes,
            evidence cap 12). Every stage emits a typed telemetry event and the
            UI renders only received events.
          </Callout>
        </Section>

        <Section
          id="tour"
          title="Quick tour & demo questions"
          lead="Run a question, inspect the citation chain, then check the benchmark."
        >
          <Steps
            items={[
              {
                title: 'Run a question in Live Lab',
                children: (
                  <p>
                    Click any <Code>DEMO-01..04</Code> chip in the composer or
                    press Run. Use the timeline to scrub and replay events.
                  </p>
                ),
              },
              {
                title: 'Inspect provenance',
                children: (
                  <p>
                    Click any citation chip under an answer to open the Evidence
                    Explorer with its source system and record ID.
                  </p>
                ),
              },
              {
                title: 'Switch to Live backend when ready',
                children: (
                  <p>
                    Toggle <strong>Live backend</strong> in the composer to
                    execute real pipelines against <Code>localhost:8000</Code>.
                  </p>
                ),
              },
            ]}
          />
          <Table
            head={['Chip', 'Scenario & question focus', 'Benchmark']}
            rows={[
              [
                'DEMO-01',
                'SCN-015: rules document that disagrees with the structured record for GAME_UK_01',
                'Q30',
              ],
              [
                'DEMO-02',
                'SCN-007: platform version linking the Greek checkout incident to other markets, and why the UK was unaffected',
                'Q25',
              ],
              [
                'DEMO-03',
                'SCN-003: accounts sharing payment instruments with PLAYER_GR_001283 (fraud profile)',
                'Q28',
              ],
              [
                'DEMO-04',
                'Unplanted scenario: verifies the system reports an honest empty result rather than inventing a pattern',
                'none',
              ],
            ]}
          />
        </Section>

        <Section
          id="numbers"
          title="Scores, metrics & provenance"
          lead="Live operational telemetry is separated strictly from benchmark truth."
        >
          <Table
            head={['Metric', 'Source', 'Where shown']}
            rows={[
              [
                'Latency & context tokens',
                'Measured on every run',
                'Live Lab score strip; Results efficiency',
              ],
              [
                'Answer correctness',
                'Deterministic check against grounded truth (harness only)',
                'Results; score strip for published benchmark questions',
              ],
              [
                'Evidence recall / precision',
                'Overlap with truth-ledger evidence (harness only)',
                'Results; score strip for published benchmark questions',
              ],
            ]}
          />
          <div className="grid gap-3 md:grid-cols-2">
            <Callout title="The honesty rule">
              Ad-hoc questions have no truth ledger entry, so quality columns
              stay in their waiting state; latency and token counts are always
              real.
            </Callout>
            <Callout title="Committed headline results">
              Dev world, bank 1.0.0: full-bank evidence recall{' '}
              <strong>A 0.02 vs B/C 0.62</strong>; real-model subset (Q01, Q25,
              Q28, Q30) answer score <strong>B/C 0.66 vs A 0.41</strong>,
              evidence recall <strong>0.65 vs 0.04</strong>.
            </Callout>
          </div>
          <Rail
            items={[
              { label: 'Answer' },
              { label: 'Citation' },
              { label: 'Chunk or graph node' },
              { label: 'Source record' },
              { label: 'Warehouse row' },
            ]}
          />
          <p className="text-xs text-muted">
            Demo world (<Code>data/generated/demo-seed2026</Code>, seed 2026):
            5,000,000 tickets, 100,000 players, 2,000 documents. The evaluator
            truth ledger is isolated from retrieval by automated tests.
          </p>
        </Section>

        <Section
          id="backend"
          title="Running the backend & troubleshooting"
          lead="Commands run from the repository root."
        >
          <CommandBlock
            lines={[
              'make services-up        # Neo4j + Qdrant (Docker/OrbStack)',
              'make demo-reset         # re-ingest demo graph + rebuild demo vector index',
              'make serve-demo-api     # API on :8000 against the demo world',
              'make dev-frontend       # UI on :5173',
            ]}
          />
          <Disclosure
            summary="Local LLM & benchmark CLI commands"
            note="Ollama / LiteLLM configuration and dataset regeneration"
          >
            <div className="space-y-3">
              <p className="text-xs text-secondary">
                By default the API uses the deterministic fake generator for
                instant stage demos. To run with a local model:
              </p>
              <CommandBlock
                lines={[
                  'GENERATION_PROVIDER=litellm \\',
                  'GENERATION_MODEL="ollama/qwen3.5:35b-a3b-q4_K_M" \\',
                  'GENERATION_API_BASE="http://localhost:11434" \\',
                  'make serve-demo-api',
                ]}
              />
              <Table
                head={['Command', 'Effect']}
                rows={[
                  [
                    'make generate-demo-data',
                    'Regenerates the demo dataset and truth ledger (~100s)',
                  ],
                  [
                    'make run-benchmark',
                    'Runs the 30-question harness; writes results.json, summary.json, report.md',
                  ],
                  [
                    'make ingest-graph && make index-vector',
                    'Restores Neo4j and Qdrant to the dev world',
                  ],
                ]}
              />
            </div>
          </Disclosure>
          <Disclosure
            summary="Troubleshooting common symptoms"
            note="5 recovery recipes · typed error codes"
          >
            <div className="space-y-3">
              <Table
                head={['Symptom', 'Recovery']}
                rows={[
                  [
                    '“Saved questions unavailable” in Live Lab',
                    'Start make serve-demo-api; verify http://localhost:8000/api/v1/health',
                  ],
                  [
                    'Backend run fails with MODEL_ERROR',
                    'Restart the model server or switch to Demo story; failures are recorded, never faked',
                  ],
                  [
                    'A run returns no graph seeds',
                    'The question names no graph entity; pick a saved demo question chip',
                  ],
                  [
                    'Graph looks wrong after tests ran',
                    'A GRAPH_E2E test wiped Neo4j into its fixture world; run make demo-reset (~2.5 min)',
                  ],
                  [
                    'Answers too slow on stage',
                    'Use the default deterministic generator for live presentations',
                  ],
                ]}
              />
              <p className="text-xs text-muted">
                Typed API error codes: <Code>MODEL_ERROR</Code>,{' '}
                <Code>EMBEDDING_ERROR</Code>,{' '}
                <Code>VECTOR_RETRIEVAL_ERROR</Code>, <Code>RUN_ERROR</Code>{' '}
                (docs/07 §11).
              </p>
            </div>
          </Disclosure>
        </Section>

        <Section
          id="reference"
          title="Glossary and accessibility"
          lead="Core terms and built-in access guarantees."
        >
          <Table
            head={['Term', 'Meaning']}
            rows={[
              [
                'Ontology',
                'BusinessConcept nodes plus MAPS_TO edges binding synonyms and cross-market equivalents to one concept.',
              ],
              [
                'Seed',
                'A graph node resolved from the question text; the entry point for bounded traversal.',
              ],
              [
                'Traversal',
                'Expansion from seeds across relationship types within configured depth and node caps.',
              ],
              [
                'Not planted',
                'A question whose home scenario does not exist in this world; reported, never scored.',
              ],
              [
                'Truth ledger',
                'Evaluator-only record of planted patterns; retrieval can never read it.',
              ],
              [
                'Provenance',
                'The source system and record behind every chunk, node and citation.',
              ],
              [
                'Demo story',
                'The committed offline-safe event stream replayed by Live Lab by default.',
              ],
            ]}
          />
          <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
            <li>
              Full keyboard navigation, visible focus states and skip-to-content
              link.
            </li>
            <li>
              Reduced motion respected via Settings or system preference; state
              remains readable without animation.
            </li>
            <li>
              Status is never conveyed by colour alone; every pane and table
              carries accessible labels.
            </li>
          </ul>
        </Section>
      </div>
    </div>
  )
}
