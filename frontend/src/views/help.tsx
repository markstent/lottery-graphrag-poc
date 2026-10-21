/**
 * Help (operator and presenter documentation, served in-app).
 *
 * Content mirrors the committed documentation: docs/demo/presentation.md,
 * docs/07-api-event-spec.md, docs/evaluation/harness-validation.md and
 * RELEASE.md. Numbers quoted here are the committed validation results,
 * never invented for presentation.
 *
 * 2026-10-18 SaaS redesign: converted from a long multi-section scroll into
 * a tabbed guide (1. Overview & Tour, 2. Concrete Example, 3. Scores &
 * Metrics, 4. Backend & Ops) so a first-time user sees one digestible
 * screen at a time, including a concrete side-by-side data walkthrough.
 */

import { useState } from 'react'

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

type HelpTab = 'overview' | 'example' | 'scores' | 'ops'

const TABS: Array<{ id: HelpTab; label: string }> = [
  { id: 'overview', label: '1 · Overview & Quick Tour' },
  { id: 'example', label: '2 · Concrete Data Example' },
  { id: 'scores', label: '3 · Scores & Honesty Rule' },
  { id: 'ops', label: '4 · Backend & Glossary' },
]

/**
 * Diagram of one planted graph neighbourhood (scenario SCN-007). Pure
 * flex/grid chips that wrap, never positioned SVG, so rows can reflow
 * without overlapping (UX layout rule) and screen readers read a path per
 * line.
 */
type DiagramNode = {
  id: string
  sub?: string
  tone?: 'seed' | 'concept' | 'plain'
}

type DiagramToken = { node: DiagramNode } | { rel: string }

const DIAGRAM_PATHS: { note?: string; tokens: DiagramToken[] }[] = [
  {
    tokens: [
      { node: { id: 'INC_S007_GR', sub: 'Incident', tone: 'seed' } },
      { rel: 'AFFECTS_MARKET' },
      { node: { id: 'MKT_GR', sub: 'Market', tone: 'plain' } },
    ],
  },
  {
    tokens: [
      { node: { id: 'INC_S007_GR', sub: 'Incident', tone: 'seed' } },
      { rel: 'RELATED_TO_VERSION' },
      {
        node: {
          id: 'PLV_PAYMENTS_3',
          sub: 'PlatformVersion',
          tone: 'plain',
        },
      },
      { rel: 'VERSION_OF' },
      { node: { id: 'PLT_PAYMENTS', sub: 'Platform', tone: 'plain' } },
    ],
  },
  {
    note: 'Ontology: pipeline C discovers the cross-market siblings',
    tokens: [
      { node: { id: 'INC_S007_AT', sub: 'Incident', tone: 'plain' } },
      { rel: 'MAPS_TO' },
      {
        node: {
          id: 'CONCEPT_PLATFORM_INCIDENT',
          sub: 'BusinessConcept',
          tone: 'concept',
        },
      },
      { rel: 'MAPS_TO' },
      { node: { id: 'INC_S007_CZ', sub: 'Incident', tone: 'plain' } },
    ],
  },
  {
    tokens: [
      { node: { id: 'DOC_S007_GR', sub: 'Document', tone: 'plain' } },
      { rel: 'REFERENCES' },
      { node: { id: 'INC_S007_GR', sub: 'Incident', tone: 'seed' } },
    ],
  },
  {
    tokens: [
      { node: { id: 'DOC_S007_GR', sub: 'Document', tone: 'plain' } },
      { rel: 'HAS_CHUNK' },
      {
        node: {
          id: 'CHNK_S007_GR_00',
          sub: 'DocumentChunk · vector in Qdrant',
          tone: 'plain',
        },
      },
    ],
  },
]

const NODE_TONES = {
  seed: 'border-graph/60 bg-graph/10 text-text-primary',
  concept: 'border-ontology/60 bg-ontology/10 text-ontology',
  plain: 'border-border bg-surface-raised text-text-secondary',
} as const

function DiagramChip({ node }: { node: DiagramNode }) {
  return (
    <span
      className={`inline-flex items-baseline gap-1.5 rounded-chip border px-2.5 py-1 ${
        NODE_TONES[node.tone ?? 'plain']
      }`}
    >
      <span className="font-mono text-xs font-medium">{node.id}</span>
      {node.sub && <span className="text-xs text-text-muted">{node.sub}</span>}
    </span>
  )
}

function GraphDiagram() {
  return (
    <figure
      aria-label="Diagram of one graph neighbourhood around incident INC_S007_GR"
      className="rounded-card border border-graph/40 bg-surface p-4"
    >
      <figcaption className="mb-3 text-xs font-semibold uppercase tracking-wide text-graph">
        The knowledge graph at a glance: one incident and everything connected
        to it
      </figcaption>
      <ol className="space-y-2.5">
        {DIAGRAM_PATHS.map((path, index) => (
          <li
            key={index}
            className="flex flex-wrap items-center gap-x-2 gap-y-1.5"
          >
            {path.tokens.map((token, tokenIndex) =>
              'node' in token ? (
                <DiagramChip key={tokenIndex} node={token.node} />
              ) : (
                <span
                  key={tokenIndex}
                  className="flex items-center gap-1.5 text-xs text-text-muted"
                >
                  <span aria-hidden>→</span>
                  <span className="font-mono text-xs uppercase tracking-wide text-graph">
                    {token.rel}
                  </span>
                  <span aria-hidden>→</span>
                </span>
              ),
            )}
            {path.note && (
              <span className="text-xs text-ontology">({path.note})</span>
            )}
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-text-muted">
        This is the planted neighbourhood for scenario SCN-007, one of 26 node
        labels joined by 26 relationship types. Every edge above is a real
        traversal in the demo world: watch it unfold step by step in the Live
        Lab graph pane.
      </p>
    </figure>
  )
}

export function Help() {
  const [tab, setTab] = useState<HelpTab>('overview')

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="Help & Orientation"
        title="How the Semantic Context Lab works"
        lead="This application compares Conventional RAG (vector search over documents) against Graph + Ontology retrieval over a synthetic 4-market lottery enterprise (UK, Greece, Austria, Czech Republic)."
      >
        <div className="grid gap-2 text-sm sm:grid-cols-3">
          <a
            className="rounded-card border border-border bg-surface-raised p-3 transition-colors duration-micro hover:border-graph/50"
            href={hrefFor('lab')}
          >
            <span className="font-medium text-text-primary">
              1. Try a question
            </span>
            <span className="block text-xs text-text-secondary">
              Open Live Lab and click a demo chip →
            </span>
          </a>
          <a
            className="rounded-card border border-border bg-surface-raised p-3 transition-colors duration-micro hover:border-graph/50"
            href={hrefFor('dictionary')}
          >
            <span className="font-medium text-text-primary">
              2. See the database rows
            </span>
            <span className="block text-xs text-text-secondary">
              Inspect sample Parquet tables & graph →
            </span>
          </a>
          <a
            className="rounded-card border border-border bg-surface-raised p-3 transition-colors duration-micro hover:border-graph/50"
            href={hrefFor('results')}
          >
            <span className="font-medium text-text-primary">
              3. Check the benchmark
            </span>
            <span className="block text-xs text-text-secondary">
              Compare A vs B vs C scores →
            </span>
          </a>
        </div>
      </PageHero>

      <div
        role="tablist"
        aria-label="Help sections"
        className="flex flex-wrap gap-1 border-b border-border pb-2"
      >
        {TABS.map((item) => (
          <button
            key={item.id}
            role="tab"
            type="button"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className={`rounded-chip px-3.5 py-1.5 text-sm font-medium transition-colors duration-micro ${
              tab === item.id
                ? 'border border-graph/60 bg-surface-raised text-text-primary'
                : 'border border-transparent text-text-secondary hover:bg-surface-raised hover:text-text-primary'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="space-y-6">
          <Section
            id="big-picture"
            title="Three retrieval pipelines, one controlled experiment"
            lead="All three pipelines use the exact same question, embedding model, vector index, reranker and token budget."
          >
            <Rail
              items={[
                { label: 'Question' },
                { label: 'Embed & vector search', note: 'shared Qdrant index' },
                { label: 'Rerank chunks' },
                { label: 'Add graph / ontology (B & C)' },
                { label: 'Generate answer' },
              ]}
            />
            <div className="grid gap-3 md:grid-cols-3">
              <Card
                title="A · Conventional RAG"
                footer={
                  <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
                    Baseline · Documents only
                  </p>
                }
              >
                <p>
                  Finds top-matching text chunks in Qdrant and answers from
                  those chunks alone. Fast, but misses cross-table and
                  cross-country links.
                </p>
              </Card>
              <Card
                title="B · + Graph"
                footer={
                  <p className="text-xs font-medium uppercase tracking-wide text-graph">
                    + Entity relationships
                  </p>
                }
              >
                <p>
                  Resolves entity IDs in the question (e.g.{' '}
                  <Code>GAME_UK_01</Code>) and traverses 2 hops in Neo4j to pull
                  linked incidents, versions and authoritative warehouse rows.
                </p>
              </Card>
              <Card
                title="C · + Graph & Ontology"
                footer={
                  <p className="text-xs font-medium uppercase tracking-wide text-ontology">
                    + Canonical concepts
                  </p>
                }
              >
                <p>
                  Adds <Code>MAPS_TO</Code> expansion through canonical{' '}
                  <Code>BusinessConcept</Code> nodes so an incident in Greece
                  automatically surfaces matching incidents in Austria and
                  Czechia.
                </p>
              </Card>
            </div>
          </Section>

          <Section
            id="tour"
            title="60-second walkthrough"
            lead="Follow one question from prompt to provenance."
          >
            <Steps
              items={[
                {
                  title: 'Click a question chip in Live Lab',
                  children: (
                    <p>
                      Pick <Code>dq-1</Code> (Greece conversion drop) or{' '}
                      <Code>DEMO-01..04</Code> and press <strong>Run</strong>.
                      Watch Conventional RAG on the left and Graph + Ontology on
                      the right.
                    </p>
                  ),
                },
                {
                  title: 'Click any citation chip under an answer',
                  children: (
                    <p>
                      An inline drawer slides open showing the exact source
                      table (<Code>incidents.parquet</Code>,{' '}
                      <Code>documents.parquet</Code>), record ID and graph path.
                    </p>
                  ),
                },
                {
                  title: 'Switch to Live backend when ready',
                  children: (
                    <p>
                      Toggle <strong>Live backend</strong> in the composer to
                      execute real queries against DuckDB, Qdrant and Neo4j on{' '}
                      <Code>localhost:8000</Code>.
                    </p>
                  ),
                },
              ]}
            />
          </Section>
        </div>
      )}

      {tab === 'example' && (
        <Section
          id="example"
          title="Concrete example: why Conventional RAG misses what the Graph finds"
          lead="Take the default question: “Why did digital conversion fall in Greece, and have we seen the same issue elsewhere?”"
        >
          <div className="grid gap-4 md:grid-cols-2">
            <Card
              title="What Conventional RAG sees (Text Chunks)"
              footer={
                <p className="text-xs text-text-muted">
                  Result: Explains Greece, misses Austria/Czechia and UK
                  deferral
                </p>
              }
            >
              <p>
                Vector similarity matches the Greek incident report{' '}
                <Code>DOC_S007_GR</Code> and Greek KPI rows because they contain
                the words <em>“Greece”</em> and <em>“checkout”</em>.
              </p>
              <p className="mt-2">
                It misses the Austrian report (written in German) and the UK
                release note (which talks about deferring an app update rather
                than a conversion drop).
              </p>
            </Card>
            <Card
              title="What Graph + Ontology sees (Connected Records)"
              footer={
                <p className="text-xs text-graph">
                  Result: Connects GR, AT, CZ and explains why UK was spared
                </p>
              }
            >
              <p>
                Starting from <Code>MKT_GR</Code>, Neo4j traverses:
              </p>
              <p className="mt-2 font-mono text-xs text-text-primary">
                INC_S007_GR → PLV_PAYMENTS_3 ← INC_S007_AT / INC_S007_CZ
              </p>
              <p className="mt-2">
                And via <Code>CONCEPT_PLATFORM_INCIDENT</Code> +{' '}
                <Code>APPV_UK_530</Code>, it finds the UK release note showing
                the faulty <Code>PLV_PAYMENTS_3</Code> update was deferred in
                the UK.
              </p>
            </Card>
          </div>

          <GraphDiagram />

          <Table
            head={[
              'Saved chip',
              'What is planted in the database',
              'Why it matters',
            ]}
            rows={[
              [
                'DEMO-01 (Q30)',
                'games.parquet says GAME_UK_01 costs GBP 2.50; expired leaflet DOC_S015_UK says GBP 1.50',
                'Tests whether retrieval prefers authoritative structured records over outdated text',
              ],
              [
                'DEMO-02 (Q25)',
                'Incidents INC_S007_GR, INC_S007_AT, INC_S007_CZ share platform_version_id = PLV_PAYMENTS_3',
                'Tests cross-market root-cause discovery across multilingual records',
              ],
              [
                'DEMO-03 (Q28)',
                'Multiple accounts linked to shared payment instrument tokens in player_payment_method.parquet',
                'Tests 2-hop relationship traversal for fraud/shared-instrument rings',
              ],
              [
                'DEMO-04',
                'Unplanted question (no matching pattern in the world)',
                'Verifies the system reports an honest empty result instead of hallucinating',
              ],
            ]}
          />
        </Section>
      )}

      {tab === 'scores' && (
        <Section
          id="numbers"
          title="Scores, metrics & the honesty rule"
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
        </Section>
      )}

      {tab === 'ops' && (
        <div className="space-y-6">
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
                      'make run-smoke',
                      'Scorer smoke test of bank 2.0.0 on worlds 2026, 2027 and 2028 with the fake model; not a result',
                    ],
                    [
                      'make run-benchmark',
                      'Official run of bank 2.0.0 on the same three worlds, three repeats; writes results.json, summary.json and report.md under data/evaluation/runs',
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
            </Disclosure>
          </Section>

          <Section
            id="reference"
            title="Glossary"
            lead="Core terms used across the interface."
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
                  'Truth ledger',
                  'Evaluator-only record of planted patterns; retrieval can never read it.',
                ],
                [
                  'Provenance',
                  'The source system and record behind every chunk, node and citation.',
                ],
              ]}
            />
          </Section>
        </div>
      )}
    </div>
  )
}
