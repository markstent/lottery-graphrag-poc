/**
 * Help (operator and presenter documentation, served in-app).
 *
 * Content mirrors the committed documentation: docs/demo/presentation.md,
 * docs/07-api-event-spec.md, docs/evaluation/harness-validation.md and
 * RELEASE.md. Numbers quoted here are the committed validation results,
 * never invented for presentation.
 */

import { hrefFor } from '../app/router'

const NAV_SECTIONS = [
  { id: 'what', label: 'What this application is' },
  { id: 'quickstart', label: 'Quick start' },
  { id: 'screens', label: 'Screen-by-screen guide' },
  { id: 'run', label: 'What happens during a run' },
  { id: 'questions', label: 'Saved demo questions' },
  { id: 'metrics', label: 'Metrics and how to read them' },
  { id: 'data', label: 'Data, scenarios and provenance' },
  { id: 'operator', label: 'Running the backend' },
  { id: 'troubleshooting', label: 'Troubleshooting' },
  { id: 'glossary', label: 'Glossary' },
  { id: 'accessibility', label: 'Accessibility' },
]

function Section({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section aria-labelledby={`help-${id}`} className="scroll-mt-28">
      <h2 id={`help-${id}`} className="text-lg font-semibold">
        {title}
      </h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-secondary">
        {children}
      </div>
    </section>
  )
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted">
            {head.map((cell) => (
              <th key={cell} scope="col" className="pb-1 pr-4 font-normal">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row[0]} className="border-t border-border align-top">
              {row.map((cell, index) => (
                <td
                  key={index}
                  className={
                    index === 0 ? 'py-1.5 pr-4 text-primary' : 'py-1.5 pr-4'
                  }
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Code({ children }: { children: string }) {
  return (
    <code className="rounded-chip bg-surface-raised px-1.5 py-0.5 font-mono text-xs text-primary">
      {children}
    </code>
  )
}

function CommandBlock({ lines }: { lines: string[] }) {
  return (
    <pre className="overflow-x-auto rounded-card border border-border bg-surface p-3 font-mono text-xs text-primary">
      {lines.join('\n')}
    </pre>
  )
}

export function Help() {
  return (
    <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
      <nav
        aria-label="Help sections"
        className="lg:sticky lg:top-6 lg:self-start"
      >
        <ul className="space-y-1 text-sm">
          {NAV_SECTIONS.map((section) => (
            <li key={section.id}>
              <a
                href={`#/help?section=${section.id}`}
                onClick={(event) => {
                  event.preventDefault()
                  document
                    .getElementById(`help-${section.id}`)
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }}
                className="block rounded-chip px-3 py-1 text-secondary transition-colors duration-micro hover:bg-surface-raised hover:text-primary"
              >
                {section.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="space-y-8">
        <header>
          <h1 className="text-xl font-semibold">Help</h1>
          <p className="mt-1 text-sm text-muted">
            Semantic Context Lab v0.1.0-rc1 · everything below reflects the
            committed state of the repository; nothing on this page is
            mock-up-only.
          </p>
        </header>

        <Section id="what" title="What this application is">
          <p>
            This is an experimental application that measures the incremental
            value of adding a knowledge graph and an enterprise ontology{' '}
            <em>above</em> an existing synthetic enterprise data layer. The
            synthetic organisation is a multinational lottery operator active in
            the United Kingdom, Greece, Austria and the Czech Republic. Every
            player, account, device, ticket, incident, document and system in it
            is synthetic.
          </p>
          <p>
            The core thesis:{' '}
            <strong>
              the graph does not replace the data layer; it makes relationships
              and enterprise meaning available to AI.
            </strong>{' '}
            Authoritative numbers stay in the structured warehouse layer,
            documents stay in the vector layer, and the Neo4j overlay stores
            semantic entities, relationships, ontology mappings and provenance,
            each node referencing its source record.
          </p>
          <p>
            Three retrieval configurations are compared under strict fairness:
          </p>
          <Table
            head={['Pipeline', 'Retrieves with', 'Added layer']}
            rows={[
              [
                'A · Current Approach',
                'embeddings + vector search + rerank only',
                'none (credible conventional RAG baseline)',
              ],
              [
                'B · + Graph',
                'A plus resolved graph seeds and bounded traversal',
                'graph relationships',
              ],
              [
                'C · + Graph & Ontology',
                'B plus ontology concept traversal (MAPS_TO, concept seeds)',
                'enterprise ontology',
              ],
            ]}
          />
          <p>
            Fairness is structural: all three pipelines share one lab (same
            embedding model, same vector collection, same reranker, same
            generator, same context budgets). B is exactly C minus the ontology
            traversal, a contract pinned by automated tests, so any measured
            B-to-C difference isolates the ontology layer.
          </p>
        </Section>

        <Section id="quickstart" title="Quick start">
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              Open <strong>Live Lab</strong> (the default screen). It starts on
              the committed demo story, which needs no backend.
            </li>
            <li>
              Press <strong>Run</strong> and watch both panes animate from real
              telemetry; drag or click the timeline to rewind and replay any
              moment.
            </li>
            <li>
              To execute real pipelines, switch the composer toggle to{' '}
              <strong>Live backend</strong>. Saved questions appear when the API
              is reachable (<Code>http://localhost:8000</Code>).
            </li>
            <li>
              Click any citation under an answer to inspect it in the{' '}
              <strong>Evidence Explorer</strong>; open <strong>Results</strong>{' '}
              for the published benchmark outcome.
            </li>
            <li>
              Toggle <strong>Presentation mode</strong> (top right) for the
              stage layout with saved-question chips.
            </li>
          </ol>
        </Section>

        <Section id="screens" title="Screen-by-screen guide">
          <Table
            head={['Screen', 'What it shows', 'How to use it']}
            rows={[
              [
                'Live Lab',
                'Side-by-side retrieval: standard RAG (left) and graph-enhanced (right), driven by the same question.',
                'Type a question or pick a saved chip, press Run. Use the timeline to scrub; each pane renders only received events.',
              ],
              [
                'Experiment Home',
                'The experiment design: configurations, fairness controls, markets and dataset scale.',
                'Read-only orientation; use it to explain the experiment to an audience.',
              ],
              [
                'Scenario Lab',
                'The planted scenario library (SCN-002, SCN-003, SCN-007, SCN-015) with observable signals.',
                'Read-only; each scenario lists which planted rows and signals exist in the world.',
              ],
              [
                'Evidence Explorer',
                'Full provenance for one piece of evidence: document chunk text, source system, market, validity window, or the graph node with its ranking components.',
                'Reach it by clicking a citation in an answer, or deep-link from Results failure rows.',
              ],
              [
                'Benchmark',
                'The evaluation harness: 30 questions, deterministic scoring, failure taxonomy.',
                'Shows how questions are grounded and scored; official runs execute via the CLI, not the browser.',
              ],
              [
                'Results',
                'The published benchmark outcome: per-pipeline means, per-category breakdowns, efficiency, failures.',
                'Data comes from the harness’s own summary; without a published run it shows the committed validation run and labels it.',
              ],
              [
                'Semantic Layer',
                'The enterprise ontology: business concepts, their bound entities and cross-market equivalences.',
                'Read-only; use it to explain what pipeline C adds over B.',
              ],
            ]}
          />
        </Section>

        <Section id="run" title="What happens during a run">
          <p>
            Every stage of every pipeline emits a typed event; the UI renders
            only those events. Nothing is simulated during playback.
          </p>
          <h3 className="text-sm font-semibold text-primary">
            Standard RAG (left pane, pipeline A)
          </h3>
          <Table
            head={['Stage', 'Meaning']}
            rows={[
              [
                'Embedding',
                'The question is embedded (bge-m3 in live worlds; deterministic hashing in CI).',
              ],
              [
                'Vector search',
                'Top-k candidate chunks come from one shared Qdrant collection.',
              ],
              [
                'Rerank',
                'Candidates are re-scored and reordered before selection.',
              ],
              [
                'Context',
                'Chunks are selected/deduplicated within the token budget; discards are visible.',
              ],
              [
                'Generation',
                'The answer is produced with citations derived from the selected context.',
              ],
            ]}
          />
          <h3 className="text-sm font-semibold text-primary">
            Graph pipelines (right pane, B and C)
          </h3>
          <Table
            head={['Stage', 'Meaning']}
            rows={[
              [
                'Entity resolution',
                'Question text is matched to graph entities; matches become seeds.',
              ],
              [
                'Ontology expansion (C only)',
                'Mentioned concepts pull in bound entities across markets via MAPS_TO.',
              ],
              [
                'Traversal',
                'Bounded expansion from seeds: depth 2, caps per hop/total, evidence cap.',
              ],
              [
                'Candidate ranking',
                'Discovered nodes are scored; discarded nodes keep their reject reason.',
              ],
              [
                'Structured records',
                'Authoritative facts are read from the warehouse Parquet layer; the graph guides, Parquet states.',
              ],
              [
                'Context assembly',
                'Document chunks plus node evidence within the same budget as pipeline A.',
              ],
            ]}
          />
          <p>
            Traversal never runs unbounded: depth, per-hop nodes, per-type edges
            and total nodes are configuration limits (<Code>GRAPH_DEPTH=2</Code>
            , <Code>GRAPH_MAX_TOTAL_NODES=200</Code>, evidence cap 12 by
            default).
          </p>
        </Section>

        <Section id="questions" title="Saved demo questions">
          <p>
            Four saved questions form the fixed demo configuration. Their texts
            name real entities in the demo world; expected answers are never
            embedded anywhere.
          </p>
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
                'SCN-007: which platform version connects the Greek checkout incident to other markets, and why the UK was unaffected',
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
                'none (honest empty result expected)',
              ],
            ]}
          />
          <p>
            DEMO-04 exists to show what an honest miss looks like: the system
            reports that it cannot find the pattern rather than inventing one.
          </p>
        </Section>

        <Section id="metrics" title="Metrics and how to read them">
          <Table
            head={['Metric', 'Where it comes from', 'When you see it']}
            rows={[
              [
                'Answer correctness',
                'Deterministic checks against grounded truth (benchmark harness only)',
                'Results Dashboard, published runs',
              ],
              [
                'Evidence recall / precision',
                'Overlap of retrieved evidence with truth-ledger evidence (harness only)',
                'Results Dashboard, published runs',
              ],
              [
                'Latency, context tokens',
                'Measured per live run',
                'Live Lab score strip and Results efficiency table',
              ],
              [
                'Live score strip',
                'Quality columns come only from the published benchmark for the matched question; operational columns are the real run',
                'After a Live backend run of a saved question with a published result',
              ],
            ]}
          />
          <p>
            The live score strip never fabricates quality numbers. Ad-hoc
            questions have no truth to score against, so the strip stays in its
            waiting state and only real operational measurements are reported.
            Committed headline results (dev world, bank 1.0.0): full-bank
            evidence recall A 0.02 vs B/C 0.62 with the deterministic generator;
            on the real-model subset (Q01, Q25, Q28, Q30) answer score B/C 0.66
            vs A 0.41 and evidence recall 0.65 vs 0.04.
          </p>
        </Section>

        <Section id="data" title="Data, scenarios and provenance">
          <p>
            The demo world (<Code>data/generated/demo-seed2026</Code>) was
            produced by generator 0.1.0 with world seed 2026 and scenario seed
            2026: 5,000,000 tickets, 100,000 players, 100,000 accounts, 120,000
            devices, 2,000 documents across four markets. Generation is
            deterministic: identical inputs reproduce identical outputs.
          </p>
          <p>
            All planted patterns come from the scenario engine; nothing is
            hand-patched into benchmark data. The evaluator-only truth ledger (
            <Code>data/truth/ledger-demo.json</Code>) is readable by the
            evaluation package alone; automated isolation tests fail the build
            if retrieval, the API or the datasets code ever tries to read it.
          </p>
          <p>
            Every citation resolves to a source system and record. Graph nodes
            carry provenance to warehouse rows, so a numerical claim can be
            traced from the answer through the graph to the authoritative table.
          </p>
        </Section>

        <Section id="operator" title="Running the backend">
          <p>Services and state (from the repository root):</p>
          <CommandBlock
            lines={[
              'make services-up        # Neo4j + Qdrant (Docker/OrbStack)',
              'make demo-reset         # re-ingest demo graph + rebuild demo vector index',
              'make serve-demo-api     # API on :8000 against the demo world',
              'make dev-frontend       # UI on :5173',
            ]}
          />
          <p>
            The API reads its world and models from configuration. Without extra
            settings it uses the deterministic fake generator. For local-model
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
          <p>Other useful commands:</p>
          <Table
            head={['Command', 'Effect']}
            rows={[
              [
                'make generate-demo-data',
                'Regenerates the demo dataset and its separate truth ledger (~100s).',
              ],
              [
                'make run-benchmark',
                'Runs the 30-question harness and writes results.json, summary.json, report.md.',
              ],
              [
                'make test / lint / typecheck',
                'Backend and frontend unit tests, linters, type checks.',
              ],
              [
                'make ingest-graph && make index-vector',
                'Returns Neo4j/Qdrant to the development world (demo and dev never overwrite each other).',
              ],
            ]}
          />
        </Section>

        <Section id="troubleshooting" title="Troubleshooting">
          <Table
            head={['Symptom', 'Cause', 'Recovery']}
            rows={[
              [
                '“Saved questions unavailable” in Live Lab',
                'API not running or serving a different world',
                'Start make serve-demo-api; check http://localhost:8000/api/v1/health',
              ],
              [
                'Backend run fails with MODEL_ERROR',
                'Model gateway or model server down',
                'Switch back to Demo story, or restart the model server; the failure is recorded, nothing fake is shown',
              ],
              [
                'A run returns no graph seeds',
                'The question names no graph-resolvable entity',
                'Use a saved demo question (they name real ids)',
              ],
              [
                'Graph looks wrong after tests ran',
                'A GRAPH_E2E test wiped Neo4j into its tiny fixture world',
                'make demo-reset (about 2.5 minutes)',
              ],
              [
                'Answers too slow on stage',
                '35B local model latency',
                'Use the default deterministic generator for the live demo',
              ],
            ]}
          />
          <p>
            Typed API error codes seen in failed runs: <Code>MODEL_ERROR</Code>,{' '}
            <Code>EMBEDDING_ERROR</Code>, <Code>VECTOR_RETRIEVAL_ERROR</Code>,{' '}
            <Code>RUN_ERROR</Code> (docs/07 section 11). Failed runs are
            recorded as failures; the UI never presents a fake success.
          </p>
        </Section>

        <Section id="glossary" title="Glossary">
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
                'Grounding',
                'Binding a benchmark question’s phrasing to concrete world ids deterministically.',
              ],
              [
                'Not planted',
                'A question whose home scenario does not exist in the current world; reported, never scored.',
              ],
              [
                'Truth ledger',
                'Evaluator-only record of planted patterns and expected signals; retrieval can never read it.',
              ],
              [
                'Provenance',
                'The source system and record behind every chunk, node and citation.',
              ],
              [
                'Demo story',
                'The committed offline-safe event stream replayed by the Live Lab by default.',
              ],
            ]}
          />
        </Section>

        <Section id="accessibility" title="Accessibility">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Full keyboard navigation; visible focus states; skip-to-content
              link.
            </li>
            <li>
              Reduced motion is respected: enable it in Settings or via the
              system preference; animation is paused and state changes remain
              readable.
            </li>
            <li>
              Status is never conveyed by colour alone; every pane and the
              timeline have textual alternatives and ARIA labels.
            </li>
            <li>Tables have captions; headings are hierarchical.</li>
          </ul>
        </Section>

        <p className="text-xs text-muted">
          Deeper documentation lives in the repository:{' '}
          <Code>docs/demo/presentation.md</Code> (run of show and recovery),{' '}
          <Code>docs/07-api-event-spec.md</Code> (API contract),{' '}
          <Code>docs/evaluation/harness-validation.md</Code> (validation runs),{' '}
          <Code>RELEASE.md</Code> (release record). Related screens:{' '}
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
