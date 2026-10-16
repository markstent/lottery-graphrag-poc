/**
 * Help (operator and presenter documentation, served in-app).
 *
 * Content mirrors the committed documentation: docs/demo/presentation.md,
 * docs/07-api-event-spec.md, docs/evaluation/harness-validation.md and
 * RELEASE.md. Numbers quoted here are the committed validation results,
 * never invented for presentation.
 *
 * 2026-10-10 visual pass: all diagrams are layout-driven HTML (cards,
 * step rails, chip groups) rather than positioned SVG, so elements can
 * never overlap; prose trimmed to explanation-first short sections.
 */

import { hrefFor } from '../app/router'
import {
  Callout,
  Card,
  Code,
  CommandBlock,
  PageHero,
  Rail,
  Section,
  Steps,
  Table,
} from '../components/doc'

const NAV_SECTIONS = [
  { id: 'big-picture', label: 'The big picture' },
  { id: 'tour', label: 'A five-minute tour' },
  { id: 'questions', label: 'Saved demo questions' },
  { id: 'numbers', label: 'Reading the numbers' },
  { id: 'data', label: 'Data and provenance' },
  { id: 'backend', label: 'Running the backend' },
  { id: 'troubleshooting', label: 'Troubleshooting' },
  { id: 'reference', label: 'Glossary and accessibility' },
]

function Toc() {
  return (
    <nav
      aria-label="Help sections"
      className="lg:sticky lg:top-6 lg:self-start"
    >
      <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted">
        Reading path
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

/** The experiment in one view: shared head, then what each pipeline adds. */
function PipelineComparison() {
  return (
    <div className="space-y-3">
      <Rail
        items={[
          { label: 'Embed the question' },
          { label: 'Vector search', note: 'one shared index' },
          { label: 'Rerank candidates' },
        ]}
      />
      <p className="text-xs text-muted">
        Every pipeline starts from these same three steps.
      </p>
      <div className="grid gap-3 md:grid-cols-3">
        <Card
          title="A · Conventional RAG"
          footer={
            <p className="text-xs font-medium uppercase tracking-wide text-muted">
              the credible baseline
            </p>
          }
        >
          <p>
            Selects the best document chunks within the token budget and answers
            from them alone.
          </p>
        </Card>
        <Card
          title="B · + Graph"
          footer={
            <p className="text-xs font-medium uppercase tracking-wide text-graph">
              + graph relationships
            </p>
          }
        >
          <Steps
            items={[
              {
                title: 'Resolve seeds',
                children: <p>entities in the question become graph nodes.</p>,
              },
              {
                title: 'Traverse',
                children: <p>a bounded neighbourhood: depth 2, node caps.</p>,
              },
              {
                title: 'Add evidence',
                children: <p>node facts sit alongside document chunks.</p>,
              },
            ]}
          />
        </Card>
        <Card
          title="C · + Ontology"
          footer={
            <p className="text-xs font-medium uppercase tracking-wide text-graph">
              + enterprise ontology
            </p>
          }
        >
          <p>Everything in B, plus one step:</p>
          <Steps
            items={[
              {
                title: 'Expand concepts',
                children: (
                  <p>
                    MAPS_TO pulls equivalent entities across markets, so one
                    country's pattern is found from another's question.
                  </p>
                ),
              },
            ]}
          />
        </Card>
      </div>
    </div>
  )
}

const SCREENS = [
  {
    name: 'Live Lab',
    what: 'Run a question; watch standard RAG and the graph pipeline side by side.',
    accent: true,
  },
  {
    name: 'Evidence Explorer',
    what: 'Click a citation to see the chunk or node behind it, with full provenance.',
  },
  {
    name: 'Results',
    what: 'The published benchmark outcome: per-pipeline scores, efficiency, failures.',
  },
  {
    name: 'Semantic Layer',
    what: 'The ontology: concepts and the cross-market links only pipeline C uses.',
  },
  {
    name: 'Experiment Home',
    what: 'Design, configurations and fairness controls.',
  },
  {
    name: 'Scenario Lab',
    what: 'The planted patterns (SCN-002/003/007/015) and their signals.',
  },
  {
    name: 'Benchmark',
    what: 'The 30-question bank and deterministic scoring.',
  },
] as const

export function Help() {
  return (
    <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
      <Toc />

      <div className="space-y-8">
        <PageHero
          eyebrow="Help"
          title="Your guide to the Semantic Context Lab"
          lead="This app measures what a knowledge graph and an enterprise ontology add to AI retrieval over a synthetic lottery enterprise (UK, GR, AT, CZ). Everything in it is invented, so the demo is safe to show and exact to repeat."
        >
          <div className="grid gap-2 text-sm sm:grid-cols-3">
            <a
              className="rounded-card border border-border bg-surface-raised p-3 transition-colors duration-micro hover:border-graph/50"
              href={hrefFor('lab')}
            >
              <span className="font-medium text-primary">Presenting?</span>
              <span className="text-secondary"> Start with Live Lab.</span>
            </a>
            <a
              className="rounded-card border border-border bg-surface-raised p-3 transition-colors duration-micro hover:border-graph/50"
              href="#/help?section=big-picture"
              onClick={(event) => {
                event.preventDefault()
                document
                  .getElementById('help-big-picture')
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
            >
              <span className="font-medium text-primary">Evaluating?</span>
              <span className="text-secondary"> Read the big picture.</span>
            </a>
            <a
              className="rounded-card border border-border bg-surface-raised p-3 transition-colors duration-micro hover:border-graph/50"
              href="#/help?section=backend"
              onClick={(event) => {
                event.preventDefault()
                document
                  .getElementById('help-backend')
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
            >
              <span className="font-medium text-primary">Operating?</span>
              <span className="text-secondary"> Jump to the commands.</span>
            </a>
          </div>
        </PageHero>

        <Section
          id="big-picture"
          title="The big picture"
          lead="One question, three retrieval pipelines, one fair comparison."
        >
          <p>
            Pipeline A is a strong conventional RAG baseline. Pipeline B adds
            the knowledge graph. Pipeline C adds the enterprise ontology on top.
            All three run in one shared lab: same embedding model, same vector
            collection, same reranker, same generator, same context budgets. B
            is exactly C minus the ontology step, and tests pin that contract,
            so the B-to-C difference isolates the ontology.
          </p>
          <PipelineComparison />
          <p>
            The graph never replaces the data layer: numbers stay in the
            warehouse, documents stay in the vector index, and Neo4j holds
            meaning plus provenance. When an answer needs a quantity, the
            pipeline reads it from the authoritative Parquet records.
          </p>
          <Callout title="Built-in guardrails">
            Traversal is bounded by configuration: depth 2, at most 200 nodes,
            evidence cap 12. Every stage emits a typed event and the UI renders
            only those events; nothing is simulated during playback.
          </Callout>
        </Section>

        <Section
          id="tour"
          title="A five-minute tour"
          lead="Run something, check the proof, read the scoreline."
        >
          <Steps
            items={[
              {
                title: 'Open Live Lab (the default screen)',
                children: (
                  <p>
                    It starts on the committed demo story, which needs no
                    backend.
                  </p>
                ),
              },
              {
                title: 'Press Run and watch both panes',
                children: (
                  <p>
                    They animate from real recorded events; scrub the timeline
                    to replay any moment.
                  </p>
                ),
              },
              {
                title: 'Switch the composer to Live backend',
                children: (
                  <p>
                    Saved questions appear once the API is reachable (
                    <Code>http://localhost:8000</Code>).
                  </p>
                ),
              },
              {
                title: 'Click any citation under an answer',
                children: (
                  <p>The Evidence Explorer opens with its provenance.</p>
                ),
              },
              {
                title: 'Try Presentation mode (top right)',
                children: <p>Stage layout with saved-question chips.</p>,
              },
            ]}
          />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {SCREENS.map((screen) => (
              <Card key={screen.name} title={screen.name}>
                <p>{screen.what}</p>
              </Card>
            ))}
          </div>
        </Section>

        <Section
          id="questions"
          title="Saved demo questions"
          lead="Four fixed questions name real entities in the demo world; expected answers are never embedded anywhere."
        >
          <Table
            head={['Id', 'Asks about', 'Mirrors benchmark']}
            rows={[
              [
                'DEMO-01',
                'SCN-015: a rules document that disagrees with the structured record for GAME_UK_01',
                'Q30',
              ],
              [
                'DEMO-02',
                'SCN-007: which platform version links the Greek checkout incident to other markets, and why the UK was unaffected',
                'Q25',
              ],
              [
                'DEMO-03',
                'SCN-003: accounts sharing payment instruments with PLAYER_GR_001283 (fraud profile)',
                'Q28',
              ],
              [
                'DEMO-04',
                'A question whose home scenario is not planted in this world',
                'none',
              ],
            ]}
          />
          <Callout title="One question is designed to miss">
            DEMO-04 shows an honest miss: the system reports it cannot find the
            pattern rather than inventing one. In front of an audience, this is
            the trust moment.
          </Callout>
        </Section>

        <Section
          id="numbers"
          title="Reading the numbers"
          lead="Which numbers are measured live, and which come from the published benchmark."
        >
          <Table
            head={['Metric', 'Source', 'Where you see it']}
            rows={[
              [
                'Latency, context tokens',
                'measured on the live run',
                'Live Lab score strip; Results efficiency',
              ],
              [
                'Answer correctness',
                'deterministic scoring against grounded truth (harness only)',
                'Results; score strip for published questions',
              ],
              [
                'Evidence recall / precision',
                'overlap of retrieved evidence with truth-ledger evidence (harness only)',
                'Results; score strip for published questions',
              ],
            ]}
          />
          <Callout title="The honesty rule">
            Quality numbers come only from the published benchmark for a matched
            question. Ad-hoc questions have no truth to score against, so the
            quality columns stay in their waiting state; operational
            measurements (latency, tokens) are always real.
          </Callout>
          <Callout title="Committed headline results">
            Dev world, bank 1.0.0: full-bank evidence recall{' '}
            <strong>A 0.02 vs B/C 0.62</strong> (deterministic generator); on
            the real-model subset (Q01, Q25, Q28, Q30) answer score{' '}
            <strong>B/C 0.66 vs A 0.41</strong>, evidence recall{' '}
            <strong>0.65 vs 0.04</strong>. Published, reproducible runs.
          </Callout>
        </Section>

        <Section
          id="data"
          title="Data and provenance"
          lead="One synthetic world, planted patterns, citations that resolve to records."
        >
          <p>
            The demo world (<Code>data/generated/demo-seed2026</Code>, generator
            0.1.0, world and scenario seed 2026) holds 5,000,000 tickets,
            100,000 players and 2,000 documents across four markets. Generation
            is deterministic: identical inputs reproduce identical outputs.
            Planted patterns come from the scenario engine only; the truth
            ledger is evaluator-only and isolation tests fail the build if
            retrieval ever reads it.
          </p>
          <Rail
            items={[
              { label: 'Answer' },
              { label: 'Citation' },
              { label: 'Chunk or graph node' },
              { label: 'Source record' },
              { label: 'Warehouse row' },
            ]}
          />
          <p>
            Clicking a citation walks this chain in the Evidence Explorer. The{' '}
            <a
              className="text-graph hover:underline"
              href={hrefFor('dictionary')}
            >
              Data Dictionary
            </a>{' '}
            documents every table, node label, relationship and concept.
          </p>
        </Section>

        <Section
          id="backend"
          title="Running the backend"
          lead="From the repository root."
        >
          <CommandBlock
            lines={[
              'make services-up        # Neo4j + Qdrant (Docker/OrbStack)',
              'make demo-reset         # re-ingest demo graph + rebuild demo vector index',
              'make serve-demo-api     # API on :8000 against the demo world',
              'make dev-frontend       # UI on :5173',
            ]}
          />
          <p>
            Without extra settings the API uses the deterministic fake
            generator: instant and safe for a live demo. For local-model
            answers:
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
                'regenerates the demo dataset and its truth ledger (~100s)',
              ],
              [
                'make run-benchmark',
                'runs the 30-question harness; writes results.json, summary.json, report.md',
              ],
              [
                'make ingest-graph && make index-vector',
                'returns Neo4j/Qdrant to the dev world (demo and dev never overwrite each other)',
              ],
            ]}
          />
        </Section>

        <Section
          id="troubleshooting"
          title="Troubleshooting"
          lead="Common symptoms and recovery."
        >
          <Table
            head={['Symptom', 'Recovery']}
            rows={[
              [
                '“Saved questions unavailable” in Live Lab',
                'start make serve-demo-api; check http://localhost:8000/api/v1/health',
              ],
              [
                'Backend run fails with MODEL_ERROR',
                'restart the model server, or switch to the Demo story; the failure is recorded, never faked',
              ],
              [
                'A run returns no graph seeds',
                'the question names no graph entity; use a saved demo question',
              ],
              [
                'Graph looks wrong after tests ran',
                'a GRAPH_E2E test wiped Neo4j into its fixture world; run make demo-reset (~2.5 min)',
              ],
              [
                'Answers too slow on stage',
                'use the deterministic generator for the live demo',
              ],
            ]}
          />
          <p>
            Failed runs record a typed error: <Code>MODEL_ERROR</Code>,{' '}
            <Code>EMBEDDING_ERROR</Code>, <Code>VECTOR_RETRIEVAL_ERROR</Code>,{' '}
            <Code>RUN_ERROR</Code> (docs/07 section 11). The UI never presents a
            fake success.
          </p>
        </Section>

        <Section
          id="reference"
          title="Glossary and accessibility"
          lead="The words this app uses, and the access guarantees."
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
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Full keyboard navigation; visible focus; skip-to-content link.
            </li>
            <li>
              Reduced motion respected (Settings or system preference);
              animation pauses, state stays readable.
            </li>
            <li>
              Status never conveyed by colour alone; tables and panes are
              labelled.
            </li>
          </ul>
        </Section>

        <p className="text-xs text-muted">
          Deeper documentation: <Code>docs/demo/presentation.md</Code>,{' '}
          <Code>docs/07-api-event-spec.md</Code>,{' '}
          <Code>docs/evaluation/harness-validation.md</Code>,{' '}
          <Code>RELEASE.md</Code>. Related screens:{' '}
          <a
            className="text-graph hover:underline"
            href={hrefFor('dictionary')}
          >
            Data Dictionary
          </a>
          ,{' '}
          <a
            className="text-graph hover:underline"
            href={hrefFor('experiment')}
          >
            Experiment Home
          </a>
          ,{' '}
          <a className="text-graph hover:underline" href={hrefFor('results')}>
            Results
          </a>
          ,{' '}
          <a className="text-graph hover:underline" href={hrefFor('semantic')}>
            Semantic Layer
          </a>
          .
        </p>
      </div>
    </div>
  )
}
