# Overhaul Design: Semantic Context Lab v2

Status: DRAFT for project-owner approval (HITL-12).
Date: 2026-10-18.
Author: coding agent, from five audits (methodology, data and ontology, backend, UX, wording) and owner decisions taken in session on 2026-10-18.
Audit reports and screenshots: session scratchpad `scratchpad/{methodology,data,backend,ux,wording}-audit/REPORT.md`.

---

## 1. Intent

Show, truthfully, whether adding a knowledge graph and an enterprise ontology above an existing enterprise data layer gives an AI assistant more accurate, better evidenced answers.
Show it in a product that a mixed business and technical audience understands within minutes, on a projector, without a narrator.

The owner's thesis is that graphs and ontologies add value to questioning.
The product's job is to find out and to show the answer either way, with the measurement visible enough that a sceptic in the room can check it.

### Why now

The current release (v0.1.0-rc1) does not do this.
The audits found three layered problems.

1. The experiment mostly does not measure the question.
   Pipeline A can only earn evidence credit through document ids while required evidence is mostly structured record ids.
   Pipelines B and C are credited for echoing the question's own anchor id back as a seed.
   The ontology is ten flat concepts whose every binding duplicates an edge B already traverses, so C equals B by construction.
   The Results screen shows invented numbers labelled as a committed run.
2. The interface is a document wearing a UI.
   There is no verdict anywhere, one small unreadable graph, no diagrams of the data model, 4,100 words of copy, and failing contrast.
3. The engineering is clean on the surface and hollow in places.
   Events attach only after a pipeline finishes, so nothing can stream.
   There is no structured logging, no data-model API, five empty packages, and a chunker that splits "GBP 1.50" in two.

---

## 2. Goals, non-goals, anti-goals

### Goals

- G1. A fair three-way comparison where each pipeline has the same data, the same models, the same context budget, and the same evidence slots, and the only differences are the graph layer and the ontology layer.
- G2. An ontology that has real work to do: four markets with their own vocabularies and languages that only a shared concept layer can connect.
- G3. A benchmark large and varied enough to support a statistical statement per hypothesis, with confidence intervals, run on real models.
- G4. A product that opens on the verdict, shows three pipelines side by side as they run, draws the graph traversal legibly, and lets a viewer open any piece of evidence down to the source row.
- G5. A Data Model area where a viewer can see the warehouse tables, the graph model, the ontology tree, and sample rows, all driven by live data, never hand-typed.
- G6. A Help area readable by a business viewer that includes every benchmark question with what it tests, its planted story, its answer key, and how each pipeline scored.
- G7. Roughly a quarter of today's words, one name per concept, no disclaimers.
- G8. Runs locally on Ollama and remotely through LiteLLM (OpenRouter) by configuration.

### Non-goals

- Replacing the warehouse or lakehouse with Neo4j.
- Proving a universal result; the claim is about this synthetic enterprise and these question types.
- Mobile layouts.
- A general-purpose graph browser.
- Multi-user accounts, authentication, or deployment beyond a single operator's machine.

### Anti-goals (failure even if it works)

- Any mechanism, however small, that gives one pipeline information or capacity the others lack other than the graph or ontology layer itself.
- Any number on screen that was not produced by the harness or a recorded run.
- Any benchmark question written so that only one pipeline can pass it by construction.
- The words "honest", "never", "real" or "fake" appearing in product copy as reassurance.
- A graph animation that is not a replay of recorded events.

---

## 3. Constraints

- All rules in `AGENTS.md` continue to apply: no employer name, no "Atlas", all data synthetic, truth ledger isolated from retrieval, deterministic generation, all model access through the gateway, no hidden chain of thought, typed and versioned API.
- Primary target is a 16:9 desktop presentation at 1920 by 1080, light theme, projector friendly.
- Audience is mixed business and technical: plain language by default, technical detail one click away on every screen.
- Local runtime: Ollama for embeddings and generation.
  Official benchmark runs and the judge: LiteLLM against OpenRouter, selected by environment.
  CI uses the deterministic fake generator and never a live model.
- Python 3.13, uv, FastAPI, Pydantic, Neo4j 5.26 Community (no APOC), Qdrant, DuckDB over Parquet.
  TypeScript strict, React 19, Vite, Tailwind v4, Vitest, Playwright.
- Dependencies are added only where they remove more code than they add; each new one is recorded in `docs/decisions.md`.

---

## 4. Approval model for this overhaul

The owner approves this document once as gate HITL-12.
Work then proceeds through four workstreams with three checkpoints where the agent stops and reports with artefacts and screenshots.

| Checkpoint | After | Owner sees |
|---|---|---|
| CP1 Experiment | World v2, ontology v2, eight planted scenarios, pipelines v2, bank 2.0.0, harness v2, a small real-model smoke run | Data model inventory, ontology tree, bank with strata, smoke numbers with intervals, fairness tests |
| CP2 Product | Overview, Live Lab, Data Model, Help built against the live API | Screenshots of every screen and state, a recorded real run replaying in Live Lab |
| CP3 Official run | Results screen, model and cost choice for the official run | Model choice, estimated cost and duration, dry-run on four questions; after approval the full run and final Results |

`HITL_STATUS.md` records HITL-12 and each checkpoint.
Gates HITL-03 to HITL-09 are marked "superseded by HITL-12" rather than reopened one by one.
Work happens on branch `overhaul/v2`, merged to `main` at each approved checkpoint.

---

## 5. Workstream 1: Experiment integrity

This workstream comes first because every screen downstream shows its output.

### 5.1 World v2 (generator version 0.2.0)

Each market gets its own reference data, the way four real operators on four source systems would.

- Market-local codes and display names for game families, game categories, mechanics, incident types, support categories, channels and player segments.
  Example: the national draw family is `FAM_UK_NATIONAL_DRAW` "National Draw" in the UK, `FAM_GR_ARITHMOLACHEIO` "Αριθμολαχείο" in Greece, `FAM_AT_ZAHLENLOTTO` "Zahlenlotto" in Austria, `FAM_CZ_CISELNA_LOTERIE` "Číselná loterie" in Czechia.
  Within a market, structural edges (`BELONGS_TO`, `INSTANCE_OF` category, `RELATED_TO` platform) work exactly as today.
  Across markets, nothing in the source layer links equivalent things.
- Documents mention games, incidents and segments by local display name at least as often as by id, in the market's language for market documents (keep the existing 30 percent English share) and in English for corporate documents.
- Documents are coherent: the document's market matches its subject entity's market, detail sentences reference entities related to the subject, and sentences do not repeat within a document.
- Chunking splits on sentence boundaries with 128 to 256 token windows and overlap, so decimals, version labels and ids survive intact.
- Generator rows become named records (dataclass or NamedTuple per table) instead of positional tuples.
  Every distribution constant is named and documented in one module.
  Duplicated master data (markets, currencies, prize tiers with differing weights) is unified.
- Nodes carry `valid_from`, `valid_to` and `source_timestamp` in addition to today's provenance fields.
- The foreign key list moves from a private literal in validation into exported schema metadata that the API and the validator both read.
- Profiles stay as today (tiny, dev, demo); the demo profile scales incidents, campaigns and experiments with volume instead of holding them constant.
- Determinism gains a golden-hash test over written Parquet, not only in-process comparison.

### 5.2 Ontology v2 (ontology version 2.0.0)

The ontology becomes the dictionary the four source systems lack.

- Concepts carry a hierarchy (`IS_A`), labels in en, el, de and cs, synonyms, a definition, and a concept type.
- The two hub concepts split into informative children: PlatformIncident into Payment, Application, Identity, Draw and Retail incidents; PlayerSegment into Value and Engagement segments.
  All six mechanics are bound.
- `MAPS_TO` edges run from every market-local code (family, category, mechanic, incident type, segment, channel) to its canonical concept.
- `SIMILAR_TO` between games is derived from canonical concepts (shared concept family, category and mechanics) and is an ontology artefact.
  It is available to pipeline C only, because with market-local codes it cannot be computed from the source layer.
- A versioned term table (canonical names, local labels, synonyms) is built from the ontology and master data only, before any grounding exists, and a test asserts it never reads the bank or the ledger.
- `backend/app/ontology/` becomes a real package: loader from `schemas/ontology/ontology.yaml`, term matcher, similarity derivation, version constant.
  The YAML is aligned with the concept ids and becomes the single source for the ontology.

### 5.3 Scenarios

Eight planted scenarios.
The four existing ones (SCN-002 shared device cluster, SCN-003 shared payment cluster, SCN-007 cross-market platform incident, SCN-015 document and structured conflict) stay.
Four are added.

| Scenario | Why |
|---|---|
| SCN-010 cross-market mechanic affinity | Requires the ontology: local mechanic names in each market, affinity only visible through the canonical concept |
| SCN-011 transferable campaign | Requires the ontology: segment equivalence across local segment taxonomies |
| SCN-001 app release conversion failure | The primary demonstration story in the catalogue; two bank questions already wait for it; strong graph signal |
| SCN-009 payment provider degradation | Cheap, visual, one provider explains symptoms in several markets; adds a providers table |

Every published bank question maps to a planted scenario or a base fact of the world.
The published bank contains no "not planted" questions.
Planted ids no longer encode the scenario (`INC_S007_GR` becomes an ordinary id), and planted documents no longer name their sibling incidents in other markets.

### 5.4 Pipelines v2

All three pipelines are built from one lab object with one configuration.
A fairness test pins that B is C minus the ontology layer and A is B minus the graph layer, by inspecting the constructed objects.

Shared by all three:

- Dense embeddings with bge-m3 through Ollama, as today.
- Sparse lexical retrieval fused with dense retrieval by reciprocal rank fusion.
- A multilingual cross-encoder reranker applied to the document channel.
- One total context budget in tokens that counts document chunks and structured record blocks together.
- The same number of evidence slots.
- The same generation model, prompt, temperature and maximum answer length.
- Prompt asks for a structured answer: a short verdict field, the answer text, and `[n]` citations against numbered context blocks.

Pipeline A, text search:

- The vector collection contains document chunks and one serialised text block per structured record (game, platform version, incident, campaign, segment, provider), produced by one fixed serialiser for every table, with the same provenance fields as chunks.
  This gives A the same warehouse access B and C get through the graph, so the comparison isolates relationships rather than data access.
- Retrieval: hybrid search, rerank, select to budget.

Pipeline B, plus graph:

- Entity resolution by exact id and market alias only.
- Bounded breadth-first traversal over the structural allow-list.
  No edge whose target is a concept, no `SIMILAR_TO`.
- Candidate ranking by graph distance, relationship strength, semantic relevance and temporal validity.
  Temporal validity is computed from `valid_from` and `valid_to`, or the component is removed; it is not a constant.
- Authoritative facts for selected nodes come from the structured layer.
- Document channel identical to A.

Pipeline C, plus ontology:

- Entity resolution adds the term table: canonical names, local-language labels and synonyms resolve to concepts and to the local instances bound to them.
  Keyword seeding from description words is removed.
- The document query is expanded with the canonical name and the local-language synonyms of resolved concepts.
- Traversal adds `MAPS_TO` and concept-derived `SIMILAR_TO`.
  Concept expansion is ranked and bounded by the same caps, not an injection of every bound instance.
- Telemetry records which concept each added node came through so the UI can show "what the ontology added".

Retrieval telemetry is unchanged in spirit (the event names of docs/07 stay) and gains per-event ids, timestamps and the concept attribution above.

### 5.5 Benchmark v2 (bank version 2.0.0)

Design:

- Logical questions are written once in plain English, with a template slot for the anchor (market, incident, game, campaign).
  Each logical question is instantiated for several anchors per world and across three world seeds.
  Target: 90 to 150 paired observations, at least 20 per hypothesis stratum.
- Each question carries: plain-English text, what it tests in one sentence, hypothesis stratum, scenario or base fact, `ontology_dependent` flag, expected answer, and the required evidence as claim-carrier sets.
- Hypotheses map to strata: H1 depth sweep on multi-hop questions (traversal depth 0 to 3), H2 ontology-dependent questions, H3 single facts, H4 citation accuracy and path explainability, H5 planted pattern discovery, H6 latency and context efficiency, H7 a small versus a large generation model on the same bank.

Evidence scoring:

- Required evidence is a set of claims, each with acceptable carriers: a structured record id or any document chunk whose text states the fact, computed deterministically at grounding time and frozen with the bank version.
- Question anchors are excluded from both required and retrieved evidence; the metric scores discoveries.
  Anchor resolution is reported as a separate metric.
- Recall, precision and F1 at a matched number of evidence slots; context efficiency as required claims found per thousand context tokens.

Answer scoring:

- Deterministic checks remain and improve: number checks against the answering sentence with a penalty for contradictory numbers, set checks as F1, yes/no questions read the structured verdict field.
- Citations `[n]` are parsed; citation accuracy is the share of cited blocks that contain the claimed fact, and the share of numeric claims that carry a citation.
- A versioned, blinded LLM judge scores correctness, completeness, faithfulness to the shown context, citation accuracy and appropriate abstention on 0 to 2 scales.
  Pipeline identity is stripped, block order randomised, answer length capped.
  The judge is a different model family from the generator.
  Judge scores are reported beside the deterministic scores, with their agreement rate, and never replace them.

Statistics:

- Three generation repeats per cell with a real model.
- Paired bootstrap 95 percent intervals on mean differences for A versus B and B versus C, per metric and per stratum, with Wilcoxon signed-rank p-values and Holm correction across the hypothesis family.
  Cluster the bootstrap by logical question and world so templated instances do not inflate confidence.
- Headline statement format, generated by the harness: "Graph exceeds text search by X evidence points (95 percent interval l to u, n pairs) on multi-hop questions; no detectable difference on single facts."

Reporting:

- The fake-generator run is labelled "scorer smoke test" and is never shown as a result.
- The reproducibility record adds prompt version and hash, scorer version, judge model and prompt hash, ingestion and index versions, full allow-lists and weights, dedupe threshold, model quantisation, repeat index.
- `summary.json` is the only source the API publishes; the frontend never recomputes a score.

### 5.6 Official run

The generation model and judge for the official run are chosen at CP3 with an estimated cost and duration.
Default proposal: a mid-size open model on OpenRouter for generation, a different family for the judge, and the local Qwen 3.6 as the small model for H7.
The run is executed from the CLI, persisted, and published through the API.

---

## 6. Workstream 2: Backend as a product API

### 6.1 Streaming, persistence, history

- A recording event sink appends each event to the run as it happens and signals waiters.
- `GET /api/v1/queries/{run_id}/events/stream` serves server-sent events with sequence ids, `Last-Event-ID` resume, a heartbeat, and terminal events.
  The replay endpoint and the stream share one event envelope with `event_id`, `timestamp`, `run_id`, `pipeline`, `event_type`, `t_ms`, `payload`.
- Per-pipeline status inside the run record, so A can render while C is still traversing.
- Cooperative cancellation between stages.
- Runs, events and results persist in SQLite (ADR-007 as written) with a retention policy and `GET /api/v1/queries?limit&before&status` for history.
- Readiness in `/health`: lab built, index populated, Neo4j reachable, model reachable, reported separately from liveness.

### 6.2 Data-model endpoints (read only, typed, bounded)

- Datasets: list, manifest, data dictionary, index status.
- Tables: schema with primary key, source system and provenance; foreign keys; sample rows paginated and parameterised through DuckDB with the table name validated against the schema registry.
- Records: one authoritative row with its graph node id and edge summary.
- Graph: schema (labels, relationship types, allow-list, weights, caps), stats (counts per label and per relationship kind, ingestion version), node with provenance, bounded neighbours.
- Ontology: version, concept tree with labels, synonyms, parents, binding counts per label and market; concept members.
- Scenarios: catalogue with planted status and planted row counts, no truth.
- Models: configured embedding and generation models and their reachability.
- Benchmarks: list, get, start, cancel; question metadata for Help (text, what it tests, stratum, scenario, expected answer, hidden truth narrative, per-pipeline scores) served from the published harness artefacts.
  The truth-ledger isolation test extends to assert that `app.retrieval` imports nothing from `app.evaluation` or `app.api`, and that question texts sent to pipelines carry no expected answer.

### 6.3 Robustness and structure

- Structured JSON logging with `experiment_id`, `run_id`, `question_id`, `pipeline`, stage timings, and no secrets.
- Neo4j errors map to `GRAPH_QUERY_ERROR`; driver and HTTP timeouts configured; retryable flags derived from error class.
- The service lock covers state mutation only; cold-start embedding happens outside it.
- Vector hits are handled identically in all pipelines (no silent drop of hits missing from the in-memory corpus).
- Ollama embeddings normalised and dimension-checked against the collection.
- Delete the empty packages (`domain`, `models`, `persistence`, `observability` as a package) or fill them with the real module; `ontology` is filled by 5.2.
- Merge the two configuration modules into one validated settings module; one repository root; one place for graph defaults.
- Move the A/B/C composition root to `app/lab.py`; move the trace CLI beside the other entry points.
- Split the graph pipeline `run()` into typed stages (resolve, traverse, rank and scope, select and attach facts, document channel, assemble and generate).
- Split ingestion into node-row and relationship-row builders; replace the quadratic list rebuild.
- Grounding becomes table-driven by binding key.
- Ingestion stats persist beside the dataset so the Data Model area works without live counts.

---

## 7. Workstream 3: Frontend as a SaaS product

### 7.1 Shell and navigation

Left sidebar with icons and five destinations.

| Destination | Purpose in one sentence |
|---|---|
| Overview | The verdict from the latest official run, how the three approaches differ, and a button to run a question |
| Live Lab | Run one question through all three approaches and watch them work |
| Results | Every official run, every question, every score, with intervals |
| Data Model | What the warehouse, the graph and the ontology look like, with live counts and sample rows |
| Help | How it works in plain language, every benchmark question with its answer key, glossary, how to run it |

Setup, Scenario Lab, Benchmark Runner and Evidence Explorer stop being pages.
Setup becomes a Settings drawer plus the Overview configuration strip.
Scenarios live in Data Model and Help.
Benchmark execution lives in Results.
Evidence is a drawer opened from any citation, evidence row or graph node.

The header carries only the product name, the active dataset, model status, presentation toggle and settings.
Seeds, versions and model identifiers live in Settings and in the Results reproducibility panel.

### 7.2 Visual language

- Light theme.
  White and near-white surfaces, one neutral grey scale with at least 4.5:1 for all text, borders at 3:1 or stronger.
- One fixed colour per pipeline used everywhere: A, B and C each have a hue, a tint for fills and a strong tone for lines and text.
  Evidence states (seed, traversed, candidate, selected, discarded, concept, source record) have distinct shape and icon as well as colour.
- Typography: Inter loaded, a defined scale (12, 14, 16, 20, 28, 40), tabular numerals for scores.
- Spacing on an 8 pixel grid; elevation by shadow only for drawers and menus; cards without borders where background contrast suffices.
- Icons from one icon set.
- Design tokens in `src/index.css` with the `@theme` mechanism kept and the values replaced.
- Charts follow the project's data visualisation guidance (see `dataviz` skill): consistent pipeline colours, no decorative gradients, deltas and intervals drawn, numbers labelled.

### 7.3 Overview

Opens on the verdict.

- Three large tiles, one per pipeline, with the headline metric from the latest official run and the interval.
- One generated headline sentence per hypothesis stratum.
- A pipeline flow diagram showing the shared steps and where B and C branch.
- A "Run a question" call to action and the four demo questions.
- If no official run exists, the tiles show the state plainly and link to Results to start one.

### 7.4 Live Lab

- Question bar with saved questions, market scope and source (recorded run or live backend) tucked into a secondary row.
- While running: three columns, one per pipeline, each with a stage tracker and a live evidence list, plus a large graph canvas showing B or C (tab) with the other's path available as an overlay.
  Pipeline C's canvas can highlight "what the ontology added" in C's colour.
- On completion: a verdict scorecard across the top with three columns, correct or not, evidence found, markets reached, latency, context size, deltas, and the one-line reason the harness produced for that question when the question is in the bank.
  For ad hoc questions the scorecard shows the measurable items only and states that no answer key exists.
- Below: three answer blocks with clickable citations, the evidence-path strip for B and C, and a market coverage matrix (markets by pipelines).
- Graph canvas: a real layout engine, legible labels at presentation distance, relationship names on edges, zoom and pan, focus mode that dims everything off the evidence path, clustering above a configurable visible-node cap, progressive expansion driven only by recorded events, keyboard reachable.
  Dependency decision: `@xyflow/react` with `elkjs` layered layout (my call; the builder may choose `d3-force` if layered layout proves worse for traversal shapes, but must keep DOM-rendered nodes for accessibility).
- Timeline: three tracks and a scrubber; rewind and replay from the recorded events; speed control.
- Evidence drawer: the actual record (row, chunk or node properties) first, its position on the evidence path, then provenance as metadata.
- The offline "recorded run" is a real run captured through the API and committed as a fixture; hand-written mock telemetry is removed.
- Presentation mode: hides navigation, enlarges type and canvas, step keys for play, pause and next, and a reset.

### 7.5 Results

- Run selector and run history; start a run from here (model choice, bank, repeats) with progress.
- Headline tiles with intervals; the harness headline sentences.
- Grouped bars per stratum with A, B and C distinguished and the delta drawn.
- Ontology-dependent split: B versus C on the `ontology_dependent` questions and on the rest.
- Per-question table: question, stratum, per-pipeline scores, judge scores, open the replay.
- Efficiency panel: latency and context tokens per pipeline, context efficiency.
- Failure classes as drill-ins.
- Reproducibility panel with every field of the record.

### 7.6 Data Model

Four tabs, all driven by the API.

- Warehouse: an entity-relationship map grouped by source system with live row counts; click a table for a paginated sample grid; click a row to follow it into the graph.
- Graph: a meta-graph of labels sized by count and typed edges labelled with counts; toggle between the retrieval allow-list and the full schema; click a label for properties and a sample node.
- Ontology: a tree on the left, a concept card in the centre (definition, four language labels, synonyms, allowed relationships), bound instances by market on the right, so "Αριθμολαχείο equals Zahlenlotto equals National Draw" is visible.
- Scenarios: the eight planted stories as cards with planted status and counts, linking to the Help narrative and to the questions that test them.

### 7.7 Help

Written for a business reader, in this order.

1. What we are testing, in three sentences and one diagram.
2. The three approaches, one card each with a plain name and a one-line definition.
3. The data: a short tour that links into Data Model.
4. The planted stories: each scenario as a short narrative with the hidden truth.
5. The questions: every benchmark question with its plain text, what it tests, its story, the expected answer, and how each pipeline scored in the latest official run.
   Filterable by stratum and story.
6. How scoring works: evidence found, correct answer, judge, intervals, one short section each.
7. Glossary: twelve terms, twelve words each.
8. Running it: bring-up, recovery table, model configuration.

Vendor and engineering names appear in section 8 and in the Data Model graph tab only.

### 7.8 Copy rules

- One name per pipeline, everywhere: "Text search", "Graph", "Graph + Ontology", always with the letter.
- Each screen opens with its purpose sentence and nothing else before the content.
- Product copy budget outside Help: about 1,200 words.
  Help budget: about 1,500 words plus the question table and scenario narratives.
- Numbers over adjectives.
  British spelling.
  No "honest", "never", "real", "fake", "prototype", "telemetry", "seed", "chunk", "rerank", "MAPS_TO" in product copy; the glossary terms replace them.
- The worked example (SCN-007) is told once, in Help, and linked from elsewhere.

### 7.9 States and accessibility

Every screen and every panel defines normal, loading, empty, error and disabled states.
Keyboard reach for every primary action, visible focus, focus trap in drawers, reduced-motion replay that jumps to end states, textual alternative for the graph (an ordered evidence path list).
Visual regression baselines regenerated on the owner's machine for every screen and state.

---

## 8. Workstream 4: Words and documentation

- Product copy rewritten under 7.8.
- Repository documentation reduced to ten primary files, with history archived under `docs/reference/` and thirty-one stub files deleted, following the tree proposed in the wording audit.
- `README.md` rewritten: what it is, headline numbers, how to run, map of the documents.
- `AGENTS.md` kept, deduplicated, precedence list completed, em dashes in headings replaced, HITL-12 model recorded.
- `HITL_STATUS.md` shortened to the table plus HITL-12 checkpoints.
- Each subsystem document explains purpose, architecture, operation, configuration, testing, extension points and failure modes, once.

---

## 9. Sequencing

1. Branch, world v2, ontology v2, scenarios, named rows and chunker (5.1 to 5.3).
2. Pipelines v2 and lab fairness tests (5.4).
3. Bank 2.0.0, grounding, scoring, judge, statistics, harness and smoke run (5.5).
4. Backend API: streaming, persistence, data-model endpoints, robustness (6).
   CP1.
5. Frontend foundation: tokens, shell, API client, graph canvas, chart primitives.
6. Overview, Live Lab, Data Model, Help; recorded real run fixture.
   CP2.
7. Results screen; copy pass; documentation cut.
8. Official run proposal.
   CP3, then run, publish, final Results, release record v0.2.0.

Workstreams 1 and 2 must complete before 3 builds screens, because every screen reads the live API.
Workstream 4 runs alongside 3.

---

## 10. Decisions already taken

| Decision | By |
|---|---|
| Show the truth; the outcome of the experiment is not predetermined | Owner |
| Mixed business and technical audience; plain language by default | Owner |
| Rebuild the world with market-local vocabularies and languages | Owner |
| LiteLLM with OpenRouter for official runs; Ollama locally; both by configuration | Owner |
| Light theme, projector friendly | Owner |
| No fixed date; sequence for quality | Owner |
| Help shows every question with its answer key and the hidden truth of each story | Owner |
| One design approval, three checkpoints | Owner |
| Pipeline names "Text search", "Graph", "Graph + Ontology" | Agent |
| A indexes serialised structured records; hybrid retrieval; cross-encoder rerank shared by all pipelines | Agent, from the methodology audit |
| `SIMILAR_TO` becomes an ontology artefact available to C only | Agent, from the data audit |
| Five navigation destinations; Setup, Scenario Lab, Benchmark Runner and Evidence Explorer cease to be pages | Agent, from the UX and wording audits |
| Graph canvas on `@xyflow/react` with `elkjs` | Agent |
| SQLite persistence per ADR-007 | Agent |
| Branch `overhaul/v2`, merge at each checkpoint | Agent |

---

## 10a. Decisions from the builder check (agent calls, 2026-10-18)

A reviewer read this document as a builder and asked seven questions.
The answers below are the agent's calls under the owner's approval of this document.

1. **Live scoring.**
   For a bank question run in Live Lab, the deterministic scorer scores the live answer after the run has finished and the results are frozen; the scorecard labels this "scored against the answer key".
   The LLM judge runs only in official runs.
   Isolation is enforced on `app.retrieval`, `app.graph`, `app.ontology`, `app.datasets` and `app.scenarios`; `app.api` may import `app.evaluation` for post-run scoring and for starting benchmark runs, and a test asserts scoring happens only after the run record is complete.
2. **Pipeline A and the planted clusters (H5).**
   The serialiser includes every device used by more than one player, every payment method used by more than one player (with its account list), and the players that take part in such a share.
   The per-question "fraud" relationship profile is removed; `USES` and `USES_PAYMENT` join the default allow-list for every question, bounded by the per-type and per-hop caps.
3. **Anchor form in bank 2.0.0.**
   Structural strata anchor on record ids.
   The ontology stratum has two labelled sub-strata: id-anchored questions that need cross-market concept reach, and local-language name-anchored questions that need term resolution.
   Headline H2 uses the id-anchored sub-stratum; the name-anchored one is reported as "entity resolution through the ontology".
4. **Shared versus market-local reference data.**
   Shared across markets: platforms, platform versions, suppliers, payment providers, channels, currencies, languages.
   Market-local: game families, categories, mechanics, incident types, support categories, player segments.
   SCN-007 and SCN-009 therefore stay graph stories; the ontology stratum comes from the local taxonomies.
5. **Scenario targets vary with the scenario seed.**
   Each injector draws its market, game, version or cluster from the scenario RNG among eligible candidates, within the structural constraints the scenario needs.
   Grounding follows the ledger per world.
   The game catalogue stays at 20 games.
6. **Official-run topology.**
   Official runs use the dev profile on three world seeds (2026, 2027, 2028), orchestrated sequentially by the harness CLI (regenerate, re-ingest, re-index per world), producing one run record with per-world sections and one aggregate `summary.json`.
   The presentation world for Live Lab and Data Model is dev seed 2026, so a replayed question matches the Results numbers for the same instance.
   The demo profile remains available for scale demonstrations but is not the official world.
7. **Depth sweep.**
   The H1 depth sweep is a separate run kind ("sweep"); headline tiles, the fairness pin and official cells use depth 2.
8. **Record blocks in the shared collection.**
   When B or C reaches a record through the graph and the document channel also returns its serialised block, the pipeline keeps one evidence slot for it with the structured-layer fact winning.

## 11. Left to the builder

- Exact serialiser wording for structured records (fixed once, published, frozen with the bank).
- Exact sparse retrieval and reranker models, subject to: multilingual, pinned, runs offline, identical for all pipelines.
- Exact rubric wording for the judge and its calibration procedure.
- Exact token scale, grey scale and pipeline hues within the contrast constraints.
- Chart library choice within the data visualisation guidance.
- Exact layout algorithm parameters, visible-node cap default and clustering rule.
- Exact SQLite schema and retention policy.
- Module boundaries inside the split pipeline and ingestion code.
- The order of Help sections 3 and 4 if testing with a reader suggests swapping them.

---

## 12. Risks

| Risk | Mitigation |
|---|---|
| After a fair comparison, graph or ontology shows little value on some strata | The product reports it per stratum with intervals; the Overview headline sentences are generated from the data, not written |
| New questions accidentally favour C | Every question must be answerable in principle by A from indexed text; the carriers are recorded per question and reviewed at CP1 |
| Term table or serialiser tuned to the bank | Both are built and frozen before grounding; isolation tests cover them |
| Judge bias | Blinded, randomised, length-capped, calibrated against deterministic checks, agreement published |
| Official run cost and duration | Estimated at CP3; the demo replays recorded runs and never depends on the run |
| Graph library performance at 200 nodes | Visible-node cap with clustering; measured in E2E |
| Scope | Checkpoints are the places to cut; nothing in 5.5 is cut, because it is the proof |
