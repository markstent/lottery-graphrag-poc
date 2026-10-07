# Semantic Context Lab
## Master Product, Architecture, Data, UX, Evaluation and Engineering Specification

**Status:** Build specification  
**Primary purpose:** Demonstrate the incremental value of adding a knowledge graph and enterprise ontology above an existing enterprise data layer for AI retrieval, contextual reasoning, evidence discovery and agent performance.

---

# 1. Executive Summary

Build a professional, presentation-quality experimental platform that compares:

1. **Existing data layer + conventional RAG**
2. **Existing data layer + graph relationships**
3. **Existing data layer + graph relationships + enterprise ontology**

The application models a completely synthetic multinational lottery organisation operating across:

- United Kingdom
- Greece
- Austria
- Czech Republic

The system must resemble the complexity of a large European lottery group while containing no proprietary data, real customer information, internal terminology, real employee information, or real corporate branding.

The key proposition is:

> The graph does not replace the existing data layer. It makes the relationships and meaning already present in that data available to AI.

The POC must demonstrate that a knowledge graph and ontology can be added incrementally above an existing data architecture and can improve the ability of agents to retrieve, connect, explain and reason over enterprise information.

---

# 2. Non-Negotiable Naming and Data Constraints

The real employer or company name must never appear anywhere in:

- source code
- documentation
- synthetic data
- prompts
- screenshots
- test fixtures
- comments
- environment names
- database names
- UI text
- benchmark questions
- generated documents
- model context

The word `Atlas` must not be used as:

- project name
- product name
- platform name
- subsystem name
- database name
- environment name
- synthetic company name
- internal codename
- UI label

All people, players, employees, customers, transactions, documents, systems, campaigns, incidents and operational data must be synthetic.

---

# 3. Primary Research Question

> Does adding a knowledge graph and enterprise ontology above an existing enterprise data layer improve the contextual understanding, retrieval quality, cross-domain reasoning, cross-market reasoning, evidence discovery and pattern detection of AI agents?

Secondary questions:

- How does performance change as relational complexity increases?
- Does graph retrieval improve evidence recall?
- Does ontology improve cross-market or cross-language interpretation?
- Does graph context reduce irrelevant context sent to the model?
- Does graph context improve hidden-pattern detection?
- Does graph context improve grounding and explainability?
- Does graph context help a smaller local model approach the performance of a larger model?
- What latency, token, compute or implementation cost is added by graph retrieval?

---

# 4. Core Experimental Thesis

The POC is not a database replacement exercise.

It must compare:

```text
CURRENT APPROACH
Existing data layer
+ documents
+ vector retrieval
+ SQL / APIs
+ LLM

VERSUS

GRAPH-ENHANCED APPROACH
Existing data layer
+ documents
+ vector retrieval
+ SQL / APIs
+ knowledge graph
+ ontology
+ LLM
```

Neo4j acts as a semantic augmentation layer, not as the sole system of record.

Authoritative quantitative facts should remain in the underlying synthetic data layer where appropriate.

Graph nodes should retain provenance back to authoritative source records.

---

# 5. Experimental Configurations

The platform must support at least three experimental configurations.

## Configuration A — Existing Data Layer + Conventional RAG

Includes:

- structured data
- documents
- vector retrieval
- SQL/API-style retrieval
- same generation model
- same embedding model

No explicit graph relationship layer.

## Configuration B — Existing Data Layer + Graph Relationships

Includes everything in A plus:

- explicit entities
- graph relationships
- graph traversal
- provenance paths

Ontology support is minimal and primarily structural.

## Configuration C — Existing Data Layer + Graph + Enterprise Ontology

Includes everything in B plus:

- canonical enterprise concepts
- typed relationships
- concept hierarchies
- equivalence mappings
- cross-market concept mapping
- cross-language concept mapping
- semantic constraints

The system must make it possible to isolate the incremental value of B and C.

---

# 6. Fairness Requirements

All experimental variants must share, unless explicitly testing otherwise:

- the same synthetic world
- the same question
- the same document corpus
- the same embedding model
- the same generation model
- the same model temperature
- the same generation parameters
- equivalent context budgets where practical
- the same scoring framework

The primary variable must be retrieval/context strategy.

The system must never intentionally weaken the conventional RAG baseline.

---

# 7. High-Level Architecture

```text
                         React / TypeScript
                                |
                         REST + Event Stream
                                |
                            FastAPI
                                |
       +------------------------+-------------------------+
       |                        |                         |
Experiment Engine        Retrieval Engine         Evaluation Engine
       |                        |                         |
       |             +----------+----------+              |
       |             |                     |              |
       |        Standard RAG           GraphRAG           |
       |             |                     |              |
       |        Vector / SQL           Neo4j Graph        |
       |             |                     |              |
       +-------------+----------+----------+--------------+
                                |
                             LiteLLM
                                |
                 +--------------+--------------+
                 |                             |
              Ollama                       OpenRouter
              local                         remote
```

Recommended stack:

| Layer | Technology |
|---|---|
| Frontend | React + TypeScript |
| Build | Vite |
| Styling | Tailwind CSS with design tokens |
| Animation | Framer Motion |
| Graph visualisation | Neo4j NVL or another typed graph visualisation layer |
| Charts | Recharts or equivalent |
| Optional visual effects | Three.js, used sparingly |
| API | FastAPI |
| Validation | Pydantic |
| LLM abstraction | LiteLLM |
| Local model serving | Ollama initially |
| Optional Apple optimisation | MLX later |
| Graph | Neo4j |
| Vector store | Qdrant |
| Python testing | pytest |
| Frontend testing | Vitest + React Testing Library |
| End-to-end | Playwright |
| Formatting/linting | Ruff + ESLint/Prettier |
| Type checking | pyright/mypy + TypeScript strict |
| CI | GitHub Actions |
| Services | Docker Compose where useful |

---

# 8. Repository Structure

```text
semantic-context-lab/
|
├── AGENTS.md
├── README.md
├── Makefile
├── .env.example
├── docker-compose.yml
|
├── docs/
│   ├── 00-overview.md
│   │
│   ├── product/
│   │   ├── product-requirements.md
│   │   ├── research-hypotheses.md
│   │   ├── user-journeys.md
│   │   ├── demo-script.md
│   │   └── terminology.md
│   │
│   ├── architecture/
│   │   ├── system-architecture.md
│   │   ├── frontend-architecture.md
│   │   ├── backend-architecture.md
│   │   ├── model-layer.md
│   │   ├── event-streaming.md
│   │   └── adr/
│   │
│   ├── data/
│   │   ├── synthetic-world.md
│   │   ├── relational-schema.md
│   │   ├── graph-schema.md
│   │   ├── ontology.md
│   │   ├── document-corpus.md
│   │   ├── scenario-library.md
│   │   └── truth-ledger.md
│   │
│   ├── retrieval/
│   │   ├── standard-rag.md
│   │   ├── graph-rag.md
│   │   ├── embeddings.md
│   │   ├── evidence-ranking.md
│   │   └── prompting.md
│   │
│   ├── evaluation/
│   │   ├── benchmark-design.md
│   │   ├── scoring.md
│   │   ├── question-bank.md
│   │   └── reproducibility.md
│   │
│   ├── ux/
│   │   ├── information-architecture.md
│   │   ├── screen-specifications.md
│   │   ├── interaction-specification.md
│   │   ├── visual-language.md
│   │   ├── animation-specification.md
│   │   ├── accessibility.md
│   │   ├── presentation-mode.md
│   │   └── mockups/
│   │
│   └── testing/
│       ├── testing-strategy.md
│       ├── acceptance-criteria.md
│       ├── visual-regression.md
│       └── performance-testing.md
│
├── frontend/
├── backend/
├── synthetic/
├── graph/
├── retrieval/
├── evaluation/
├── scripts/
└── .github/workflows/
```

---

# 9. Synthetic Enterprise World

The synthetic environment must be rich enough to require real contextual reasoning.

## Markets

- United Kingdom
- Greece
- Austria
- Czech Republic

Each market should have distinct synthetic characteristics:

- currency
- language
- product mix
- player mix
- retail footprint
- digital adoption
- campaign mix
- operational systems
- support patterns
- platform versions
- incident history

Currencies:

- UK: GBP
- Greece: EUR
- Austria: EUR
- Czech Republic: CZK

Documents may exist in native languages.

Canonical ontology concepts remain language-independent.

---

# 10. Synthetic Product Categories

Every game and product name must be fictional.

Include:

- national draw lottery
- multinational jackpot-style lottery
- high-frequency number game
- instant-win game
- digital instant-win game
- supplementary/add-on game
- annuity-style game
- fixed-prize game

Game properties may include:

```text
game_id
market
game_family
launch_date
retirement_date
draw_frequency
ticket_price
currency
channel_availability
jackpot_type
prize_model
number_selection_rules
mechanics
target_segments
status
```

Important concepts should be represented as graph relationships rather than opaque strings where possible.

---

# 11. Core Enterprise Entities

At minimum:

```text
Market
Game
GameFamily
GameCategory
GameMechanic
Draw
Prize
Ticket
Player
Account
PlayerSegment
Session
Device
OperatingSystem
PaymentMethod
PaymentProvider
Retailer
Region
Channel
Campaign
CampaignExposure
Promotion
Supplier
Platform
PlatformVersion
AppVersion
Incident
SupportCase
Experiment
KPI
Document
DocumentChunk
Rule
Policy
ReleaseNote
ProductSpecification
MarketingBrief
ExperimentReport
IncidentReport
SupportSummary
BusinessConcept
Currency
Language
```

---

# 12. Important Relationships

Examples:

```text
Player          -[:PLAYS]->                Game
Player          -[:BELONGS_TO]->           PlayerSegment
Player          -[:USES]->                 Device
Player          -[:USES_PAYMENT]->         PaymentMethod

Ticket          -[:PURCHASED_BY]->         Player
Ticket          -[:FOR_GAME]->             Game
Ticket          -[:FOR_DRAW]->             Draw
Ticket          -[:SOLD_BY]->              Retailer

Game            -[:AVAILABLE_IN]->         Market
Game            -[:AVAILABLE_VIA]->        Channel
Game            -[:HAS_MECHANIC]->         GameMechanic
Game            -[:INSTANCE_OF]->          GameCategory
Game            -[:SIMILAR_TO]->           Game

Campaign        -[:PROMOTES]->             Game
Campaign        -[:TARGETS]->              PlayerSegment
Player          -[:EXPOSED_TO]->           Campaign

AppVersion      -[:DEPLOYED_TO]->          Market
Incident        -[:RELATED_TO]->           PlatformVersion
Incident        -[:AFFECTS]->              Game
Incident        -[:AFFECTS]->              PlayerSegment

SupportCase     -[:CONCERNS]->             Game
SupportCase     -[:RELATED_TO]->           Incident

Document        -[:DESCRIBES]->            Game
Document        -[:REFERENCES]->           Incident
Document        -[:DEFINES]->              Rule

Rule            -[:APPLIES_TO]->           Game
```

Relationship properties may include:

```text
timestamp
confidence
source
weight
market
valid_from
valid_to
```

---

# 13. Ontology Layer

The ontology is a first-class deliverable.

It must define canonical concepts such as:

```text
Game
GameCategory
GameMechanic
Market
PlayerSegment
Campaign
Platform
Incident
Supplier
Channel
BusinessEvent
Document
KPI
```

It must support:

- `INSTANCE_OF`
- `IS_A`
- `HAS_MECHANIC`
- `EQUIVALENT_TO`
- `MAPS_TO`
- `AFFECTS`
- `TARGETS`
- `DEPENDS_ON`
- `RUNS_ON`
- `PROMOTES`
- `RELATED_TO`

The ontology must make it possible to map different local terminology to canonical concepts.

Example:

```text
local market term
      |
   MAPS_TO
      |
canonical BusinessConcept
```

---

# 14. Existing Data Layer Principle

Neo4j must be implemented as an augmentation layer.

Do not move all operational facts into Neo4j merely because a graph database exists.

Where appropriate:

- authoritative transaction facts remain in the structured layer
- document text remains in the document/vector layer
- Neo4j stores entities, relationships, ontology mappings and provenance
- graph nodes retain source-system references
- graph traversal can guide the agent to relevant structured or document evidence
- final numeric claims should prefer authoritative source records

The POC must demonstrate that the graph can be added to an existing data platform incrementally.

---

# 15. Dataset Profiles

Provide deterministic profiles.

| Profile | Purpose |
|---|---|
| Development | Fast iteration |
| Demo | Presentation + benchmark |
| Stress | Scale/performance testing |

Suggested starting volumes:

| Entity | Dev | Demo | Stress |
|---|---:|---:|---:|
| Players | 10k | 100k | 1m |
| Games | 20 | 40 | 60 |
| Tickets / transactions | 250k | 5m | 50m |
| Sessions | 100k | 2m | 20m |
| Campaign exposures | 100k | 3m | 30m |
| Retailers | 500 | 5k | 20k |
| Devices | 12k | 120k | 1m |
| Support cases | 2k | 50k | 500k |
| Documents | 250 | 2k | 10k |

All volumes must be configurable.

---

# 16. Deterministic Generation

Every generated world must use:

```text
world_seed
scenario_seed
generator_version
```

Identical configuration and seeds must reproduce the same world.

No benchmark result is valid without reproducibility metadata.

---

# 17. Scenario Injection

The system must support configurable planted patterns.

Initial scenario library:

```text
app release conversion failure
shared-device behavioural cluster
shared-payment cluster
retailer anomaly
promotion-driven game migration
product cannibalisation
jackpot halo effect
cross-market platform incident
campaign audience mismatch
payment provider degradation
game mechanic affinity
cross-market transferable campaign
support complaint precursor
regional retail anomaly
digital adoption shift
```

Scenario controls:

```text
enabled
strength
affected_markets
affected_segments
start_date
duration
noise_level
scenario_seed
```

---

# 18. Truth Ledger

Each planted scenario must create evaluator-only truth metadata.

Example:

```json
{
  "scenario_id": "SCN-0042",
  "type": "app_release_conversion_failure",
  "cause": "APP_VERSION_5_3",
  "market": "GREECE",
  "affected_segment": "ANDROID_LEGACY",
  "affected_games": ["GAME_GR_04", "GAME_GR_09"],
  "effects": {
    "checkout_completion": -0.18,
    "support_contacts": 0.31,
    "revenue": -0.12
  }
}
```

Retrieval systems must never be able to access the truth ledger.

---

# 19. Synthetic Document Corpus

Generate synthetic documents including:

- product specifications
- game rules
- release notes
- incident reports
- post-incident reviews
- marketing briefs
- campaign evaluations
- customer-support summaries
- monthly market reports
- experiment reports
- meeting notes
- platform documentation
- responsible gaming policies
- technical integration notes

Important evidence should be deliberately distributed across multiple documents and structured sources.

Some questions must require multi-source synthesis.

---

# 20. Multilingual Design

Possible document languages:

- English
- Greek
- German
- Czech

English remains the primary chatbot language.

The ontology maps local terms to canonical concepts.

---

# 21. Standard RAG Pipeline

```text
Question
   |
Query embedding
   |
Vector search
   |
Top-K chunks
   |
Optional reranking
   |
Context assembly
   |
LLM
   |
Answer + citations
```

Capture:

```text
query
embedding_duration
candidate_chunk_ids
similarity_scores
reranking_scores
selected_evidence
discarded_evidence
context_token_count
input_tokens
output_tokens
latency
answer
citations
```

The conventional baseline must be credible and well tuned.

---

# 22. GraphRAG Pipeline

```text
Question
   |
Intent / entity extraction
   |
Semantic seed retrieval
   |
Entity resolution
   |
Graph traversal
   |
Candidate evidence graph
   |
Graph-aware ranking
   |
Evidence selection
   |
Context assembly
   |
LLM
   |
Answer + evidence paths
```

Configurable limits:

```text
max_hops
relationship_whitelist
node_type_whitelist
maximum_candidate_nodes
maximum_visible_nodes
maximum_evidence_items
context_budget
```

Never perform unbounded graph traversal.

---

# 23. Live Graph Traversal Visualisation

This is a primary product feature.

The graph visualisation must show actual retrieval activity.

It must not be decorative or fabricated.

The GraphRAG pane should progressively visualise:

1. seed entities
2. active node
3. traversed relationship
4. candidate node
5. ontology concept
6. candidate evidence
7. selected evidence
8. discarded/faded evidence

Visual states should include:

```text
seed
active
candidate
traversed
selected
discarded
ontology_concept
source_record
```

The display should prioritise comprehensible evidence paths over node count.

Do not render the entire enterprise graph.

Use clustering or abstraction when necessary.

Every visual event must be driven by structured backend telemetry.

---

# 24. Standard RAG Visualisation

The standard RAG side should visually show:

- query embedding
- candidate chunks
- similarity score
- reranking
- selected chunks
- discarded chunks
- final context set

The audience should be able to understand why standard RAG chose its evidence.

---

# 25. Evidence Path View

Provide a simplified view showing only the graph path that materially contributed to an answer.

Example:

```text
Game
  -> Platform
  -> Release
  -> Incident
  -> Market
```

This should be presentation-friendly and auditable.

---

# 26. Graph Explore View

After retrieval completes, allow controlled manual exploration.

Users may expand a node to inspect nearby relationships.

Manual exploration must be bounded and clearly separate from the actual retrieval trace.

---

# 27. Optional Cypher Inspector

Provide an expandable technical view showing relevant Cypher queries.

This should be hidden or de-emphasised in presentation mode.

The graph animation must be backed by real graph results, not animation-only behaviour.

---

# 28. No Chain-of-Thought Display

Never display hidden model chain-of-thought.

Only display observable system events such as:

```text
query received
entities resolved
vector search completed
seed nodes selected
relationships traversed
evidence ranked
context assembled
answer requested
answer generated
```

Never fabricate reasoning prose.

---

# 29. Benchmark Design

Initial benchmark: 30 questions.

Suggested categories:

| Category | Count |
|---|---:|
| Simple factual retrieval | 4 |
| Semantic retrieval | 4 |
| Relationship lookup | 4 |
| Two-hop reasoning | 4 |
| Multi-hop reasoning | 4 |
| Cross-domain causal reasoning | 4 |
| Cross-market / ontology / hidden-pattern | 6 |

Every benchmark item must define:

```text
question_id
question
difficulty
market_scope
expected_concepts
required_evidence
truth_ledger_references
scoring_rubric
```

---

# 30. Evaluation Metrics

Track separately:

```text
answer_correctness
evidence_precision
evidence_recall
grounding
relationship_discovery
pattern_detection
cross_market_discovery
ontology_usefulness
context_efficiency
latency
input_tokens
output_tokens
tool_calls
estimated_cost
```

Do not hide performance behind one opaque score.

A composite score may exist only if its formula is visible.

---

# 31. Evaluation Principles

Prefer deterministic evaluation using:

- known numeric answers
- known entity IDs
- required evidence IDs
- required relationship paths
- planted scenario truth

LLM-as-judge may be used only for subjective dimensions.

Evaluation prompts must be version controlled.

---

# 32. Primary User Experience

The application should feel like a premium enterprise AI research tool.

Primary target:

```text
1920 x 1080
desktop / presentation
```

It must remain usable on ordinary laptop sizes.

The application is not mobile-first.

---

# 33. Screen Inventory

## 33.1 Experiment Home

Configure:

- dataset
- seed
- markets
- model
- embedding model
- scenarios
- standard RAG configuration
- GraphRAG configuration
- benchmark
- local/remote inference

## 33.2 Live Lab

The hero experience.

Top:

- question input
- market scope
- run button
- experiment metadata
- model status

Middle:

```text
CURRENT APPROACH | + GRAPH & ONTOLOGY
```

Bottom:

- answers
- evidence
- metrics
- score

## 33.3 Evidence Explorer

Inspect:

- document chunks
- source records
- graph nodes
- edges
- evidence paths
- similarity scores
- reranking scores
- provenance

## 33.4 Scenario Lab

Create or enable planted scenarios.

## 33.5 Benchmark Runner

Run the benchmark and show progress.

## 33.6 Results Dashboard

Show:

- performance by configuration
- performance by question type
- performance by market
- performance by relational complexity
- latency
- token usage
- evidence quality
- pattern discovery
- ontology advantage

## 33.7 Replay

Replay execution using persisted event telemetry.

## 33.8 Semantic Layer / Graph Overlay

Show visually how the graph sits above existing data sources:

```text
Structured data  Documents  Telemetry  Support
       \            |          |         /
               Entity mapping
                      |
                   Ontology
                      |
              Relationship graph
                      |
                    Neo4j
```

This screen is important for the final presentation because it demonstrates incremental adoption.

---

# 34. UX Principles

Avoid:

- generic admin dashboard appearance
- unnecessary glassmorphism
- excessive gradients
- graph hairballs
- decorative charts
- constant motion
- fake AI reasoning
- overcrowded panels

Prioritise:

- visual hierarchy
- clear evidence
- progressive disclosure
- restrained animation
- business meaning
- provenance
- presentation quality
- technical credibility

---

# 35. Design System

Use design tokens.

Minimum token categories:

```text
background
surface
surface_raised
border
text_primary
text_secondary
text_muted
rag_accent
graph_accent
success
warning
error
market_uk
market_gr
market_at
market_cz
```

Do not introduce arbitrary colours inside components.

Also define:

- typography scale
- spacing scale
- corner radius
- animation timing
- node sizes
- edge styles
- graph states
- chart conventions

---

# 36. Mock-ups and Prototypes

Do not implement the final frontend until approved mock-ups exist for at least:

- Experiment Home
- Live Lab
- Evidence Explorer
- Scenario Lab
- Benchmark Runner
- Results Dashboard
- Replay
- Semantic Layer / Graph Overlay

For the Live Lab, create:

- wireframe
- high-fidelity mock-up
- loading state
- active traversal state
- completed state
- error state
- presentation mode
- interactive prototype

Mock-ups are visual contracts.

---

# 37. Storybook

Every important reusable frontend component must have a Storybook story.

Examples:

```text
QuestionComposer
ExperimentHeader
PipelineStage
ChunkCard
EvidenceCard
GraphNode
GraphEdge
MarketBadge
MetricCard
ScoreComparison
BenchmarkProgress
ReplayTimeline
ScenarioControl
OntologyConceptCard
```

Include:

- normal
- loading
- empty
- error
- extreme-data

states.

---

# 38. Accessibility

Target WCAG AA principles.

Requirements include:

- keyboard navigation
- visible focus states
- sufficient contrast
- semantic HTML
- screen-reader labels
- reduced-motion support
- no meaning communicated only by colour
- graph information available in textual form

---

# 39. Presentation Mode

Presentation mode must:

- use the real backend
- use real retrieval
- use real graph traversal
- simplify secondary controls
- enlarge important typography
- keep graph zoom controlled
- support predefined demonstration questions
- support one-click reset
- support full-screen browser presentation

Presentation mode must never alter benchmark results.

---

# 40. Backend API

Use versioned endpoints. The canonical contracts, including the query run lifecycle and event stream, are defined in `docs/07-api-event-spec.md`; the names below are the canonical top-level resources and supersede any earlier sketch.

Example:

```text
/api/v1/experiments
/api/v1/datasets
/api/v1/scenarios
/api/v1/queries
/api/v1/benchmarks
/api/v1/models
/api/v1/graph
```

Use Server-Sent Events or WebSockets for execution telemetry.

Example event:

```json
{
  "event": "graph.relationship.traversed",
  "timestamp": "...",
  "run_id": "...",
  "payload": {
    "source": "GAME_GR_04",
    "relationship": "AFFECTED_BY",
    "target": "APP_VERSION_5_3"
  }
}
```

---

# 41. Model Abstraction

All model calls must pass through a model abstraction.

Do not hard-code a provider.

Support:

- Ollama
- OpenRouter through LiteLLM
- future MLX-backed service

Configuration example:

```text
MODEL_PROVIDER=ollama
MODEL_NAME=...
MODEL_TEMPERATURE=0
MODEL_BASE_URL=...
```

---

# 42. Reproducibility Metadata

Every run must record:

```text
application_version
git_commit_sha
dataset_version
world_seed
scenario_seed
benchmark_version
prompt_version
model_identifier
embedding_model
retrieval_configuration
graph_configuration
timestamp
```

---

# 43. Testing Strategy

## Unit Tests

Cover:

- synthetic generation
- scenario injection
- ontology mapping
- evidence ranking
- scoring
- metrics
- configuration
- graph utilities
- document generation

## Integration Tests

Cover:

- FastAPI + Neo4j
- FastAPI + vector DB
- ingestion
- retrieval
- benchmark execution
- mocked model adapter

## Frontend Tests

Cover:

- rendering
- loading states
- event handling
- error states
- keyboard interactions

## End-to-End Tests

Using Playwright:

- generate dataset
- launch experiment
- ask arbitrary question
- execute all configured retrieval variants
- inspect evidence
- inject scenario
- run benchmark
- inspect results
- replay execution
- reset presentation mode

## Visual Regression

Maintain approved screenshots for major presentation screens.

Unexpected layout or styling changes must fail CI.

---

# 44. Deterministic Testing

CI must not depend on a live remote model.

Use deterministic fake or recorded model adapters in CI.

Live-model benchmark execution is separate.

---

# 45. Quality Gates

The default branch must require:

- formatting
- linting
- Python type checking
- TypeScript type checking
- unit tests
- integration tests
- frontend tests
- application build
- Playwright smoke tests

Do not disable failing tests simply to make CI pass.

---

# 46. Observability

Use structured logging.

Include:

```text
experiment_id
run_id
question_id
pipeline
```

Measure durations for:

- embedding
- vector retrieval
- graph traversal
- reranking
- context construction
- LLM generation
- evaluation

---

# 47. Security

All data is synthetic.

Never commit:

- API keys
- passwords
- tokens
- credentials
- real private documents
- real customer or employee information

Use environment variables.

`.env` must be ignored.

---

# 48. Documentation Standard

Every major subsystem must document:

- what it does
- why it exists
- how it works
- how to run it
- how to test it
- how to extend it
- common failure modes

Documentation must teach the project owner how the system works.

---

# 49. Human-in-the-Loop Governance

OpenCode and its coding model are expected to implement most of the software autonomously, but may not autonomously cross defined project gates.

Human review is mandatory at the checkpoints below.

The agent must stop at each checkpoint, provide the required artefacts, and wait for explicit approval before continuing.

The human reviewer may approve, reject, or request changes.

No checkpoint may be skipped because the implementation appears obvious.

## HITL-01 — Product Scope Approval

**Occurs after:**

- initial repository bootstrap
- product requirements draft
- research hypotheses draft
- terminology draft

**Must present:**

- concise system purpose
- experimental configurations A/B/C
- explicit non-goals
- proposed success criteria
- list of open assumptions

**Human must approve before:**

- finalising architecture
- building retrieval engines

---

## HITL-02 — Architecture Approval

**Occurs after:**

- system architecture draft
- frontend/backend boundaries
- data flow
- model gateway design
- Neo4j overlay design
- vector layer design
- event streaming design

**Must present:**

- architecture diagram
- service responsibilities
- major technology choices
- ADRs for important decisions
- risks and alternatives

**Human must approve before:**

- implementing production architecture
- introducing major infrastructure dependencies

---

## HITL-03 — Synthetic Data Model Approval

**Occurs after:**

- relational schema draft
- entity list
- event model
- source provenance model
- dataset volume plan

**Must present:**

- tables/entities
- representative sample records
- market-specific differences
- generated-data constraints
- source-of-truth boundaries

**Human must approve before:**

- large-scale data generation
- ingestion pipeline implementation

---

## HITL-04 — Ontology and Graph Model Approval

**Occurs after:**

- ontology draft
- node labels
- relationship types
- relationship direction
- canonical concepts
- source record references
- cross-market mappings

**Must present:**

- ontology diagram
- graph schema
- at least three worked example questions
- traversal examples
- explanation of what belongs in the graph versus underlying data layer

**Human must approve before:**

- graph ingestion implementation
- GraphRAG implementation

---

## HITL-05 — Scenario and Truth-Ledger Approval

**Occurs after:**

- initial scenario library
- pattern injection rules
- truth-ledger design
- benchmark scenario mapping

**Must present:**

- each planted scenario
- why it exists
- what observable signals it creates
- what hidden truth is stored
- expected retrieval difficulty

**Human must approve before:**

- benchmark data generation

---

## HITL-06 — UX Information Architecture Approval

**Occurs after:**

- screen inventory
- navigation model
- user journeys
- live comparison interaction flow

**Must present:**

- page map
- primary user flow
- presentation flow
- evidence inspection flow

**Human must approve before:**

- high-fidelity visual design

---

## HITL-07 — High-Fidelity UX Approval

**Occurs after:**

- wireframes
- Live Lab mock-up
- graph traversal mock-up
- RAG retrieval mock-up
- Results Dashboard mock-up
- Semantic Layer / Graph Overlay mock-up

**Must present:**

- high-fidelity reference screens
- loading states
- error states
- active traversal states
- completed states
- presentation mode
- animation behaviour

**Human must approve before:**

- final frontend implementation

---

## HITL-08 — Retrieval Behaviour Approval

**Occurs after:**

- conventional RAG prototype
- GraphRAG prototype
- evidence model
- telemetry model

**Must present:**

- example execution trace from each system
- retrieved evidence
- graph traversal trace
- context assembly
- citations
- known limitations

**Human must approve before:**

- locking benchmark methodology

---

## HITL-09 — Benchmark and Scoring Approval

**Occurs after:**

- question bank draft
- scoring rubric
- deterministic evaluator
- LLM-as-judge rules if used

**Must present:**

- full benchmark category design
- sample questions
- expected evidence
- score calculations
- fairness controls

**Human must approve before:**

- official benchmark runs

---

## HITL-10 — Testing and Quality Approval

**Occurs after:**

- CI pipeline
- unit tests
- integration tests
- E2E tests
- visual regression tests

**Must present:**

- test matrix
- coverage for critical logic
- known exclusions
- example failed-test behaviour

**Human must approve before:**

- release candidate status

---

## HITL-11 — Presentation Readiness Approval

**Occurs after:**

- presentation mode
- demo reset
- replay
- final results dashboard
- demo data profile

**Must present:**

- complete scripted demo
- backup question set
- reset/recovery procedure
- benchmark summary
- architecture explanation
- graph-overlay explanation

**Human must approve before:**

- declaring the POC complete

---

# 50. Human Review Rules

At every checkpoint, the coding agent must:

1. stop implementation beyond the gate
2. summarise what has been completed
3. list the artefacts requiring review
4. identify unresolved decisions
5. identify risks
6. state exactly what approval is needed
7. wait for explicit approval

The agent must not infer approval from silence.

Approval must be explicit, such as:

```text
Approved
Proceed
HITL-04 approved
Continue to the next phase
```

Minor bug fixes and non-material refactors within an already approved phase do not require a new gate unless they materially alter:

- architecture
- ontology semantics
- experimental fairness
- scoring
- UX information hierarchy
- data provenance
- security

---


# Lean Engineering Principle

Implementation must use the minimum sufficient code required to satisfy the product, experimental and quality requirements.

The codebase should be modular and professionally engineered without unnecessary abstraction.

Required principles:

- cohesive modules with clear responsibilities
- low coupling and explicit typed contracts
- minimal dependency count
- simple control flow
- no speculative framework-building
- no duplicate architectural layers
- abstractions introduced only for real boundaries, multiple implementations, replaceable external dependencies, or meaningful test seams
- refactoring driven by concrete complexity rather than pattern preference

The target is **small, clear, testable software**, not the appearance of enterprise complexity.

Every major dependency or architectural layer should earn its place by reducing total complexity or enforcing a real boundary.


# 51. Definition of Done

A feature is complete only when:

- implementation exists
- tests exist
- tests pass
- type checking passes
- formatting passes
- linting passes
- relevant docs are updated
- error states exist
- acceptance criteria are met
- accessibility has been considered
- relevant HITL approval has been obtained

---

# 52. Final Deliverables

The completed system must include:

- professional application
- synthetic enterprise data generator
- four-market synthetic world
- standard RAG baseline
- Neo4j graph overlay
- enterprise ontology
- GraphRAG retrieval
- live graph traversal visualisation
- RAG retrieval visualisation
- evidence explorer
- scenario injection
- hidden truth ledger
- benchmark framework
- automatic scoring
- replay
- results dashboard
- semantic-layer architecture view
- presentation mode
- local-model support
- OpenRouter support for development/testing
- automated test suite
- visual regression suite
- architecture documentation
- user documentation
- developer documentation
- demo script
- reproducibility metadata

The finished POC must be credible as both a live executive demonstration and a serious technical experiment.
