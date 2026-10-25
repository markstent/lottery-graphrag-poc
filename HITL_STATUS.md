# Human-in-the-Loop Status

| Gate | Status | Approval date | Notes |
|---|---|---|---|
| HITL-01 Product Scope | APPROVED | 2026-10-07 | Approved by project owner in session. |
| HITL-02 Architecture | APPROVED | 2026-10-07 | Approved by project owner in session. ADR-006..009 accepted. |
| HITL-03 Synthetic Data Model | APPROVED | 2026-10-07 | Approved by project owner in session. Dev dataset + generator accepted. |
| HITL-04 Ontology and Graph Model | APPROVED | 2026-10-07 | Approved by project owner ("APPROVE EVERYTHING"). |
| HITL-05 Scenario / Truth Ledger | APPROVED | 2026-10-07 | Standing blanket approval; scenario engine, 4 planted scenarios, ledger + isolation tests verified. |
| HITL-06 UX Information Architecture | APPROVED | 2026-10-07 | Standing blanket approval; IA, user flows, journeys, wireframes committed. |
| HITL-07 High-Fidelity UX Prototype | APPROVED | 2026-10-07 | Standing blanket approval; all seven IA screens implemented with mocked docs/reference/07 event telemetry, replay/rewind, presentation mode; visual baselines committed (frontend/e2e/visual.spec.ts-snapshots/); vitest 13, smoke e2e, tsc, oxlint, prettier, build green. |
| HITL-08 Retrieval Behaviour | APPROVED | 2026-10-08 | Standing blanket approval. Conventional RAG + GraphRAG B/C implemented with evidence tracking, traversal telemetry, context assembly; real side-by-side A/B/C traces for SCN-007/015/003 in docs/reference/retrieval/example-traces.md; specs docs/reference/retrieval/graph-rag.md + evidence-ranking.md; 17 offline + 4 live GraphRAG tests, truth-ledger isolation verified; known limitations recorded (see gate notes). |
| HITL-09 Benchmark / Scoring | APPROVED | 2026-10-08 | Standing blanket approval. 30-question bank grounded deterministically into the dev world (20 scored; 8 not planted, 2 not groundable, all reported); deterministic scoring (answer checks, evidence precision/recall, failure taxonomy); fairness by shared lab construction; harness + CLI with reproducibility record; demo profile enabled and timed. See gate notes. |
| HITL-10 Testing / Quality | APPROVED | 2026-10-09 | Standing blanket approval. CI green end to end (backend ruff/mypy/pytest with Neo4j+Qdrant services, frontend prettier/oxlint/tsc/vitest/build, Playwright smoke); three long-standing CI defects fixed (Neo4j health-check port, Qdrant image without shell tools, fixtures depending on machine-local ledger); test matrix + critical coverage report committed (docs/reference/testing/coverage.md); failure-mode tests added (gateway/embedder/store propagation; runner records generation_failure instead of crashing); B/C fairness contract pinned offline. See gate notes. |
| HITL-11 Presentation Readiness | APPROVED | 2026-10-09 | Standing blanket approval. Live backend wired: versioned query API (POST /queries background execution, results, recorded-event replay, fixed demo questions, published benchmark summary) per docs/reference/07 §20; frontend Live Lab runs real A/B/C executions against the demo world with Demo story / Live backend sources, loading/error/disabled states, honest evaluation (published benchmark scores only, never per-run fabrication); demo/reset/recovery operationalised (Makefile ingest-demo-graph, index-demo-vector, serve-demo-api, demo-reset) with separate Qdrant collection so demo never overwrites dev; demo script + recovery procedure (docs/reference/demo/presentation.md); final architecture explanation appended to docs/reference/architecture/system-architecture.md. See gate notes. |
| HITL-12 Overhaul v2 | APPROVED | 2026-10-18 | Design approved by project owner ("build it"): `docs/superpowers/specs/2026-10-18-overhaul-design.md`. Supersedes gates HITL-03 to HITL-09 for the v2 work. Checkpoints CP1 (experiment), CP2 (product), CP3 (official run) are recorded below as they are reached. |

Only the project owner may mark a gate `APPROVED`.

## HITL-12 checkpoints

| Checkpoint | Status | Date | Notes |
|---|---|---|---|
| CP1 Experiment (part 1: data layer) | APPROVED | 2026-10-19 | World v2, ontology v2, eight scenarios, graph model v2 and the B/C allow-list split delivered on `overhaul/v2` at 50196a4; approved by the project owner in session ("approve") with product names changed to generic terms (20fcb7e); merged to main. Pipelines v2, bank 2.0.0 and the harness follow as Phase 2 and 3 before CP1 closes. |
| CP1 Experiment (part 2: pipelines v2) | APPROVED | 2026-10-19 | Pipelines v2 delivered on `overhaul/v2` (branch head 42ce69e after the final review fix wave): hybrid retrieval with record blocks, one shared reranker as judge, one budget and slot cap, one prompt list in judge order, judge and model text limited to what A could index, structured answers. Decisions D-021 to D-028 (D-025 to D-028 are controller rulings open to the owner); fairness contract `backend/tests/test_lab_fairness.py`; live traces `docs/reference/retrieval/example-traces.md`. Approved by the project owner in session ("approve"); merged to main. Bank 2.0.0, judge and statistics follow as Phase 3 before CP1 closes. |
| CP1 Experiment (part 3: benchmark v2) | APPROVED | 2026-10-20 | Bank 2.0.0 (22 logical questions, hashed anchors frozen per world), deterministic answer, evidence and citation scoring, the blinded LLM judge, clustered paired statistics with Holm, `summary.json` v2, and the three-seed harness with the depth sweep and model comparison, on `overhaul/v2`. Docs: `docs/reference/evaluation/scoring.md`, `statistics.md`, `reproducibility.md`, `docs/reference/05-benchmark-spec.md` (as built). Decisions D-029 to D-032 are controller rulings, approved by the project owner with this checkpoint. Approved by the project owner in session ("approve") at branch head 3b6e0c0, after the final review fix wave; merged to main; the open owner questions below stand as built until the owner revisits them. Open owner questions: L16 and L17 expected sets include baseline players; L22 scores 0.5 when an answer also quotes the stale price; the cluster-level test (D-032). Known: the saved demo questions in `backend/app/api/queries.py` are stale v1 questions, replaced in the product phase; Results and Live Lab show a plain v2 notice until then. Owner items: `docs/reference/08-implementation-phases.md:226` and `docs/reference/product/product-requirements.md:24` still say "30-question" (original plan and requirements, left for the owner). Scorer smoke test `20261019T164733Z-smoke` (fake generator and judge, seeds 2026 to 2028): 150 instances (50 per world), none unavailable, presentation graph restored at 36,888 nodes. Local pilot `pilot-2026-nothink` (seed 2026, 2 instances per question, 3 repeats, 324 cells; qwen3.6 generator, gemma4:31b judge, `GENERATION_REASONING=off`, `JUDGE_REASONING=off`) is a subset and not a result: 0 generation and 0 judge failures, strict JSON contract 324 of 324, judge agreement 0.59 with kappa 0.18, 25.1 s per cell, so a full three-seed official run projects to about 9.5 hours. Finding for CP3 from the first pilot `pilot-2026` (reasoning on): thinking models spend the token caps on hidden reasoning and return empty answers (159 of 198 generations, every judge call). |
| Phase 4 Product API | BUILT | 2026-10-20 | The backend as a product API on `overhaul/v2`: run store, event stream with resume, cancellation, readiness, Data Model, graph, ontology, scenario, model and benchmark routes, live scoring of bank questions, benchmark jobs, and the live end-to-end test (`tests/test_api_live.py`); described in `docs/reference/07-api-event-spec.md`, decisions D-033 to D-038 (proposed). No checkpoint: CP2 follows Phases 5 and 6. Owner items for CP2: (1) `ConceptOut.relationships` is derived from ingestion; should the ontology declare its allowed relationships, as `docs/reference/03` asks? (2) The Help screen's DEMO-01..04 table and story chips in `docs/ux` are stale until Phase 6, because the demo questions are now the first bank instance of H1, H2, H3 and H5 (D-036). |
| Phase 5 Frontend foundation | BUILT | 2026-10-23 | The five-destination shell, light design system, typed API client and run stream, replayable run state, graph canvas, chart primitives, evidence drawer, presentation mode, copy rules and visual baselines on `overhaul/v2`, decisions D-039 to D-045. No checkpoint: CP2 follows Phase 6. For CP2 the owner should look at: (1) the default fit frames the evidence path, not the whole graph, with an out-of-view note for what falls outside; (2) the replay layout comes from the final graph, because positions are known before events (the path is still drawn only after its event); (3) the visible-node cap of 24 is a legibility choice, set from a 14 px label floor; (4) the StatTile hero uses tabular numerals, as spec 7.2 requires, which overrides the dataviz anti-pattern. Phase 6 items: wire `nodeCap` into the Live Lab canvas; an off-screen indicator for evidence nodes is already built, so check it in Live Lab; the ontology overlay compares C against B at the same cursor; remove the v1 views, mocks and `src/api/backend-run.ts`; rewrite `docs/reference/ux/screen-specifications.md`. |
| Phase 6 Product screens | BUILT | 2026-10-24 | Overview, Live Lab, Data Model (Warehouse, Graph, Ontology, Scenarios tabs) and Help (eight sections) are built on the live API on `overhaul/v2`, with a stopgap Results list (the full Results screen is Phase 7). Live Lab runs a question through A, B and C from a recorded run or live, with a graph canvas, three approach panels, a docked timeline, a scorecard, answers with citations, evidence paths and a market coverage table. The first-version views, mocks and `backend-run.ts` are removed. Four real runs are recorded as fixtures. Decisions D-046 to D-059 are proposed. `docs/reference/ux/screen-specifications.md` is rewritten as built. Gates at this commit: see the CP2 package below. |
| CP2 Product | APPROVED | 2026-10-24 | Approved by the project owner in session ("approve") at branch head 76df299, with the package below as presented and no changes requested; merged to main. Decisions D-033 to D-059 are controller rulings, approved with this checkpoint. The open owner questions below stand as built until the owner revisits them; question 1 (D-025 and how the graph's selection reaches the prompt) is a method question to settle before CP3. Phase 7 (the full Results screen, the documentation cut and the copy pass) may start. |
| CP3 Official run | PENDING | | model and cost choice, dry run, then official run and Results |

## CP2 package (presented 2026-10-24, approved 2026-10-24)

The project owner approved this package as presented on 2026-10-24.
The rulings it names are approved in `DECISIONS.md`; the open questions stand as built until the owner revisits them.

### Where to look

- Screenshots: `frontend/e2e/visual.spec.ts-snapshots/`.
  `docs/reference/ux/screen-specifications.md` names the baseline for each state of each screen.
- Baselines whose names contain `fixture-official` show test fixture numbers and headlines, not results.
  No full official run exists yet, so those screens are drawn from a made-up test run.
  Its counts agree with the question bank and its headlines are neutral, but none of it is a measurement.
  The baselines are `overview-fixture-official`, `presentation-overview-fixture-official`, `presentation-help-fixture-official` and `help-questions-fixture-official-filtered-by-story`.
- Recorded runs: `frontend/src/run/fixtures/recorded/`, four runs, one for each of H1, H2, H3 and H5.
  Open one in Live Lab with `#/live-lab?question=<instance id>`, or from the saved questions on Overview.
- Running it: `README.md`, "Run the demo", names the five screens and their links.

### The four recorded runs

They are live captures through the API on the presentation dev world (`dev-seed2026`), with the answer model qwen3.6 through Ollama with reasoning off, all three approaches completed.
They are not edited, and the demo questions were not re-picked to make a better story.

| Question | Kind | A answer / evidence score | B answer / evidence score | C answer / evidence score |
|---|---|---|---|---|
| L05, incidents on the same platform version as INC_037 | H1 multi-hop | 0.00 / 0.00 | 0.00 / 0.00 | 0.00 / 0.00 |
| L09, games in other markets of the same kind as GAME_AT_05 | H2 ontology-dependent | 0.40 / 0.35 | 0.50 / 0.14 | 0.50 / 0.14 |
| L01, ticket price of GAME_AT_04 | H3 single fact | 1.00 / no score | 1.00 / no score | 1.00 / no score |
| L15, cause of INC_041 | H5 planted pattern | 0.00 / 0.15 | 0.00 / 0.15 | 0.00 / 0.15 |

The honest result is that on these four questions B and C did no better than A.
B and C are level with A on three of the four.
On the ontology question B and C wrote a slightly better answer (0.50 against 0.40) while finding less of the needed evidence (0.14 against 0.35).
C's scores equal B's on every question (the L05 answer texts differ).
The single fact (H3) has no evidence score because it has no claims to find.

Why, in plain words, for the multi-hop question (L05):
B's graph search did find the right records.
Its selection held the incident INC_037, the platform record, and INC_024, the record that carries the claim the answer needs.
But all three approaches choose what the model sees through one shared re-ranker over the graph results and the document search together (D-025, approved at CP1).
Only 4 items reached the prompt: INC_037 and three support cases.
INC_024 did not, so the model said "the sources do not contain" the answer.
This is the designed behaviour and not a bug.
Neither the rule nor the demo questions were changed, because that would favour one approach.
What to do about it is an owner decision, listed under the open questions.

### Owner items

Each is one line, with where to look.

1. `ConceptOut.relationships` is derived from ingestion (IS_A, MAPS_TO) and the ontology declares no allowed relationships, although `docs/reference/03` line 476 asks for it. Data Model, Ontology tab, concept card.
2. Overview tiles show no interval for one approach, because `docs/reference/evaluation/statistics.md` defines intervals for differences only, while spec 7.3 says tiles carry "the interval". Overview; D-048.
3. Live Lab layout: graph on the left, the three approach panels on the right, a collapsed question bar, a compact scorecard and a docked timeline. Live Lab baselines; D-046.
4. "Evidence score" (0 to 1, two decimals, signed deltas) and "Answer writing time" are the names on Overview, Live Lab and Help. Overview, Live Lab, Help "How scoring works"; D-047.
5. In a replay, the layout comes from the final graph with the evidence path placed first in each layer, so the future path sits at the top of each layer before its event (nothing is styled as on the path until the event). `live-lab-h1-mid-replay-paused`; D-049.
6. The default fit frames the evidence path and the first starting point at a 14 px label floor, with an "out of view" note, and six of the eight recorded end states are larger than the frame. `live-lab-h1-end-b`, `live-lab-h1-end-c`; D-050.
7. The visible-node cap of 24 is a legibility choice from the 14 px floor, and Settings allows 12 to 60. Settings drawer; D-043.
8. The stat tile hero uses tabular numerals, as spec 7.2 asks, which overrides the dataviz anti-pattern. Overview tiles.
9. The overlay of the other approach's path needs the run's results, so it is off during a live run (the event carries counts only). Live Lab canvas toolbar; D-051.
10. The ontology highlight on C marks only nodes C records as found through the ontology that B lacks at the same point of the run. `live-lab-h1-end-c`; D-052.
11. Copy cuts: about 100 words of helper prose were cut to reach 1,200 words outside Help, with a before and after table in `.superpowers/sdd/2026-10-23-phase6-screens/task-9-report.md`. The budget counts visible text only and has no margin left. D-055.
12. The Data Model full meta-graph has 24 connected labels and is dense, and a per-label neighbourhood map is proposed. `data-model-graph-full`.
13. The warehouse map is one 27-table group, because the real data dictionary has one source system. `data-model-warehouse-map`.
14. Help has no A/B/C walk-through of the SCN-007 worked example, because no recorded run covers SCN-007. Help, "The planted stories".
15. Help's recovery table omits `make demo-reset`, because which world is the presentation world is not settled (`DATASET_DIR` defines it). Help, "Running it".
16. Results is a stopgap list, and its purpose sentence promises more than it shows. Phase 7 builds the rest. Results.
17. Recorded runs show no graph advantage, for the reason above (D-025). Live Lab with the four recordings.
18. Small known gaps: the replay slider can read just below its end at the end of a run, the Overview and Help flow diagram does not grow in presentation mode, the evidence drawer's group list is fixed when opened while a replay plays, the idle approach panels are about 30 px shorter than running ones, the Data Model e2e fixture is 4.2 MB, and `recorded.ts` casts the fixtures without validating event types.
19. Decisions D-033 to D-059 were proposed at presentation and are approved with CP2, including the LiteLLM load fix (D-059) and the two API additions for Data Model (D-058). `DECISIONS.md`.

### Open questions for the owner

1. Is the D-025 shared re-ranker still what you want, given that it kept the claim record out of the prompt on the multi-hop question? Options sit with CP2 and CP3: keep it, or change how the graph's selection reaches the prompt (a method change that needs your approval before an official run).
2. Should Overview tiles gain a per-approach interval (a new field in `summary.json`), or stay as built, with intervals on differences only?
3. Should the ontology declare its allowed relationships, as `docs/reference/03` asks, or keep the derived field?
4. Do you accept the Live Lab layout and the replay and fit behaviour (items 3, 5, 6 and 9)?
5. Which world is the presentation world, and should Help's recovery steps include `make demo-reset`?
6. Do you want a per-label neighbourhood map in the Graph tab in place of, or beside, the dense full map?
7. Is a copy budget with no margin at 1,200 words acceptable, or should the cap move?
8. May Phase 7 (the full Results screen, the documentation cut and the copy pass) start after CP2?

Phase 2 (pipelines v2) is built on branch `overhaul/v2` and presented as CP1 part 2, 2026-10-19; Phase 3 (question bank 2.0.0, the answer judge and the statistics) was approved as CP1 part 3 on 2026-10-20, which closes CP1; the product phases toward CP2 follow.

On 2026-10-07 the project owner issued a blanket approval ("APPROVE EVERYTHING"),
authorising continuous progression through the remaining gates without
individual pauses. Each gate is still marked `APPROVED` only once its phase
artefacts exist and all checks pass, under this standing approval.

## HITL-08 notes (2026-10-08)

Artefacts: pipelines A/B/C (`app/retrieval/standard`, `app/retrieval/graph`),
evidence tracking with per-candidate components and discard reasons,
traversal telemetry on the docs/reference/07 section 8 event names, shared context
assembly, side-by-side trace CLI (`app/retrieval/graph/traces.py`; note: moved to `app/traces.py` in Phase 4), three
captured traces with real retrieval telemetry and local-model generation
(`docs/reference/retrieval/example-traces.md`).

Key implementation decisions (documented in the retrieval specs): traversal
covers the structured-record subgraph; documents stay in the shared vector
channel for all pipelines; budget cuts are relationship-strength ordered, not
alphabetical; evidence scores use bottleneck path strength; B equals C minus
the ontology relationships and concept seeds.

Residual risks and known limitations:

- With generous traversal budgets the version-edge path often ranks ontology
  expansion redundant for SCN-007; the ontology's demonstrated value is
  robustness (seeding + concept expansion when structural edges are absent or
  cut) rather than large score deltas. The benchmark (HITL-09) must quantify
  this honestly rather than assume a large C advantage.
- `DOC_S007_UK` has no structural path within the allow-list; its content is
  covered through the shared vector channel, and document-level recall is
  scored via chunk `document_id` in Phase 10.
- Node evidence (12 slots) trades precision for story recall on incident
  questions; UK incidents intentionally rank into the selected set for the
  "why was the UK unaffected" contrast.

## HITL-09 notes (2026-10-08)

Artefacts: benchmark bank with version constant (`app/evaluation/bank.py`),
deterministic grounding (`app/evaluation/grounding.py`), deterministic
scoring + failure taxonomy (`app/evaluation/scoring.py`), shared A/B/C lab
construction (`app/retrieval/graph/lab.py`, also used by the trace CLI;
note: moved to `app/lab.py` in Phase 4, and the trace CLI to `app/traces.py`),
benchmark harness + CLI with reproducibility record
(`app/evaluation/runner.py`, `app/evaluation/__main__.py`), report renderer
(`app/evaluation/report.py`). Evaluation docs updated: scoring.md
(implementation mapping, LLM-as-judge explicitly deferred), reproducibility.md
(persisted record), question-bank.md (grounding rules and world status).
Demo dataset profile enabled for generation (HITL-03 scaling approval) with
a separate evaluator ledger required, so demo worlds cannot overwrite the
development truth ledger.

Validation artefact: `docs/reference/evaluation/harness-validation.md` holds verbatim
reports for the full-bank fake-generator run and a real-model subset
(Q01/Q25/Q28/Q30 on a local Qwen via the gateway, temperature 0), plus the
demo-profile performance verification. That verification found and fixed a
generator scaling defect (quadratic cumulative-weight rebuild in
`generate_exposures`; dev world regenerates bit-for-bit after the fix) and a
profile inconsistency (all profiles now expect the canonical 20-game
catalogue). Demo profile (5M tickets, 2M sessions, 3M exposures) generates
from scratch in ~100s. Real-model subset: B/C mean answer 0.66 vs A 0.41,
evidence recall 0.65 vs 0.04.

Fairness controls: all pipelines are built from one lab (same embedder
instance, same vector store, same corpus, same reranker, same generator,
same context budget); B is exactly C minus `MAPS_TO` and concept seeds;
the fraud profile for Q28 adds the same two relationship types to B and C.
Question text is identical across pipelines; expected answers and required
evidence live only in the evaluation package (isolation tests extended in
Phase 5 still guard the boundary).

Scoring is deterministic: answer checks (number with decimal normalisation,
word-boundary token, set recall), evidence precision/recall against grounded
required evidence (nodes plus cited chunk `document_id`s), and a failure
taxonomy derived from retrieval telemetry. LLM-as-judge is deliberately not
used; docs/reference/evaluation/scoring.md records the rule that a later judge must be
versioned and identified per result.

Benchmark status in the development world: 20 of 30 questions scored; 8 map
to scenarios that are not planted (SCN-001/004/005/006/008/011/013) and are
reported, never scored; Q06 and Q15 do not ground because the world contains
no support summaries discussing the selected game's payment incidents and no
shared mechanics across the selected campaign's games.

Residual risks and known limitations:

- Set-valued questions grade recall over the full expected set (up to 27
  incidents), which is demanding against the fixed 8-slot evidence budget;
  budgets are identical across pipelines so the comparison is fair, but
  absolute recall on those questions is bounded low by design.
- The harness validation run uses the deterministic fake generator, so
  answer-correctness scores in that report exercise the scorer, not a model.
  The committed real-model subset (docs/reference/evaluation/harness-validation.md)
  provides answer-quality evidence on four scenario questions; a full
  official 30x3 real-model run is presentation-phase work (HITL-11), not
  needed to approve the methodology.
- With the fake generator the answer checks score near zero by construction;
  evidence recall is the discriminating metric in the committed validation
  report (B/C = 1.0 vs A = 0.0 on graph questions such as Q01/Q04/Q09/Q16/Q26).
- Q28 evidence recall is bounded (~0.29 for B/C): traversal reaches a subset
  of both planted clusters within the evidence budget; the metric still
  separates pipelines cleanly (A = 0.0).

## HITL-10 notes (2026-10-09)

Artefacts: test matrix and critical coverage report
(docs/reference/testing/coverage.md); failure-mode tests
(backend/tests/test_failure_modes.py: gateway, embedder and vector-store
failures propagate out of both pipelines; no fabricated success); runner
resilience (a gateway error inside an official benchmark run is recorded per
question as generation_failure instead of aborting the run; infrastructure
errors still fail loudly); B/C fairness contract pinned offline
(backend/tests/test_lab_fairness.py via the extracted bc_graph_settings seam
in app/retrieval/graph/lab.py; note: moved to app/lab.py in Phase 4).

CI defects found and fixed (first green run: 2026-10-09, run 37889425239):
(1) the Neo4j service health check probed HTTP port 7474 while only Bolt
(7687) was published, failing every backend job at container initialisation
(Phase 8-10 runs); (2) the Qdrant image ships no shell tools, so its
wget-based health command could never succeed; readiness is now polled with
curl from a workflow step; (3) the Phase 10 grounding and live benchmark
fixtures resolved the machine-local development ledger, which does not exist
in a fresh checkout; fixtures now generate a deterministic tiny ledger from
a second scenario-planted world, and BenchmarkRunner takes an optional
ledger_path (also the seam for future demo-world runs).

Verified locally at this commit: backend 127 passed + 16 live tests
(GRAPH_E2E/VECTOR_E2E) green against real Neo4j/Qdrant; ruff, ruff format,
mypy strict clean; frontend prettier/oxlint/tsc/vitest (13)/build green;
Playwright smoke green; 5 visual baselines green on the owning machine. Dev
graph re-ingested after live tests.

Residual gaps (recorded in docs/reference/testing/coverage.md): no automated
performance gates (timings recorded, not enforced); frontend unit coverage
deliberately thin until presentation mode defines the components; visual
regression is owner-machine only; single-browser E2E.

## HITL-11 - Presentation Readiness (approved 2026-10-09)

Delivered at this commit:

- **Query API (docs/reference/07 §20).** `POST /api/v1/queries` accepts a typed
  request, returns 202 immediately and executes the selected pipelines in a
  worker thread; `GET /queries/{id}` returns status plus the typed
  RagRunResult/GraphRunResult records; `GET /queries/{id}/events` returns
  the recorded sequence for replay (never re-execution). Failures map to
  docs/reference/07 §11 error classes (GenerationError→MODEL_ERROR etc.) and emit a
  run.error event; the store keeps the last 50 runs of the process.
  Contract tests: 11 offline (validation, lifecycle, ordering, replay
  identity, 404s, error mapping, demo questions, benchmark 404/publish) + 1
  live full A/B/C run over HTTP.
- **Demo configuration.** Fixed saved questions (DEMO-01..04, mirroring
  published bank questions Q30/Q25/Q28 plus one unplanted) served by
  `GET /api/v1/demo/questions`; question texts are pipeline-visible only.
- **Frontend wiring.** `src/api/backend-run.ts` maps recorded backend
  events + result DTOs onto the approved MockRun playback shape; Live Lab
  gains a Demo story / Live backend source toggle with loading, error and
  disabled states. Evaluation metrics shown next to a live run come only
  from the published benchmark for the matched question; runs without a
  published result keep the strip in its waiting state. The Results
  Dashboard consumes the latest published run (`GET /api/v1/benchmarks/latest`,
  now backed by the harness's own `summary.json` aggregate, so no client-side
  re-computation); with no published run it shows the committed validation
  run labelled as such, hides sections without a bank dimension, and marks
  unscored questions "not scored" (docs/reference/ux/screen-specifications.md §6
  live-data note). Vitest 22, tsc, oxlint, prettier, build, smoke e2e and
  all 5 visual baselines green.
- **Demo operations.** `make ingest-demo-graph`, `index-demo-vector`,
  `serve-demo-api` (demo world + separate `semantic_context_lab_demo`
  Qdrant collection) and `make demo-reset`; demo run verified end to end
  (DEMO-02 over the API: A 8 chunks, B 103 nodes, C 129 nodes + ontology
  expansion, 757 recorded events). Vector store upsert now batches (256)
  after the demo corpus (2,905 chunks) exceeded the single-call client
  timeout; covered by VECTOR_E2E in CI.
- **Documents.** Demo script and recovery procedures
  (docs/reference/demo/presentation.md); final architecture explanation appended to
  docs/reference/architecture/system-architecture.md §11; API implementation status
  recorded in docs/reference/07 §20.

- **Benchmark aggregation.** The harness now writes `summary.json` next to
  `results.json` and `report.md`, produced by one `summarize()` policy
  shared with the markdown report; the API and dashboard publish that
  aggregate unchanged.

Verified locally at this commit: backend 139 passed offline + 10 live
(GRAPH_E2E) green, ruff/ruff format/mypy strict clean; frontend stack green
as above; demo state restored after live tests (make demo-reset).

Residual gaps: replay events are in-memory (bounded, process lifetime);
`GET /queries/{id}/evidence` and SSE progressive delivery intentionally
deferred (docs/reference/07 §20); benchmark execution stays a CLI operation, the API
only publishes results; presentation-state run history does not survive an
API restart (regenerating state is one demo-reset).
