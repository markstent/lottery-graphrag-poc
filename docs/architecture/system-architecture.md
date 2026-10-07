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
