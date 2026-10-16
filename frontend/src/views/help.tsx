/**
 * Help (operator and presenter documentation, served in-app).
 *
 * Content mirrors the committed documentation: docs/demo/presentation.md,
 * docs/07-api-event-spec.md, docs/evaluation/harness-validation.md and
 * RELEASE.md. Numbers quoted here are the committed validation results,
 * never invented for presentation.
 *
 * Structure (2026-10-10 redesign): hero with audience paths, the big
 * picture with a pipeline comparison diagram, a guided reading path,
 * then reference sections. Diagrams are inline SVG with text
 * alternatives; see components/diagram.tsx.
 */

import { hrefFor } from '../app/router'
import {
  Callout,
  Card,
  Code,
  CommandBlock,
  PageHero,
  Section,
  Steps,
  Table,
} from '../components/doc'
import { Arrow, Box, Diagram } from '../components/diagram'

const NAV_SECTIONS = [
  { id: 'big-picture', label: 'The big picture' },
  { id: 'journey', label: 'Your path through the app' },
  { id: 'quickstart', label: 'Quick start' },
  { id: 'run', label: 'What happens during a run' },
  { id: 'questions', label: 'Saved demo questions' },
  { id: 'metrics', label: 'Reading the numbers' },
  { id: 'data', label: 'Data, scenarios and provenance' },
  { id: 'operator', label: 'Running the backend' },
  { id: 'troubleshooting', label: 'Troubleshooting' },
  { id: 'glossary', label: 'Glossary' },
  { id: 'accessibility', label: 'Accessibility' },
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

/** The one diagram that explains the whole experiment. */
function PipelineComparisonDiagram() {
  const laneA = 40
  const laneB = 150
  const laneC = 260
  const boxH = 44
  return (
    <Diagram
      title="How the three pipelines differ"
      description="Three horizontal lanes share the same beginning: a question is embedded and searched against the same vector index, then reranked and turned into an answer. Pipeline A stops there. Pipeline B additionally resolves question text to graph entities and traverses a bounded neighbourhood, adding node evidence to the context. Pipeline C additionally expands through ontology concepts, pulling in equivalent entities across markets. The graph never replaces the warehouse: structured facts are read from Parquet at the end."
      height={340}
    >
      {/* Shared head of the funnel */}
      <Box
        x={250}
        y={8}
        w={260}
        h={40}
        title="Question"
        lines={['typed or picked from saved chips']}
      />
      <Arrow x1={380} y1={50} x2={380} y2={68} />
      <Box
        x={250}
        y={70}
        w={260}
        h={40}
        title="Embed + vector search + rerank"
        lines={['one shared index and embedder for A, B and C']}
      />

      {/* Lane A */}
      <text
        x={30}
        y={laneA + 28}
        fill="var(--color-text-muted)"
        fontSize={11}
        fontWeight={600}
      >
        A
      </text>
      <Arrow x1={380} y1={112} x2={380} y2={laneA - 4} />
      <Box
        x={250}
        y={laneA}
        w={260}
        h={boxH}
        title="Select context chunks"
        lines={['token budget · discarded chunks kept visible']}
      />
      <Arrow x1={512} y1={laneA + 22} x2={560} y2={laneA + 22} />
      <Box
        x={562}
        y={laneA}
        w={170}
        h={boxH}
        title="Answer + citations"
        lines={['documents only']}
      />

      {/* Lane B */}
      <text
        x={30}
        y={laneB + 28}
        fill="var(--color-text-secondary)"
        fontSize={11}
        fontWeight={600}
      >
        B
      </text>
      <Arrow
        x1={300}
        y1={112}
        x2={135}
        y2={148}
        label="entities in the question"
      />
      <Box
        x={60}
        y={laneB}
        w={150}
        h={boxH}
        title="Graph seeds"
        lines={['resolved entities']}
        accent
      />
      <Arrow
        x1={212}
        y1={laneB + 22}
        x2={248}
        y2={laneB + 22}
        label="traverse"
      />
      <Box
        x={250}
        y={laneB}
        w={150}
        h={boxH}
        title="Bounded traversal"
        lines={['depth 2 · node caps']}
        accent
      />
      <Arrow
        x1={402}
        y1={laneB + 22}
        x2={470}
        y2={laneB + 22}
        label="node evidence"
      />
      <Box
        x={472}
        y={laneB}
        w={120}
        h={boxH}
        title="Context"
        lines={['chunks + nodes']}
      />
      <Arrow x1={594} y1={laneB + 16} x2={640} y2={laneA + 48} />

      {/* Lane C */}
      <text
        x={30}
        y={laneC + 28}
        fill="var(--color-text-primary)"
        fontSize={11}
        fontWeight={600}
      >
        C
      </text>
      <Arrow x1={135} y1={laneB + 46} x2={135} y2={laneC - 2} label="MAPS_TO" />
      <Box
        x={60}
        y={laneC}
        w={150}
        h={boxH}
        title="Ontology expansion"
        lines={['concepts pull equivalents']}
        accent
      />
      <Arrow x1={212} y1={laneC + 22} x2={248} y2={laneC + 22} />
      <Box
        x={250}
        y={laneC}
        w={150}
        h={boxH}
        title="Bounded traversal"
        lines={['same caps as B']}
        accent
      />
      <Arrow
        x1={402}
        y1={laneC + 22}
        x2={470}
        y2={laneC + 22}
        label="node evidence"
      />
      <Box
        x={472}
        y={laneC}
        w={120}
        h={boxH}
        title="Context"
        lines={['chunks + nodes']}
      />
      <Arrow x1={594} y1={laneC + 16} x2={680} y2={laneA + 48} />

      {/* Authoritative records footnote */}
      <Box
        x={250}
        y={laneC + 66}
        w={370}
        h={40}
        title="Authoritative facts from the warehouse"
        lines={['the graph guides the query; Parquet states the numbers']}
      />
      <Arrow x1={330} y1={laneC + 46} x2={330} y2={laneC + 64} dashed />
      <Arrow x1={530} y1={laneC + 46} x2={530} y2={laneC + 64} dashed />
    </Diagram>
  )
}

function JourneyDiagram() {
  const y = 20
  const w = 128
  const h = 74
  const gap = 22
  const x = (index: number) => 16 + index * (w + gap)
  const screens: { title: string; lines: string[]; accent?: boolean }[] = [
    {
      title: 'Live Lab',
      lines: ['run a question', 'watch retrieval'],
      accent: true,
    },
    { title: 'Evidence', lines: ['inspect any', 'citation'] },
    { title: 'Results', lines: ['published', 'benchmark'] },
    { title: 'Semantic', lines: ['what C adds', 'over B'] },
    { title: 'Experiment', lines: ['design +', 'fairness'] },
    { title: 'Scenarios', lines: ['planted', 'patterns'] },
    { title: 'Benchmark', lines: ['questions', '+ scoring'] },
  ]
  return (
    <Diagram
      title="Suggested path through the seven screens"
      description="Seven screen cards left to right: Live Lab, Evidence Explorer, Results, Semantic Layer, Experiment Home, Scenario Lab, Benchmark. Arrows lead from one to the next. Live Lab is accented as the starting point."
      height={130}
    >
      {screens.map((screen, index) => (
        <g key={screen.title}>
          <Box
            x={x(index)}
            y={y}
            w={w}
            h={h}
            title={screen.title}
            lines={screen.lines}
            accent={screen.accent}
          />
          {index < screens.length - 1 && (
            <Arrow
              x1={x(index) + w + 2}
              y1={y + h / 2}
              x2={x(index + 1) - 4}
              y2={y + h / 2}
            />
          )}
        </g>
      ))}
      <text x={16} y={y + h + 22} fill="var(--color-text-muted)" fontSize={10}>
        Follow it left to right: run something, check the proof, see the
        scoreline, then go deeper.
      </text>
    </Diagram>
  )
}

function RunLifecycleDiagram() {
  return (
    <Diagram
      title="Life of a run"
      description="Four stages: Submit (question enters the composer), Running (typed events stream into both panes as they happen), Completed (answer with citations plus a score strip), Replay (the timeline can rewind and scrub the recorded events). A failed run records the typed error and shows an honest failure state instead of an answer."
      height={120}
    >
      <Box
        x={20}
        y={20}
        w={150}
        h={56}
        title="1 · Submit"
        lines={['question + pipeline toggle']}
      />
      <Arrow x1={172} y1={48} x2={198} y2={48} />
      <Box
        x={200}
        y={20}
        w={170}
        h={56}
        title="2 · Running"
        lines={['events stream live']}
        accent
      />
      <Arrow x1={372} y1={48} x2={398} y2={48} />
      <Box
        x={400}
        y={20}
        w={170}
        h={56}
        title="3 · Completed"
        lines={['answer + citations + strip']}
      />
      <Arrow x1={572} y1={48} x2={598} y2={48} />
      <Box
        x={600}
        y={20}
        w={140}
        h={56}
        title="4 · Replay"
        lines={['scrub the timeline']}
      />
      <text x={200} y={100} fill="var(--color-text-muted)" fontSize={10}>
        Failures are recorded too: a typed error state replaces the answer,
        never a fake success.
      </text>
    </Diagram>
  )
}

function ScoreStripDiagram() {
  return (
    <Diagram
      title="Where the score strip's numbers come from"
      description="Two sources feed the score strip after a live run. From the run itself: latency and context tokens, always real. From the published benchmark: answer correctness and evidence recall, shown only when the question matches a published question. If there is no published result for the question, the quality columns keep their waiting state rather than inventing numbers."
      height={150}
    >
      <Box
        x={30}
        y={20}
        w={200}
        h={64}
        title="This run (always real)"
        lines={['latency', 'context tokens']}
      />
      <Box
        x={30}
        y={100}
        w={200}
        h={40}
        title="No published result?"
        lines={['quality stays in waiting state']}
      />
      <Arrow x1={232} y1={52} x2={290} y2={62} />
      <Arrow x1={232} y1={120} x2={290} y2={92} dashed />
      <Box
        x={292}
        y={30}
        w={190}
        h={64}
        title="Score strip"
        lines={['quality columns', 'operational columns']}
        accent
      />
      <Arrow x1={484} y1={62} x2={540} y2={52} />
      <Box
        x={542}
        y={20}
        w={200}
        h={64}
        title="Published benchmark"
        lines={['answer correctness', 'evidence recall']}
      />
    </Diagram>
  )
}

function ProvenanceDiagram() {
  return (
    <Diagram
      title="Every claim traces back to a source record"
      description="Provenance chain: the answer carries a citation; the citation opens a document chunk or a graph node; the chunk or node names its source system and source record; the source record is a row in the warehouse. Clicking a citation in any answer walks this chain in the Evidence Explorer."
      height={110}
    >
      <Box
        x={20}
        y={24}
        w={140}
        h={52}
        title="Answer"
        lines={['citation chip']}
        accent
      />
      <Arrow x1={162} y1={50} x2={190} y2={50} />
      <Box
        x={192}
        y={24}
        w={170}
        h={52}
        title="Chunk or graph node"
        lines={['what retrieval used']}
      />
      <Arrow x1={364} y1={50} x2={392} y2={50} />
      <Box
        x={394}
        y={24}
        w={180}
        h={52}
        title="Source system + record id"
        lines={['provenance fields']}
      />
      <Arrow x1={576} y1={50} x2={604} y2={50} />
      <Box
        x={606}
        y={24}
        w={134}
        h={52}
        title="Warehouse row"
        lines={['authoritative']}
      />
    </Diagram>
  )
}

export function Help() {
  return (
    <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
      <Toc />

      <div className="space-y-8">
        <PageHero
          eyebrow="Help"
          title="Your guide to the Semantic Context Lab"
          lead="This application measures what a knowledge graph and an enterprise ontology add to an AI system that answers questions over an enterprise. Everything runs on a synthetic multinational lottery operator (UK, Greece, Austria, Czech Republic): every player, ticket, incident and document is invented, so the experiment is safe to show and exact to repeat."
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <Card title="I'm presenting the demo">
              <p>
                Start with{' '}
                <a className="text-graph hover:underline" href={hrefFor('lab')}>
                  Live Lab
                </a>{' '}
                and the saved demo story, then sections 4, 5 and 9 here.
              </p>
            </Card>
            <Card title="I want to understand the experiment">
              <p>
                Read the big picture below, then{' '}
                <a
                  className="text-graph hover:underline"
                  href={hrefFor('results')}
                >
                  Results
                </a>{' '}
                and{' '}
                <a
                  className="text-graph hover:underline"
                  href={hrefFor('experiment')}
                >
                  Experiment Home
                </a>
                .
              </p>
            </Card>
            <Card title="I run the backend">
              <p>
                Jump to{' '}
                <a
                  className="text-graph hover:underline"
                  href="#/help?section=operator"
                >
                  Running the backend
                </a>{' '}
                and{' '}
                <a
                  className="text-graph hover:underline"
                  href="#/help?section=troubleshooting"
                >
                  Troubleshooting
                </a>
                .
              </p>
            </Card>
          </div>
        </PageHero>

        <Section
          id="big-picture"
          title="The big picture"
          lead="One question, three ways to retrieve evidence, one fair comparison."
        >
          <p>
            A conventional RAG system reads a question, finds similar document
            chunks, and answers from them. That is pipeline <strong>A</strong>,
            and it is kept genuinely strong: same embedder, reranker and budgets
            as everything else. Pipeline <strong>B</strong> adds the knowledge
            graph: it recognises entities in the question and walks a bounded
            neighbourhood around them. Pipeline <strong>C</strong> adds the
            enterprise ontology on top: concepts connect equivalent things
            across markets, so a question about one country can find the pattern
            in another.
          </p>
          <PipelineComparisonDiagram />
          <Callout title="Why this is a fair comparison">
            All three pipelines run in one shared lab: same embedding model,
            same vector collection, same reranker, same generator, same context
            budgets. B is exactly C minus the ontology traversal, and automated
            tests pin that contract. Any measured difference between B and C is
            the ontology layer, nothing else.
          </Callout>
          <p>
            The graph does not replace the data layer. Numbers stay in the
            warehouse, documents stay in the vector index, and Neo4j holds
            meaning: entities, relationships, ontology mappings and provenance.
            When an answer needs a quantity, the pipeline reads it from the
            authoritative Parquet records, never from the graph.
          </p>
        </Section>

        <Section
          id="journey"
          title="Your path through the app"
          lead="Seven screens tell one story: watch it work, trust it, then see the scoreline."
        >
          <JourneyDiagram />
          <div className="grid gap-3 md:grid-cols-2">
            <Card title="Live Lab — start here">
              <p>
                Standard RAG on the left, graph-enhanced on the right, same
                question. Run the committed demo story or switch to the live
                backend and execute real pipelines. Every pane animates from
                recorded telemetry, and the timeline replays any moment.
              </p>
            </Card>
            <Card title="Evidence Explorer — trust it">
              <p>
                Click any citation to see the full provenance: chunk text,
                source system, market, validity window, or the graph node with
                its ranking components and reject reasons.
              </p>
            </Card>
            <Card title="Results — the scoreline">
              <p>
                The published benchmark outcome: per-pipeline means, category
                breakdowns, efficiency and failures, from the harness's own
                summary. Without a published run it shows the committed
                validation run, labelled as such.
              </p>
            </Card>
            <Card title="Semantic Layer — what C adds">
              <p>
                The enterprise ontology: ten business concepts, the entities
                bound to them, and the cross-market equivalences that pipeline C
                traverses and B does not.
              </p>
            </Card>
            <Card title="Experiment Home — the design">
              <p>
                Configurations, fairness controls, markets and dataset scale.
                Use it to explain the experiment design to an audience.
              </p>
            </Card>
            <Card title="Scenario Lab + Benchmark — the machinery">
              <p>
                Scenario Lab lists the planted patterns (SCN-002, SCN-003,
                SCN-007, SCN-015) and their observable signals. Benchmark shows
                the 30-question bank and how deterministic scoring works.
              </p>
            </Card>
          </div>
        </Section>

        <Section
          id="quickstart"
          title="Quick start"
          lead="Five minutes from opening the app to reading an answer."
        >
          <Steps
            items={[
              {
                title: 'Open Live Lab (the default screen)',
                children: (
                  <p>
                    It starts on the committed demo story, which needs no
                    backend at all.
                  </p>
                ),
              },
              {
                title: 'Press Run and watch both panes',
                children: (
                  <p>
                    The panes animate from real recorded events; drag or click
                    the timeline to rewind and replay any moment.
                  </p>
                ),
              },
              {
                title: 'Switch the composer to Live backend',
                children: (
                  <p>
                    Saved questions appear once the API is reachable (
                    <Code>http://localhost:8000</Code>). Section 9 covers
                    starting it.
                  </p>
                ),
              },
              {
                title: 'Click a citation under an answer',
                children: (
                  <p>
                    The Evidence Explorer opens with full provenance for that
                    piece of evidence.
                  </p>
                ),
              },
              {
                title: 'Toggle Presentation mode (top right)',
                children: (
                  <p>
                    Stage layout with saved-question chips for demonstrating to
                    a room.
                  </p>
                ),
              },
            ]}
          />
        </Section>

        <Section
          id="run"
          title="What happens during a run"
          lead="Every stage emits a typed event; the UI renders only those events. Nothing is simulated during playback."
        >
          <RunLifecycleDiagram />
          <h3 className="text-sm font-semibold text-primary">
            Pipeline A: standard RAG (left pane)
          </h3>
          <Table
            head={['Stage', 'What it means']}
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
                'Chunks are selected and deduplicated within the token budget; discards stay visible.',
              ],
              [
                'Generation',
                'The answer is produced with citations derived from the selected context.',
              ],
            ]}
          />
          <h3 className="text-sm font-semibold text-primary">
            Pipelines B and C: graph-enhanced (right pane)
          </h3>
          <Table
            head={['Stage', 'What it means']}
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
                'Bounded expansion from seeds: depth 2, caps per hop and in total, evidence cap.',
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
          <Callout title="Traversal is bounded by design">
            Depth, per-hop nodes, per-type edges and total nodes are
            configuration limits (<Code>GRAPH_DEPTH=2</Code>,{' '}
            <Code>GRAPH_MAX_TOTAL_NODES=200</Code>, evidence cap 12 by default).
            Unbounded user-driven traversal cannot happen.
          </Callout>
        </Section>

        <Section
          id="questions"
          title="Saved demo questions"
          lead="Four fixed questions form the demo configuration. Their texts name real entities in the demo world; expected answers are never embedded anywhere."
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
          <Callout title="Why one demo question is designed to miss">
            DEMO-04 shows what an honest miss looks like: the system reports
            that it cannot find the pattern rather than inventing one. In front
            of an audience, this is the trust moment.
          </Callout>
        </Section>

        <Section
          id="metrics"
          title="Reading the numbers"
          lead="Which numbers are measured live, and which come from the published benchmark."
        >
          <ScoreStripDiagram />
          <Table
            head={['Metric', 'Where it comes from', 'Where you see it']}
            rows={[
              [
                'Answer correctness',
                'Deterministic checks against grounded truth (benchmark harness only)',
                'Results, published runs',
              ],
              [
                'Evidence recall / precision',
                'Overlap of retrieved evidence with truth-ledger evidence (harness only)',
                'Results, published runs',
              ],
              [
                'Latency, context tokens',
                'Measured per live run',
                'Live Lab score strip, Results efficiency table',
              ],
              [
                'Live score strip',
                'Quality columns only from the published benchmark for the matched question; operational columns from the real run',
                'After a live run of a saved question with a published result',
              ],
            ]}
          />
          <Callout title="The committed headline results">
            Dev world, question bank 1.0.0: full-bank evidence recall{' '}
            <strong>A 0.02 vs B/C 0.62</strong> with the deterministic
            generator; on the real-model subset (Q01, Q25, Q28, Q30) answer
            score <strong>B/C 0.66 vs A 0.41</strong> and evidence recall{' '}
            <strong>0.65 vs 0.04</strong>. These are published, reproducible
            runs, not live claims.
          </Callout>
          <p>
            The live score strip never fabricates quality numbers. Ad-hoc
            questions have no truth to score against, so quality columns stay in
            their waiting state and only real operational measurements are
            reported.
          </p>
        </Section>

        <Section
          id="data"
          title="Data, scenarios and provenance"
          lead="One synthetic world, planted patterns, and citations that resolve to records."
        >
          <p>
            The demo world (<Code>data/generated/demo-seed2026</Code>) was
            produced by generator 0.1.0 with world seed 2026 and scenario seed
            2026: 5,000,000 tickets, 100,000 players, 100,000 accounts, 120,000
            devices and 2,000 documents across four markets. Generation is
            deterministic: identical inputs reproduce identical outputs.
          </p>
          <p>
            All planted patterns come from the scenario engine; nothing is
            hand-patched into benchmark data. The evaluator-only truth ledger (
            <Code>data/truth/ledger-demo.json</Code>) is readable by the
            evaluation package alone; automated isolation tests fail the build
            if retrieval, the API or the datasets code ever tries to read it.
          </p>
          <ProvenanceDiagram />
          <p>
            Every citation resolves to a source system and record, and graph
            nodes carry provenance to warehouse rows, so a numerical claim can
            be traced from the answer through the graph to the authoritative
            table. The{' '}
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
          id="operator"
          title="Running the backend"
          lead="Services and state, from the repository root."
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
            The API reads its world and models from configuration. Without extra
            settings it uses the deterministic fake generator (safe and instant,
            ideal for a live demo). For local-model answers:
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

        <Section
          id="troubleshooting"
          title="Troubleshooting"
          lead="Symptoms, causes and recovery for the common failure modes."
        >
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

        <Section
          id="glossary"
          title="Glossary"
          lead="The eight words this app uses that everywhere else means something slightly different."
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

        <Section
          id="accessibility"
          title="Accessibility"
          lead="Built in, not bolted on."
        >
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
            href={hrefFor('dictionary')}
          >
            Data Dictionary
          </a>{' '}
          (every table, graph label, relationship and ontology concept, with
          diagrams),{' '}
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
