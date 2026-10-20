# API and Event Contract Specification

## 1. Purpose

Define stable typed contracts between:

- frontend
- backend
- retrieval engines
- graph engine
- evaluation engine
- benchmark runner

Live visualisation must be driven by real backend events.

---

## 2. API Principles

- version endpoints
- typed request/response schemas
- no database objects exposed directly
- stable IDs
- explicit error types
- idempotency where appropriate
- structured telemetry
- no hidden truth in public APIs

Base path:

```text
/api/v1
```

---

## 3. Core Endpoints

### Experiments

```text
POST   /experiments
GET    /experiments/{experiment_id}
POST   /experiments/{experiment_id}/reset
```

### Datasets

```text
POST   /datasets/generate
GET    /datasets/{dataset_id}
GET    /datasets
```

### Scenarios

```text
GET    /scenarios
POST   /scenarios/validate
```

### Query execution

```text
POST   /queries
GET    /queries/{run_id}
GET    /queries/{run_id}/evidence
GET    /queries/{run_id}/events
GET    /queries/{run_id}/events/stream
```

### Benchmarks

```text
POST   /benchmarks
GET    /benchmarks/{benchmark_run_id}
POST   /benchmarks/{benchmark_run_id}/cancel
GET    /benchmarks/{benchmark_run_id}/results
```

### Models

```text
GET    /models
GET    /models/status
```

### Graph inspection

```text
GET    /graph/nodes/{node_id}
GET    /graph/evidence-paths/{run_id}
```

---

## 4. Query Request

```json
{
  "question": "Why did digital conversion fall in Greece?",
  "configurations": ["A", "B", "C"],
  "market_scope": ["GR"]
}
```

Unknown fields are refused with 422 `VALIDATION_ERROR`.
That includes the retired `profile` field (removed in Phase 4), so a client still sending it learns at once rather than having it silently ignored.

`market_scope` (optional; 2026-10-18) restricts retrieval to one or more
markets. Entries are two-letter codes (`UK`, `GR`, `AT`, `CZ`) or full ids
(`MKT_UK`); unknown markets are rejected with 422 and an empty list means
all markets. The scope is applied identically to every requested pipeline:

- the document channel performs the vector search *within* the scope (the
  top-k is computed over in-scope chunks only, never cropped afterwards);
  chunks and record blocks without a market are shared evidence and stay in
  scope;
- in pipelines B/C, structured evidence whose authoritative record carries a
  market outside the scope is discarded with the recorded reason
  `out_of_scope_market`; records without a market (platforms, versions,
  business concepts) are shared evidence and stay in scope, as in the
  document channel. A payment provider's market is its home market in both
  channels.

The accepted scope is echoed by `GET /queries/{run_id}` as `market_scope`
and recorded on the first event of every pipeline (`markets` payload field).

---

## 5. Query Response

`POST /queries` stores the run as `queued`, starts its worker and returns 202 at once:

```json
{
  "run_id": "RUN-0A1B2C3D4E5F",
  "status": "queued",
  "results_url": "/api/v1/queries/RUN-0A1B2C3D4E5F",
  "events_url": "/api/v1/queries/RUN-0A1B2C3D4E5F/events"
}
```

`GET /queries/{run_id}` reads the run store.
Each pipeline's result appears in `results` as soon as that pipeline finishes, so A is readable while C is still traversing:

```json
{
  "run_id": "RUN-0A1B2C3D4E5F",
  "kind": "live",
  "question": "Why did digital conversion fall in Greece?",
  "status": "running",
  "configurations": ["A", "B", "C"],
  "market_scope": ["MKT_GR"],
  "pipeline_status": {"A": "completed", "B": "running", "C": "pending"},
  "created_at": "2026-10-20T10:00:00.000000+00:00",
  "finished_at": null,
  "error": null,
  "results": {"A": {}}
}
```

Run `status` is `queued`, `running`, `completed`, `failed` or `cancelled`.
Each `pipeline_status` value is `pending`, `running`, `completed`, `failed`, `cancelled` or `skipped`.
Pipelines run in order A, B, C inside one worker thread per run; several runs may execute at once.
When a run fails or is cancelled, the pipeline that was running takes that outcome and the pipelines that never started are `skipped`.
`error` is the section 11 envelope for a failed or cancelled run (`CANCELLED`, retryable), and null otherwise.
A run the server was executing when it stopped is marked `failed` with `INTERRUPTED` at the next start-up.

### Run history and cancellation

```text
GET  /queries?limit=20&before=<cursor>&status=<status>
POST /queries/{run_id}/cancel
```

History lists runs newest first, as `{"runs": [...], "next_before": ...}` where each run is the summary above without `results`.
`limit` defaults to 20; a value above 100 is a 422, never a silent clamp.
`next_before` is the opaque cursor of the next page, or null on the last page; pass it back unchanged as `before`.
A malformed cursor is a 422 `VALIDATION_ERROR`.

Cancellation is cooperative.
`POST /queries/{run_id}/cancel` sets the run's cancel flag and returns 202 with the run summary; the running pipeline stops at its next event, finished pipelines keep their results, and the run ends `cancelled`.
The one exception is a pipeline that fails before its next event: the run then ends `failed` with the real error.
A 202 is decided before the run's final row is written, so a run whose end is already being written refuses the cancel with 409.
Cancelling a finished run is a 409 `VALIDATION_ERROR`; an unknown run is a 404 `NOT_FOUND`.

---

## 6. Event Transport

Prefer Server-Sent Events unless bidirectional runtime control requires WebSocket.

Event envelope, identical in replay and in the stream:

```json
{
  "event_id": "5f0c1d2e3a4b4c5d9e8f7a6b5c4d3e2f",
  "timestamp": "2026-01-01T10:00:00.123456+00:00",
  "run_id": "RUN-0A1B2C3D4E5F",
  "pipeline": "C",
  "event_type": "graph.relationship.traversed",
  "t_ms": 1234.5,
  "payload": {},
  "sequence": 12
}
```

Events must be ordered by `sequence`, which starts at 1 and has no gaps within a run.
Every event is written to the run store the moment it is emitted (ADR-007).

`event_id` is a unique opaque identifier (a UUID4 hex string) assigned when the event is emitted.
`timestamp` is the wall-clock emission time in ISO 8601 UTC (for example `2026-01-01T10:00:00.123456+00:00`); `t_ms` remains the monotonic offset used for replay timing.

`GET /queries/{run_id}/events/stream` serves the same stored events as server-sent events (`text/event-stream`, with `Cache-Control: no-cache` and `X-Accel-Buffering: no`).
Each event is one frame: `id: <sequence>`, `event: <event_type>`, then `data:` holding the envelope above as JSON.
The stream resumes after the sequence in the `Last-Event-ID` header, or else the `?after=` query parameter; the header wins when both are sent, and neither means from the first event.
A resume point that is not a non-negative integer is a 422 `VALIDATION_ERROR`, and an unknown run is a 404 `NOT_FOUND`, both before the stream opens.
While no new event arrives, a `: keep-alive` comment is sent every `SSE_HEARTBEAT_S` seconds (default 15).
The stream closes after the run's terminal event.
It also closes, with no further frame, when the run is no longer active and has no terminal event (its final write failed), and when the run store fails mid-stream; that failure is logged with the run id.

### Run lifecycle events

The worker brackets the pipelines' own events with lifecycle events:

```text
run.started
pipeline.started
pipeline.completed
pipeline.failed
pipeline.cancelled
run.completed
run.failed
run.cancelled
```

`run.*` events use the pipeline id `run`; `pipeline.*` events use the id of the pipeline they describe.
A run's first event is `run.started` and its last is exactly one terminal event: `run.completed`, `run.failed` or `run.cancelled`.
`pipeline.failed`, `pipeline.cancelled`, `run.failed` and `run.cancelled` carry the section 11 error envelope as their payload.
`pipeline.cancelled` appears only when a pipeline was running at the cancellation; a run cancelled between pipelines (or before the first) ends with `run.cancelled` alone.

---

## 7. Standard RAG Events

```text
rag.query.received
rag.embedding.started
rag.embedding.completed
rag.vector_search.started
rag.candidate.retrieved
rag.rerank.started
rag.candidate.reranked
rag.evidence.selected
rag.evidence.discarded
rag.context.assembled
rag.generation.started
rag.generation.completed
```

`rag.generation.completed` carries `model`, `latency_ms` and `context_tokens`, plus `verdict` (the parsed one-line verdict, empty when the model gave none) and `cited_blocks` (how many distinct shown context blocks the answer cites).
The answer contract is described in `docs/retrieval/standard-rag.md`.

Example:

```json
{
  "event_type": "rag.candidate.retrieved",
  "pipeline": "A",
  "payload": {
    "chunk_id": "CHUNK-0081",
    "document_id": "DOC-021",
    "similarity": 0.884,
    "rank": 2
  }
}
```

---

## 8. Graph Events

```text
graph.entity_resolution.started
graph.entity.resolved
graph.query.expanded
graph.seed.selected
graph.traversal.started
graph.node.discovered
graph.relationship.traversed
graph.ontology.expanded
graph.rerank.started
graph.candidate.reranked
graph.candidate.selected
graph.candidate.discarded
graph.evidence_path.completed
graph.context.assembled
graph.generation.started
graph.generation.completed
```

`graph.rerank.started` carries `candidates` (how many candidates the judge is handed) and `model`, like `rag.rerank.started`.

`graph.candidate.reranked` is emitted once per candidate the shared reranker judged, in reranked order, for graph nodes and documents alike.
It carries `candidate_id` (a node id or a chunk id), `kind` (`node`, `chunk` or `record`), `rerank_score` and `rank` (1-based position after judging).
It is the graph counterpart of `rag.candidate.reranked`; one judge scores both channels on the raw question (`docs/retrieval/context-budgeting.md`).

`graph.candidate.selected` and `graph.candidate.discarded` carry `rerank_score`, `null` when the candidate never reached the judge.
Node events also carry `node_id`, `score` (the graph composite score), `hops` and `seed`; selected node events add the `weight_*` score components.
Document events carry `chunk_id`, with `rank` on selection.
Discard reasons are `excluded_label` (a node whose label is never a structured candidate, such as a directly resolved Document seed), `out_of_scope_market`, `superseded_by_structured_fact` (a record block whose node is a structured candidate), `context_budget`, `slot_limit` and `duplicate`.

`graph.entity.resolved` carries `entity_id`, `node_label`, `origin`, `matched_text`, `via_concept` and the resolver's `confidence` (0 to 1).
A fallback seed (`origin` `vector_fallback`) has no resolver confidence: it carries the record hit's fused retrieval score as `fused_score` and no `confidence`.

`graph.seed.selected` is absent when no entity resolves and no record block matches the fallback search; a seed is never fabricated.

`graph.generation.completed` carries `model`, `latency_ms` and `context_tokens`, plus `verdict` (the parsed one-line verdict, empty when the model gave none) and `cited_blocks` (how many distinct shown context blocks the answer cites).
The answer contract is described in `docs/retrieval/standard-rag.md`.

Example:

```json
{
  "event_type": "graph.relationship.traversed",
  "pipeline": "C",
  "payload": {
    "from_id": "GAME_GR_01",
    "relationship_type": "RUNS_ON",
    "to_id": "PLT_APP_IOS",
    "to_label": "Platform",
    "hop": 1
  }
}
```

---

## 9. Ontology Events

> Implementation status (HITL-08): the retrieval pipeline currently emits the
> section 8 event `graph.ontology.expanded` for ontology expansion. This
> `ontology.concept.*` family is reserved for the Semantic Layer screens and
> is not yet emitted; the two sections will be reconciled when those screens
> are built. See `docs/retrieval/graph-rag.md`.

```text
ontology.term.mapped
ontology.concept.resolved
ontology.concept.expanded
ontology.equivalence.applied
```

Example:

```json
{
  "event_type": "ontology.concept.expanded",
  "pipeline": "C",
  "payload": {
    "source_entity_id": "GAME_GR_04",
    "concept_id": "CONCEPT_HIGH_FREQUENCY_GAME",
    "relation": "INSTANCE_OF"
  }
}
```

---

## 10. Evaluation Events

```text
evaluation.started
evaluation.metric.scored
evaluation.completed
```

Example:

```json
{
  "event_type": "evaluation.metric.scored",
  "payload": {
    "metric": "evidence_recall",
    "value": 0.92
  }
}
```

---

## 11. Error Events

Use explicit error classes.

```text
MODEL_ERROR
EMBEDDING_ERROR
VECTOR_RETRIEVAL_ERROR
GRAPH_QUERY_ERROR
ONTOLOGY_ERROR
CONTEXT_BUILD_ERROR
EVALUATION_ERROR
CONFIGURATION_ERROR
TIMEOUT_ERROR
```

Example:

```json
{
  "event_type": "run.failed",
  "pipeline": "run",
  "payload": {
    "error_code": "GRAPH_QUERY_ERROR",
    "message": "The graph database could not answer the query.",
    "retryable": true
  }
}
```

`run.failed` replaced the earlier `run.error` in Phase 4.
Do not expose secrets or stack traces to normal UI responses.
Each code has one curated message (`RUN_ERROR_MESSAGES` in `backend/app/api/errors.py`).
The exception's own text goes to the server log only, because wrapped library errors can name service URLs or quote provider responses.

---

## 12. Evidence Object

Common evidence schema:

```json
{
  "evidence_id": "EVD-001",
  "evidence_type": "DOCUMENT_CHUNK",
  "source_id": "CHUNK-0081",
  "source_system": "synthetic_document_store",
  "title": "March Mobile Release Review",
  "excerpt": "...",
  "market_id": "GR",
  "valid_from": "2026-03-01",
  "valid_to": null,
  "score": 0.91,
  "provenance": {}
}
```

Other evidence types:

```text
STRUCTURED_RECORD
GRAPH_NODE
GRAPH_RELATIONSHIP
GRAPH_PATH
DERIVED_METRIC
DOCUMENT_CHUNK
```

---

## 13. Graph Node DTO

```json
{
  "node_id": "GAME_GR_04",
  "node_type": "Game",
  "display_label": "Synthetic Game 04",
  "market_id": "GR",
  "visual_state": "candidate",
  "provenance": {
    "source_system": "synthetic_warehouse",
    "source_record_id": "GAME_GR_04"
  }
}
```

---

## 14. Graph Edge DTO

```json
{
  "edge_id": "EDGE-992",
  "source_id": "GAME_GR_04",
  "target_id": "PLATFORM_MOBILE_02",
  "relationship_type": "RUNS_ON",
  "visual_state": "traversed",
  "properties": {}
}
```

---

## 15. Replay

Persist enough events to reconstruct UI state.

Replay endpoint:

```text
GET /queries/{run_id}/events
```

Replay must use recorded event sequence rather than rerunning retrieval.

---

## 16. Benchmark Results DTO

Each question result:

```json
{
  "question_id": "Q-021",
  "configuration": "C",
  "metrics": {
    "correctness": 0.94,
    "evidence_precision": 0.88,
    "evidence_recall": 1.0,
    "grounding": 0.96,
    "latency_ms": 2680,
    "input_tokens": 4120,
    "output_tokens": 480
  },
  "failure_class": null
}
```

---

## 17. Versioning

All contracts must include schema versions where persisted.

Breaking changes require:

- API version change or compatibility layer
- frontend coordination
- migration notes
- tests

---

## 18. Testing

Contract tests must cover:

- request validation
- invalid config
- event ordering
- event schema
- graph replay
- error events
- truth-ledger non-exposure

---

## 19. HITL Gate

API contracts are part of **HITL-02 Architecture Approval** and **HITL-08 Retrieval Behaviour Approval**.

Do not freeze event contracts before reviewing real prototype traces.

---

## 20. Implementation status (HITL-11, 2026-10-09)

Implemented and covered by tests (`tests/test_api_queries.py` offline,
`tests/test_api_live.py` full A/B/C over HTTP):

```text
GET  /api/v1/health
POST /api/v1/queries          202; background execution; typed request
GET  /api/v1/queries/{run_id}        status + RagRunResult/GraphRunResult
GET  /api/v1/queries/{run_id}/events recorded sequence (replay source)
GET  /api/v1/demo/questions      fixed demo configuration
GET  /api/v1/benchmarks/latest   published harness output only
```

`GET /api/v1/benchmarks/latest` returns the newest official run of the whole bank, else the newest run of any kind with its label; the rule and the `summary.json` it serves are in `docs/evaluation/reproducibility.md`.

Superseded in Phase 4: runs, events and results are persisted in the SQLite run store (ADR-007), keeping the newest `RUN_RETENTION` live runs, rather than held in memory for the last 50 runs.
Phase 4 also adds `GET /api/v1/queries` (history) and `POST /api/v1/queries/{run_id}/cancel` (section 5), tested in `tests/test_api_runs.py`.

Reserved for later phases (not implemented): experiments, dataset and
scenario management, `GET /queries/{run_id}/evidence` (evidence is embedded
in the results DTO), and benchmark submission/cancel (the harness runs via
`make run-benchmark`; the API only publishes results).
