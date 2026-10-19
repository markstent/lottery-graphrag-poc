# System Architecture

## 1. Purpose

Define the component structure, data flows and storage boundaries for the POC. Detailed contracts live in `docs/07-api-event-spec.md`; data schemas in `docs/01`–`docs/03`; retrieval behaviour in `docs/retrieval/`.

## 2. Logical components

- React/TypeScript frontend (Vite)
- FastAPI backend, single process
- Experiment orchestrator (creates runs, executes pipelines, persists results)
- Standard RAG engine (configuration A)
- GraphRAG engine (configurations B and C)
- Neo4j semantic overlay
- Qdrant vector collection (shared by A/B/C for fairness, ADR-002)
- Structured data layer: Parquet datasets queried through DuckDB (ADR-006)
- Synthetic document corpus (text + chunks; chunks mirrored into Qdrant)
- Evaluation engine (isolated namespace; sole truth-ledger reader, ADR-008)
- Application database: SQLite for runs, events, evidence, results (ADR-007)
- Event stream: SSE with persisted replay (ADR-004, ADR-007)
- LiteLLM-compatible model gateway (ADR-003); Ollama local, OpenRouter remote, deterministic fake adapter for CI

## 3. Component diagram

```text
                    React / TypeScript (Vite)
                            |  REST + SSE
                        FastAPI (single process)
                            |
                +-----------+------------+
                |                      |
        Experiment Orchestrator    Event Recorder -> SQLite (events, runs, evidence, results)
                |                      |
    +-----------+----------+           |
    |           |          |       SSE hub -> UI live view
  RAG A      GraphRAG B   GraphRAG C
    |           |          |
    |      Neo4j overlay  Neo4j + ontology expansion
    |           |          |
    +-----+-----+----+-----+
          |          |
     Qdrant      DuckDB over Parquet (authoritative structured facts)
          |          |
          +----+-----+
               |
         Model gateway (LiteLLM): Ollama | OpenRouter | fake adapter (CI)
               |
          Evaluator (isolated; only reader of data/truth/)
```

## 4. Query run flow

1. `POST /api/v1/queries` validates the request and creates a run row (SQLite) with reproducibility metadata.
2. The orchestrator executes each requested configuration (A, B, C) as an in-process background task.
3. Each pipeline emits typed events (`rag.*`, `graph.*`, `ontology.*`) through a recorder that both persists them (ADR-007) and fans them out to the SSE hub.
4. Pipelines assemble context under the configured budget and call the model gateway. Final numeric claims are resolved against the DuckDB layer where the graph indicates a source record.
5. The evaluator scores answers and evidence against its own data (truth ledger only inside evaluation) and persists metrics.
6. The UI follows the run through SSE; `GET /queries/{run_id}/events` replays the stored sequence.

## 5. Storage layout

| Concern | Store | Location |
|---|---|---|
| Structured facts (authoritative) | Parquet + DuckDB | `data/generated/` |
| Document corpus and chunks | Parquet/JSON artefacts | `data/generated/` |
| Vector index | Qdrant collection | service (Compose volume) |
| Semantic entities, relationships, ontology, provenance | Neo4j | service (Compose volume) |
| Runs, events, evidence, results, reproducibility | SQLite | `data/app.db` |
| Evaluator-only scenario truth | JSON ledger | `data/truth/` (isolated, ADR-008) |

All of `data/` is gitignored; worlds are reproducible from seeds and configuration, not from checked-in artefacts.

## 6. Process model

One FastAPI process hosts the API, orchestrator, pipelines, recorder, SSE hub and evaluator. No message broker: the POC serves a single operator and presentation mode, so an in-process task queue is the minimum sufficient mechanism. Long pipeline stages remain async and emit events incrementally so the UI streams in real time. If multi-user or multi-experiment concurrency is ever required, this is the boundary to revisit first.

## 7. Configuration surface

- Environment (`.env`): model provider, endpoints, credentials, service URLs (see `.env.example`).
- Experiment configuration (per experiment, persisted with the run): dataset profile, world/scenario seeds, enabled scenarios, model and embedding identifiers, temperature, pipeline settings for A/B/C, context budgets, traversal limits (`max_hops`, relationship/node whitelists, candidate and evidence caps).
- Benchmark configuration: question bank version, scoring weights, judge settings (if used).

## 8. Fairness controls in the architecture

- One shared Qdrant collection and embedding model for A/B/C (ADR-002).
- One model gateway configuration for all pipelines within an experiment (ADR-003).
- Context budgets enforced in a shared assembly module, not per pipeline.
- The evaluator runs after retrieval completes and is the only component permitted to read the truth ledger (ADR-008).

## 9. Known risks and mitigations

| Risk | Mitigation |
|---|---|
| Demo-profile volumes (5m tickets) strain laptop generation/query | Dev profile is the default for engineering; Demo benchmark run is a deliberate, timed operation; DuckDB aggregation verified at Demo scale before Phase 10 |
| SSE buffered by proxies kills live animation | Direct localhost/first-hop deployment for presentations; heartbeat events keep connections warm |
| Local model quality variance across runs | Temperature 0, seeded generation, recorded model identifiers; CI uses deterministic fake adapters |
| SQLite write contention during long runs | Single writer (recorder) with WAL; events batched per stage |
| Evaluator/truth leakage | ADR-008 enforcement tests in CI; treat any failure as a critical defect |

## 10. Supersessions

- Repository layout: ADR-009 supersedes the master-specification §8 sketch.
- Structured store: ADR-006.
- Run/event/result persistence: ADR-007.

## 11. Final architecture explanation (HITL-11, as built)

The system is five layers over one synthetic enterprise world.

**Data layer.** A deterministic generator (`app/datasets`, profiles
tiny/dev/demo) produces a relational world in Parquet: master data, players
and devices, 5M-ticket activity at demo scale, marketing, operations and a
document corpus. Generation is seeded and byte-for-byte reproducible; all
planted patterns come from the scenario engine, which also writes the
evaluator-only truth ledger. Four scenarios are enabled
(SCN-002 shared devices, SCN-003 shared payment instruments, SCN-007
cross-market platform incident, SCN-015 document/record conflict).

**Semantic overlay (Neo4j).** The graph is an augmentation, not a
replacement: games, platforms, versions, incidents, documents, campaigns,
players and payment methods with bounded relationship types, each node
carrying provenance to its warehouse row. BusinessConcept nodes and
`MAPS_TO` edges form the ontology; cross-market equivalence lives as concept
bindings (for example one PLATFORM_INCIDENT concept binding the GR/AT/CZ
incidents of SCN-007). Traversal is bounded by configuration
(depth 2, per-hop and total node caps, evidence cap), never unbounded.

**Retrieval (three pipelines, one lab).** Pipeline A is a credible
conventional RAG: bge-m3 embeddings, one shared Qdrant collection, lexical
rerank, budgeted context. Pipelines B and C share every component with A and
each other; B is exactly C minus ontology traversal (`MAPS_TO` plus concept
seeds), a contract pinned by tests, so measured B/C differences isolate the
ontology layer. Every stage emits typed events into a sink; the events are
the only driver of UI visuals and the record used for replay.

**Model gateway.** One seam (`AnswerGenerator`) with a deterministic fake
for CI and a LiteLLM adapter for local or hosted models, selected by
configuration; temperature 0; citations are derived from the selected
context by the pipeline, never from model output.

**Evaluation.** Bank 2.0.0 (22 logical questions) is grounded
deterministically into each of three generated worlds and frozen with a hash;
scoring is deterministic (answer checks, evidence over discoveries, citation
metrics, failure class), with a blinded LLM judge reported beside it and
clustered paired statistics over the worlds (docs/evaluation/). The truth ledger is readable only by the evaluation
package, enforced by isolation tests; the public API cannot read it.

**Presentation surface (Phase 13, as built).** The API exposes versioned
endpoints for live query execution (`POST /queries` returning immediately,
background execution, `GET /queries/{id}` results, `GET /queries/{id}/events`
for replay from the recorded sequence), the fixed demo question set, and the
latest published benchmark summary. The frontend consumes the same event
contract for both the committed demo story and live backend runs; quality
metrics shown next to a live run come only from the published benchmark.

The experiment claims only what the comparison isolates: same world, same
question, same components, differing only in the graph/ontology overlay.
Where the graph wins (seedless questions, cross-market discovery, evidence
recall), the delta is attributable to the overlay; where it does not, the
harness reports that too.
