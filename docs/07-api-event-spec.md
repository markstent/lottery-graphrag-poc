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
- no hidden truth in the live query surface (see below)

Hidden truth and the answer key:

- The owner decided on 2026-10-18 that the Help screen shows each bank question's answer key and, for a planted scenario, its hidden truth.
- `GET /benchmarks/questions` is the only route that serves them, both read from evaluator output (`app.evaluation`) after the fact.
- No live query route, event, stream frame or log record carries an expected answer or a hidden truth, and no retrieval pipeline can reach either (ADR-008).
- The truth ledger itself is never read or exposed by an API route.

Base path:

```text
/api/v1
```

---

## 3. Core Endpoints

Every route is under `/api/v1`.
This table is the route list as built; it matches the application's OpenAPI schema (`create_app().openapi()`), and each route is described in the section named in the last column.

| Method | Path | Response | Described in |
|---|---|---|---|
| GET | `/health` | `HealthResponse {status, version}` | section 20, "Health and readiness" |
| GET | `/health/ready` | `Readiness {ready, checks}` (503 when a check fails) | section 20, "Health and readiness" |
| POST | `/queries` | `QueryAccepted` (202) | sections 4 and 5 |
| GET | `/queries` | `RunHistory` | section 5, "Run history and cancellation" |
| GET | `/queries/{run_id}` | `QueryResults` | section 5 |
| POST | `/queries/{run_id}/cancel` | `RunSummary` (202) | section 5, "Run history and cancellation" |
| GET | `/queries/{run_id}/events` | `EventStream` | section 15 |
| GET | `/queries/{run_id}/events/stream` | server-sent events | section 6 |
| GET | `/demo/questions` | `list[DemoQuestion]` | section 5, "Bank questions and live scoring" |
| GET | `/benchmarks` | `list[BenchmarkRunOut]` | section 20, "Benchmark reads" |
| GET | `/benchmarks/latest` | `BenchmarkSummary` | section 20, "Benchmark reads" |
| GET | `/benchmarks/questions` | `list[QuestionOut]` | section 20, "Benchmark reads" |
| GET | `/benchmarks/{run_id}` | `BenchmarkSummary` | section 20, "Benchmark reads" |
| POST | `/benchmarks` | `BenchmarkJob` (202) | section 20, "Benchmark jobs and the shared graph" |
| GET | `/benchmarks/jobs/{job_id}` | `BenchmarkJob` | section 20, "Benchmark jobs and the shared graph" |
| POST | `/benchmarks/jobs/{job_id}/cancel` | `BenchmarkJob` (202) | section 20, "Benchmark jobs and the shared graph" |
| GET | `/datasets` | `list[DatasetSummary]` | section 20, "Data Model reads" |
| GET | `/datasets/{dataset_id}` | `DatasetDetail` | section 20, "Data Model reads" |
| GET | `/datasets/{dataset_id}/dictionary` | `list[TableSchemaOut]` | section 20, "Data Model reads" |
| GET | `/datasets/{dataset_id}/tables/{table}/rows` | `RowPage` | section 20, "Data Model reads" |
| GET | `/datasets/{dataset_id}/tables/{table}/rows/{row_id}` | `RecordOut` | section 20, "Data Model reads" |
| GET | `/graph/schema` | `GraphSchema` | section 20, "Graph reads" |
| GET | `/graph/stats` | `GraphStats` | section 20, "Graph reads" |
| GET | `/graph/nodes/{node_id}` | `NodeOut` | section 20, "Graph reads" |
| GET | `/graph/nodes/{node_id}/neighbours` | `Neighbours` | section 20, "Graph reads" |
| GET | `/ontology` | `OntologyOut` | section 20, "Reference reads" |
| GET | `/ontology/concepts/{concept_id}/members` | `list[MemberOut]` | section 20, "Reference reads" |
| GET | `/scenarios` | `list[ScenarioOut]` | section 20, "Reference reads" |
| GET | `/models` | `ModelsOut` | section 20, "Reference reads" |

Errors, statuses and bounds common to all routes are in section 11 and section 21.
The routes the first design listed and the build does not have are named at the end of section 20.

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
Cancelling a finished run is a 409 `CONFLICT`; an unknown run is a 404 `NOT_FOUND`.

### Bank questions and live scoring (Phase 4)

```json
{"benchmark_instance_id": "L05-2026-INC_S007_GR", "configurations": ["A", "B", "C"]}
```

`benchmark_instance_id` names an instance of the presentation world's frozen bank (`make ground-bank`; the bank is named after the dataset directory, and `make ground-demo-bank` grounds the demo world).
The run asks that instance's text: every pipeline receives the instance text and nothing else, never its expected answer, checks or claims.
`question` may then be left out; when it is sent it must equal the instance text, otherwise the request is a 422 `VALIDATION_ERROR` "a bank question runs with its own text".
An id the bank does not hold is a 422 `VALIDATION_ERROR`, and before the bank is grounded, or when it is not current for the active world, the request is a 503 `CONFIGURATION_ERROR` (section 20, "Benchmark reads").
A request with neither `question` nor `benchmark_instance_id` is a 422.
A bank question runs with the instance's own market scope, or unscoped when the instance has none (every bank 2.0.0 instance), so a live score always matches the benchmark's; a request `market_scope` that differs is a 422 `VALIDATION_ERROR` "a bank question runs with its own scope".

`GET /queries/{run_id}` adds four fields to the run:

```json
{
  "benchmark_instance_id": "L05-2026-INC_S007_GR",
  "answer_key": "available",
  "score_status": "scored",
  "score": {
    "instance_id": "L05-2026-INC_S007_GR",
    "label": "scored against the answer key",
    "per_pipeline": {
      "A": {"answer": 1.0, "evidence_f1": 0.5, "anchor_resolution": 1.0, "failure_class": null}
    }
  }
}
```

`answer_key` is `"none"` for an ad hoc question, which is never scored and always has `score: null`, and `"available"` for a bank question.
A bank question is scored once its run has completed: after the terminal event and the final row are stored, the worker scores the stored results with the benchmark runner's deterministic scorer (`app.evaluation.runner.score_pipeline_run`) and stores the score before the run is retired (spec 10a.1).
A live score therefore equals the deterministic part of what the benchmark runner computes for the same pipeline results; the LLM judge runs only in official runs.
`anchor_resolution` is 1.0 or 0.0, read from the selection alone for pipeline A, which resolves no entities.
A metric the instance does not define (evidence F1 when no claim survives anchor exclusion) is null.
`score_status` says where the score stands:

- `not_applicable`: an ad hoc question, or a run that was cancelled or failed (neither is scored);
- `pending`: a completed bank question whose score is not stored yet; it follows the final status by a few milliseconds, so a client polls briefly (Live Lab gives up after 2 s);
- `scored`: `score` is set;
- `failed`: scoring raised; the error is logged, `score` stays null and the run stays `completed`.
- `failed` with `score_failure: "interrupted"`: the server stopped between the run's final row and its score; the next start-up records it (beside marking unfinished runs `INTERRUPTED`), so no run stays `pending` for good. `score_failure` is null otherwise.

The store keeps the score with its status in one record (`{"status": "scored", "score": ...}`, `{"status": "failed"}` or `{"status": "failed", "reason": "interrupted"}`), so no schema change was needed.

`GET /demo/questions` serves the first instance in bank order of each of the strata H1, H2, H3 and H5, as `instance_id`, `question_id`, `text`, `stratum` and `market_scope` (empty: all markets).
Before the bank is grounded it is the same 503 `CONFIGURATION_ERROR`, never an empty list.

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

> Implementation status: these events are not emitted.
> A live bank question is scored after its run has completed, and the score is stored beside the run (section 5), so the stream carries no `evaluation.*` events.
> The family is reserved for a later phase.

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
These are the codes the API emits (`ErrorCode` in `backend/app/api/errors.py`):

```text
VALIDATION_ERROR
NOT_FOUND
CONFLICT
METHOD_NOT_ALLOWED
MODEL_ERROR
EMBEDDING_ERROR
VECTOR_RETRIEVAL_ERROR
GRAPH_QUERY_ERROR
CONTEXT_BUILD_ERROR
INTERRUPTED
CANCELLED
RUN_ERROR
CONFIGURATION_ERROR
```

`CONFLICT` is a valid request that the current state refuses: the graph is held by a benchmark job or a live run (retryable), the graph is held by another world, a run or job has already finished, or a record id is not unique.
`METHOD_NOT_ALLOWED` is a 405.
Any other client error the framework raises (a 4xx other than 404 and 405) is a `VALIDATION_ERROR`; none is ever a `RUN_ERROR`.

`ONTOLOGY_ERROR`, `EVALUATION_ERROR` and `TIMEOUT_ERROR` from the first design are not used.
A timeout surfaces as the error of the stage that timed out (for example `GRAPH_QUERY_ERROR`, retryable, for a Neo4j timeout).

A failed run carries its code in the `run.failed` payload and in the run's `error` field.
Any other failure is an HTTP error with the same fields in an `error` object:

```json
{"error": {"error_code": "NOT_FOUND", "message": "unknown run_id", "retryable": false}}
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

## 12. Evidence Objects

Evidence is not a separate resource.
Each pipeline's result in `GET /queries/{run_id}` carries it, typed by `app/evidence/__init__.py`:

- `EvidenceChunk`, in A's `evidence` and in B and C's `document_evidence`: `chunk_id`, `document_id`, `chunk_index`, `text`, `title`, `document_type`, `market_id`, `language_code`, `source_system`, `valid_from`, `valid_to`, `kind` (`chunk`, `record` or `node`), `record_table`, `similarity` (the fused reciprocal-rank score of the dense and sparse channels, not a cosine), `dense_rank`, `sparse_rank`, `rank`, `discovered_via` (`vector`, `graph_traversal` or `vector+graph_traversal`), `rerank_score`, `selected` and `discard_reason` (`context_budget`, `slot_limit`, `duplicate` or `superseded_by_structured_fact`).
- `GraphEvidence`, in B and C's `node_evidence`: `node_id`, `node_label`, `hops`, `path` (node ids from the seed), `rel_type`, `score` (the graph composite), `components` (the weighted score parts), `rerank_score`, `selected`, `discard_reason` and `authoritative` (facts read from the structured layer for that node).
- `Citation`, in the answer's `citations`: one per block shown to the model, in prompt order, with `chunk_id`, `document_id`, `title`, `source_system`, `source_record_id`, `record_table`, `market_id` and `language_code`; `cited_blocks[i]` refers to `citations[cited_blocks[i] - 1]`.

B and C also carry `ontology_concepts`, the concepts their expansion used.

---

## 13. Graph Nodes

The graph is read in two ways, and both are typed.

- A run shows the nodes and relationships it visited through its recorded events (section 8): `graph.node.discovered`, `graph.relationship.traversed`, `graph.candidate.selected` and `graph.candidate.discarded`, with `GraphEvidence` in the result.
  The visual state of a node (seed, candidate, selected, discarded, ontology concept, source record) is derived from those events by the client; the backend does not send a state field.
- The Graph Model screens read the stored graph through `NodeOut` and `Neighbours` (section 20, "Graph reads"): `node_id`, `labels`, `properties` and `provenance` (`table`, `row_id`, `dataset_id`).

---

## 14. Graph Edges

An edge is a recorded `graph.relationship.traversed` event, with `from_id`, `relationship_type`, `to_id`, `to_label` and `hop` in its payload (section 8), or a `NeighbourOut` (`rel_type`, `direction` and the node at the other end) from `GET /graph/nodes/{node_id}/neighbours`.
There is no edge identifier: an edge is the triple of its two node ids and its type.

---

## 15. Replay

Persist enough events to reconstruct UI state.

Replay endpoint:

```text
GET /queries/{run_id}/events
```

Replay must use recorded event sequence rather than rerunning retrieval.

---

## 16. Benchmark Results

The API publishes benchmark results unchanged from the harness.

- `GET /benchmarks/latest` and `GET /benchmarks/{run_id}` return `{run_id, run_kind, label, summary}`, where `summary` is the run's `summary.json` (schema version 2): the headline tiles, metrics per stratum and pipeline, confidence intervals, failure counts and reproducibility record.
  Its contents are specified in `docs/evaluation/reproducibility.md` and `docs/evaluation/scoring.md`.
- `GET /benchmarks/questions` carries each bank question's mean `answer` and `evidence_f1` per pipeline from a published run (`PipelineScore`), null where undefined.
- A live bank question's score (`LiveScore` in `GET /queries/{run_id}`) holds, per pipeline, `answer`, `evidence_f1`, `anchor_resolution` and `failure_class`, scored by the deterministic scorers and never the judge.

There is no per-question result resource: the per-instance results are the run directory's `results.json`.

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

Contract tests cover request validation, invalid configuration, event ordering and envelope, replay and stream parity, error envelopes and codes, and truth-ledger non-exposure.
They are listed in section 20.

Truth-ledger non-exposure is tested in two ways.
`tests/test_truth_ledger_isolation.py` enforces which modules may import `app.evaluation` and that retrieval loads none of it at run time (ADR-008).
`tests/test_api_scoring.py` and `tests/test_api_benchmarks.py` check that the demo questions, run results, events and logs carry no expected answer, and that `GET /benchmarks/questions` is the one route that serves answer keys and hidden truths, as the owner decided on 2026-10-18 (section 2).

---

## 19. HITL Gate

API contracts are part of **HITL-02 Architecture Approval** and **HITL-08 Retrieval Behaviour Approval**.

Do not freeze event contracts before reviewing real prototype traces.

---

## 20. Implementation status (Phase 4, 2026-10-20)

The API is built as section 3 lists it.
It is tested offline in `tests/test_api_queries.py`, `tests/test_api_runs.py`, `tests/test_api_stream.py`, `tests/test_api_scoring.py`, `tests/test_api_benchmarks.py`, `tests/test_api_data_model.py`, `tests/test_api_graph_model.py`, `tests/test_api_reference.py`, `tests/test_api_errors.py`, `tests/test_store.py` and `tests/test_health.py`.
`tests/test_api_live.py` is the live check (`GRAPH_E2E=1 VECTOR_E2E=1 LIVE_WORLD_E2E=1`).
It starts the application on the presentation world, asks the first H1 demo question, reads the run over server-sent events, waits for the score against the answer key, restarts the application on the same run store, and checks that the run, its events and readiness survive, and that no log record holds the question's expected answer.
It reads Neo4j and never writes to it.
Its tiny-world companion in the same file needs only `GRAPH_E2E=1` and does wipe Neo4j.

### Live test flags

Three flags switch the live tests on.
CI sets `GRAPH_E2E` and `VECTOR_E2E`, which have services in CI, and never `LIVE_WORLD_E2E`.

| Flag | Tests it enables |
|---|---|
| `GRAPH_E2E=1` | tests that use Neo4j; several wipe and re-ingest it |
| `VECTOR_E2E=1` | tests that use Qdrant |
| `LIVE_WORLD_E2E=1` | tests that need the presentation world (generated, ingested, indexed, grounded), its bank, its ledger or Ollama: `test_benchmark_live.py`, the presentation test in `test_api_live.py`, the live test in `test_api_graph_model.py` and the `dev_world` tests in `test_benchmark_grounding.py` |

A test whose flag is unset is skipped, and CI runs pytest with `-rs` so every skip and its reason is listed.
A test whose flag is set never skips: a missing prerequisite or an unreachable service is a failure.
After each test module, a fixture ingests the presentation world (`DATASET_DIR`'s) again if Neo4j holds another, when that world's `_graph_stats.json` exists, so running the whole live suite leaves the graph at the presentation world.
The gating is in `backend/tests/live.py`; `docs/development/commands.md` has the commands.

### Benchmark reads

```text
GET /api/v1/benchmarks                 list[BenchmarkRunOut]
GET /api/v1/benchmarks/latest          BenchmarkSummary
GET /api/v1/benchmarks/questions       list[QuestionOut]
GET /api/v1/benchmarks/{run_id}        BenchmarkSummary
```

A run is published when its directory under `BENCHMARK_DIR` holds a `summary.json` of the schema the report writes (`SUMMARY_SCHEMA_VERSION`, now 2); the harness writes that file last.
Directories with another schema version are not listed.
A malformed `summary.json` is a server error, never silently skipped.

- `GET /benchmarks` lists published runs newest first, by `reproducibility.run.started_at` and then by directory name.
  Each entry is `run_id`, `run_kind`, `label`, `started_at`, `selection` (the strata and per-question limit it scored) and `worlds` (its seeds).
- `GET /benchmarks/latest` and `GET /benchmarks/{run_id}` return `{run_id, run_kind, label, summary}`, where `summary` is the run's `summary.json` unchanged.
  `latest` is the newest official run of the whole bank, else the newest run of any kind, and is a 404 `NOT_FOUND` when nothing is published.
  `{run_id}` is looked up among the published runs, never as a path, so a name that is not one is a 404 `NOT_FOUND`.
- `GET /benchmarks/questions` lists the questions of the presentation world's frozen bank for the Help screen.
  Each entry has `question_id`, `instance_id`, `text`, `tests`, `stratum`, `scenario_id`, `ontology_dependent`, `expected_answer`, `hidden_truth` (the planted scenario's truth for an H5 question, else null) and `scores`.
  `scores` are per pipeline (`answer` and `evidence_f1`, null where undefined) from the run named by the optional `run_id` query parameter, else from the newest official run of the whole bank; they are null when that run did not score the question or no such run exists.
  A 404 `NOT_FOUND` says no published run has the given `run_id`.
  The presentation world is the active dataset (`DATASET_DIR`) with its ledger (`TRUTH_LEDGER_PATH`, default `data/truth/ledger.json`); its bank is `data/evaluation/bank/bank-2.0.0-<dataset directory name>.json`, so another dataset directory has no bank until it is grounded.
  A bank that has not been grounded is a 503 `CONFIGURATION_ERROR` "the question bank has not been grounded; run make ground-bank", and so is a bank that is not current for that world (manifest, ledger, bank version or record serialiser): "the question bank does not match the active world; run make ground-bank".
  `GET /demo/questions` and a bank question sent to `POST /queries` answer the same two 503s.
  This is the one route that serves expected answers and hidden truth, both read from evaluator output; the live query routes never do.

### Reference reads

```text
GET /api/v1/ontology                                       OntologyOut
GET /api/v1/ontology/concepts/{concept_id}/members         list[MemberOut]
GET /api/v1/scenarios                                      list[ScenarioOut]
GET /api/v1/models                                         ModelsOut
```

None of these queries Neo4j.

- `ontology` reads the repository's ontology YAML: `version` and every concept with its `parent_id`, `labels` and `synonyms` by language, `binding_counts` by market id (codes shared by every market count under `shared`) and `relationships`.
  `relationships` is derived, not declared: `IS_A` for a concept with a parent or child, `MAPS_TO` for one with a bound code.
- `members` lists the local codes bound to a concept (`kind`, `code`, `market_id`, and `name` when the term table has a local display name).
  The optional `market` query parameter is a market id such as `MKT_UK`.
  An unknown concept is a 404 `NOT_FOUND` and an unknown market a 422 `VALIDATION_ERROR`.
- `scenarios` lists each enabled scenario of the catalogue with `scenario_id`, `scenario_type`, `title`, `planted`, `planted_rows`, `strength` and `noise_level`.
  What was planted comes from the active dataset's manifest (`scenarios.applied`).
  Where or why it was planted is the truth ledger, which is evaluator-only and is never read here.
  A dataset without a manifest has every scenario unplanted.
- `models` reports the embedding, sparse, rerank and generation models, each as `provider`, `model`, `reachable` and `detail`.
  The embedding model is checked by listing the models of its Ollama server.
  The generation model is probed as readiness probes it (section 20, "Health and readiness").
  Each result is cached per configuration for 30 s, failures included, and concurrent calls share one probe.
  Sparse and rerank run in the API process, so `reachable` is null with the detail `runs in process` until the lab has loaded them, then true with `loaded`.
  The settings come from the built lab, or from the environment while no lab is built.

The rule for which run `latest` serves, and the `summary.json` it carries, are in `docs/evaluation/reproducibility.md`.

### Benchmark jobs and the shared graph (Phase 4)

`POST /api/v1/benchmarks` starts a benchmark job on a background thread of the API process, one at a time; it is tested in `tests/test_api_benchmarks.py`.
The body is `{"kind": "smoke" | "official", "seeds": [...], "repeats": n, "strata": [...] | null, "limit": n | null}`; unknown fields are a 422.
The harness checks the request before anything starts: a seed the harness does not run, a repeated seed, an unknown stratum, or a kind and repeat count the harness refuses (`preflight`) is a 422 `VALIDATION_ERROR`.
The response is 202 with a job: `{job_id, status, run_id, error, progress}`.
`status` is `running`, `completed`, `failed` or `cancelled`.
`run_id` names the published run once the job has completed, and is null before that and for a job that did not complete.
`progress` is `{world_seed, instances_done, instances_total}` for the world being run, and null until the first world reaches its first instance.
`error` is the section 11 envelope of a failed job, with a curated message; the exception text is logged only.
`GET /api/v1/benchmarks/jobs/{job_id}` reads the job and `POST /api/v1/benchmarks/jobs/{job_id}/cancel` asks it to stop (202); an unknown job is a 404 `NOT_FOUND`, and cancelling a finished job is a 409 `CONFLICT`.
A job ingests seeds 2027 and 2028 into the same Neo4j that Live Lab reads, then ingests seed 2026 again, so one graph lease keeps jobs and live runs apart:

- `POST /api/v1/queries` answers 409 `CONFLICT` "a benchmark run is using the graph; try again when it finishes" while a job runs, and `POST /api/v1/benchmarks` answers 409 while a live query or another job runs.
- `GET /api/v1/graph/nodes/{node_id}` and `/neighbours` answer the same 409; a record read answers with `edges: null` and `graph_error: "OTHER_WORLD"`; the readiness `graph` check reads "a benchmark run is using the graph".
  None of these consult the 30 s world cache while a job runs, and the cache does not survive a job.
- `GET /api/v1/graph/stats` and `/graph/schema` read files only and are unaffected.

Cancelling a job (`POST /api/v1/benchmarks/jobs/{job_id}/cancel`) is cooperative: the job stops before its next instance, or before preparing its next world.
The instance in progress finishes first, with every repeat of every pipeline and its judging, so on an official run a cancel can take minutes; preparing a world (generation, ingestion, indexing) has no cancellation point inside it.
A cancelled or failed job writes no `summary.json` and ingests seed 2026 again before it ends.

Recovery after a server stop during a job: jobs live in memory, so the job is lost, its run directory has no `summary.json` and is never published, and Neo4j may still hold a benchmark world.
Readiness then reports `the graph holds another world`; the server does not re-ingest at start-up.
Run `make ingest-graph`, then check that `GET /api/v1/health/ready` reports every check green.

### Run store

Runs, events, results and scores are persisted in the SQLite run store (ADR-007, D-033), not held in memory.
It keeps the newest `RUN_RETENTION` finished live runs (default 500); queued and running runs are never pruned, so the count can briefly exceed it.
Pruning happens when a run is created and removes the run's events, results and score with it.
At start-up, every run left `queued` or `running` is marked `failed` with `INTERRUPTED`, and every completed bank run with no score is given the interrupted score record (section 5).
The same transaction appends the events that end the run: `pipeline.failed` for each pipeline that was running, then `run.failed`, each with the INTERRUPTED envelope, so a stream of that run ends at a terminal event.
A run whose terminal event is already stored, because the write of its final row failed, is marked the same way and gets no second terminal event.
`tests/test_store.py` and `tests/test_api_runs.py` cover it.

### Health and readiness

`GET /api/v1/health` is the liveness probe and returns `{status: "ok", version}`.
`GET /api/v1/health/ready` is tested in `tests/test_health.py`.
It returns `Readiness {ready, checks}` with one `Check {ok, detail}` each for `lab`, `index`, `graph`, `model` and `embedding`, with status 200 when every check passes and 503 otherwise.

- `lab`: the retrieval lab is built; otherwise the detail is `building`, `not started` or that the last build failed.
  Start-up begins the build in a background thread; no route waits on it, a run started meanwhile waits for it, and a failed build is retried by the next run.
  Readiness never builds the lab or waits for a build.
- `index`: the collection exists and holds points, and a persistent index's manifest names this code's record serialiser (5 s timeout).
- `graph`: Neo4j answers `RETURN 1` within `NEO4J_TIMEOUT_S`, and does not hold another world than the configured dataset; otherwise the detail is `the graph holds another world` (see "Which world the graph holds" below).
- `model`: reachable, not warm, through `gateway.probe`.
  The fake generator is always reachable.
  An Ollama-routed model (an `ollama/` or `ollama_chat/` model, or `GENERATION_API_BASE` equal to `OLLAMA_HOST`) is `available` when `GET {base}/api/tags` lists it within 5 s, where `base` is the one generation uses (`gateway.generation_api_base`: `GENERATION_API_BASE`, else LiteLLM's Ollama default `http://localhost:11434`), and `not pulled` otherwise; no generation is asked for, so a cold model is not loaded.
  Any other provider must answer one gateway call with `max_tokens=1` within `min(30 s, GENERATION_TIMEOUT_S)`; an empty one-token answer counts as reachable.
  The result is cached for 30 s, and concurrent polls share one in-flight probe.
- `embedding`: the embedding model is reachable, through the same cached `ModelReachability` as `model`: an Ollama model must be listed by its server (`GET {OLLAMA_HOST}/api/tags` within 5 s) and is `not pulled` otherwise; the hashing embedder is always reachable.

The checks run concurrently, each under its own timeout; a check that times out reports `timed out after N s`.
Details are curated sentences: raw driver and provider text, which can name service addresses, is logged only.

### Data Model reads

Tested in `tests/test_api_data_model.py`:

```text
GET /api/v1/datasets                                          list[DatasetSummary]
GET /api/v1/datasets/{dataset_id}                             DatasetDetail
GET /api/v1/datasets/{dataset_id}/dictionary                  list[TableSchemaOut]
GET /api/v1/datasets/{dataset_id}/tables/{table}/rows         RowPage
GET /api/v1/datasets/{dataset_id}/tables/{table}/rows/{row_id} RecordOut
```

- A dataset is a directory with a `_manifest.json` beside the active world (`DATASET_DIR`, the world the lab is built from); `active` marks that world.
  Only those directories are listed or served, so the evaluator-only ledger, which lives outside that directory, is never reachable.
  An entry that resolves outside that directory, such as a symlink to another place, is refused.
  Any other `dataset_id` is a 404 `NOT_FOUND`.
- The routes read configuration and files only; they never wait for the lab build.
- `DatasetDetail` carries the summary, the manifest's per-table provenance and `index_status` from the world's `vector-index.json` (`points` is its chunk count plus its record count), or null when no persistent index was built over the world.
- The dictionary is the world's own `_data_dictionary.json`, written by its generator: columns and types in position order, the primary key, the source system and the foreign keys, with `ref_column` the parent table's primary key and `provenance` from the manifest.
  A field the file lacks (a table's source system or primary key, or the whole foreign-key list) comes from the code's schema registry (`app.datasets.schema`); a missing column description stays null.
  A world without the file gets the registry's dictionary, and every entry says which it is in `dictionary_source` (`world` or `registry`).
- `rows` takes `offset` (default 0), `limit` (default 50, maximum 200; a larger limit is a 422, never a clamp) and an optional `column` and `value` filter, which must come together.
  `table` and `column` must be names in the registry, otherwise a 422 before any query runs.
  Rows are ordered by the primary key, then the other columns, so pages are stable; `total` counts every row matching the same filter.
  The filter casts the bound value to the column's declared type (`column = TRY_CAST(? AS <type>)`, the type taken from a fixed mapping of the registry's types), so an ISO timestamp copied from a row matches that row; a value that does not cast is a 422 before any row is read.
  Dates and timestamps are ISO strings and decimals their exact text, never floats.
- `rows/{row_id}` reads the row whose primary key is `row_id` (cast the same way): a 404 when none matches, a 409 `CONFLICT` when the row id is not unique in the table (link tables such as `incident_game_map`, whose first column repeats).
  `graph_node_id` follows the ingestion mapping (`app.graph.node_rows.NODE_TABLES`, the table-to-label-and-id rule ingestion builds every table node by): for a table that creates no nodes it is null and `edges` is empty.
  The graph holds the active world only and ids repeat across worlds, so a record of another world has `graph_node_id` and `edges` null and `graph_error` `OTHER_WORLD`.
  The same holds for a record of the active world when the graph holds another world (see "Which world the graph holds" below).
  `edges` counts the node's relationships per type and direction in one bounded statement (`statements.record_edge_summary_statement`).
  When Neo4j cannot be read, the row is still returned, with `edges` null and `graph_error` `GRAPH_QUERY_ERROR`.

### Graph reads

Tested in `tests/test_api_graph_model.py`:

```text
GET /api/v1/graph/schema                          GraphSchema
GET /api/v1/graph/stats                           GraphStats
GET /api/v1/graph/nodes/{node_id}                 NodeOut
GET /api/v1/graph/nodes/{node_id}/neighbours      Neighbours
```

- `schema` reads code and configuration only: the 29 node labels, every relationship type with the labels it joins (`statements.RELATIONSHIP_ENDPOINTS`, 44 triples kept in step with ingestion by a test), `allow_list` keyed `B` and `C` (`app.lab.bc_graph_settings`: C is the 22-type allow-list, B the same minus the three ontology types), the evidence-ranking `weights` and the traversal `caps` (`max_depth`, `max_nodes_per_hop`, `max_edges_per_node_type`, `max_total_nodes`), which are the same for B and C, and `label_version`.
- `stats` reads the active dataset's `_graph_stats.json`, written by `python -m app.graph`, and works without Neo4j.
  `nodes_by_label` is the file's node counts; `relationships_by_type` sums its per-triple counts per type; `ingestion_version` is `LABEL_VERSION` and the file's own `ingestion_version` joined by `/` (for example `v2/ing-20261020T141842Z`); `source` is always `ingestion`, because these are the counts the ingestion pushed, not a live count.
  A dataset without the file is a 404 `NOT_FOUND`.
- `nodes/{node_id}` returns the node's labels, its properties (Neo4j dates and times as ISO strings) and its `provenance`: the source `table` from the ingestion mapping (`NODE_TABLES`, read from label to table), the node's `source_record_id` as `row_id`, and the active dataset's directory name as `dataset_id`.
  A node no source table maps to (`PrizeType` from master data, `BusinessConcept` from the ontology) has `provenance` null.
  An unknown id is a 404 `NOT_FOUND`.
- `neighbours` takes `limit` (default 25, maximum 100; a larger or smaller limit is a 422, never a clamp) and an optional `type`, which must be a registered relationship type, otherwise a 422 before any graph read.
  Neighbours are ordered by relationship type, direction (`out` or `in`) and neighbour id; the statement fetches `limit + 1`, so `truncated` says the node has more.
  Each neighbour is a `NodeOut` with its own provenance.
- All Cypher is in `app/graph/statements.py` (`LABEL_COUNTS`, `GRAPH_NODE`, `GRAPH_NEIGHBOURS`), with every limit a parameter.
  Each request opens one reader, closed in a finally, and each statement runs once under `NEO4J_TIMEOUT_S`, without the driver's retries.
  A Neo4j failure is a `GRAPH_QUERY_ERROR`: 503 and retryable when the database is unreachable or busy, 500 otherwise, with the driver's text logged only.

### Which world the graph holds

Neo4j holds one ingested world at a time, and node ids repeat across worlds.
`app.api.graph_world.graph_world_matches` compares the live node count of every label (one statement) with the active dataset's `_graph_stats.json`.
It returns null when the dataset has no statistics file, so the world cannot be compared.
The result is cached for 30 s, for the last dataset and statistics file checked, so a re-ingestion that rewrites the file is seen at once.
When the counts differ, the node routes return 409 `CONFLICT` with the message `the graph holds a different world than the active dataset`, a record's `graph_error` is `OTHER_WORLD`, and the readiness graph check fails.
Equal counts are a fingerprint, not a proof: another world with the same count for every label would pass.

A run of B or C is refused with a 503 `CONFIGURATION_ERROR` "the graph holds another world; run make ingest-graph" while the same check says the graph holds another world; a run of A alone is accepted, and so is any run of a dataset with no statistics file.
A graph that cannot be read during the check is treated like a dataset that cannot be compared: the run is accepted and stored, B and C fail with recorded `GRAPH_QUERY_ERROR` events (`pipeline.failed`, then `run.failed`), and A keeps its result.
An invalid setting on a question route or a run start is a 503 `CONFIGURATION_ERROR` whose message names the variable.

### Not built

The first design listed these routes; the application does not have them:

- experiments (`POST /experiments`, `GET /experiments/{experiment_id}`, `POST /experiments/{experiment_id}/reset`);
- dataset generation and listing by generation (`POST /datasets/generate`; `GET /datasets` exists and lists the datasets on disk);
- scenario validation (`POST /scenarios/validate`);
- `GET /queries/{run_id}/evidence`, because evidence is embedded in each pipeline's result in `GET /queries/{run_id}`;
- `GET /models/status`, because `GET /models` carries each model's reachability;
- `GET /graph/evidence-paths/{run_id}`, because the evidence paths are the recorded graph events of the run;
- `GET /benchmarks/{benchmark_run_id}/results` and `POST /benchmarks/{benchmark_run_id}/cancel`, which are `GET /benchmarks/{run_id}` and `POST /benchmarks/jobs/{job_id}/cancel`.

---

## 21. Errors, bounds and configuration

### HTTP errors

Every error body is `{"error": {error_code, message, retryable}}` (section 11).
Messages are curated sentences; library text, service addresses and stack traces go to the server log only.

| Status | Code | When |
|---|---|---|
| 404 | `NOT_FOUND` | an unknown run, job, dataset, table row, node, concept, published benchmark run or statistics file |
| 405 | `METHOD_NOT_ALLOWED` | a method the route does not have |
| 409 | `CONFLICT` | cancelling a run or job that has finished; the graph is held by a benchmark job or a live run (the graph lease, retryable); the graph holds a different world than the active dataset; a record id that is not unique |
| 4xx | `VALIDATION_ERROR` | any other client error the framework raises |
| 422 | `VALIDATION_ERROR` | a body or parameter that fails validation, including unknown fields, a limit above its maximum, an unknown market, table, column or relationship type, a malformed cursor or resume point, and a bank question sent with other text or scope |
| 500 | `RUN_ERROR` | an unexpected failure; the body is the generic sentence and the cause is in the log |
| 503 | `CONFIGURATION_ERROR` | the question bank has not been grounded, or it does not match the active world (`make ground-bank`); a run of B or C while the graph holds another world (`make ingest-graph`) |
| 503 | `GRAPH_QUERY_ERROR` | Neo4j is unreachable or busy (retryable); other Neo4j failures are 500 |
| 503 | readiness body | `GET /health/ready` with a failed check; the body is `Readiness`, not an error object |

`GRAPH_QUERY_ERROR` and the model, embedding and vector codes are also the codes a failed run carries (sections 6 and 11).
Every response carries `X-Request-ID`: the client's value when it is 1 to 64 letters, digits or hyphens, else a generated one; the same id is on that request's log lines.
Cross-origin calls are allowed for `CORS_ORIGINS` with the methods GET and POST and the headers `content-type`, `x-request-id` and `last-event-id`.

### Bounds

| Where | Bound |
|---|---|
| `POST /queries` | `question` 1 to 2000 characters; `configurations` from A, B and C; `market_scope` entries are known markets |
| `GET /queries` | `limit` 1 to 100, default 20; a larger value is a 422; `status` is one of `queued`, `running`, `completed`, `failed` or `cancelled`, otherwise a 422 |
| `GET /queries/{run_id}/events/stream` | resume point a non-negative integer of at most 2^63 - 1; heartbeat every `SSE_HEARTBEAT_S` |
| `GET .../tables/{table}/rows` | `limit` at most 200, default 50; `offset` 0 to 2^63 - 1, default 0; `column` and `value` together |
| `GET /graph/nodes/{node_id}/neighbours` | `limit` 1 to 100, default 25 |
| Graph traversal | depth, nodes per hop, edges per node type and total nodes are the `GRAPH_*` settings, shown by `GET /graph/schema` |
| Neo4j reads | one statement each, under `NEO4J_TIMEOUT_S` |
| Model calls | `GENERATION_TIMEOUT_S` per gateway call |
| Run store | `RUN_RETENTION` finished live runs |
| Graph lease | one benchmark job, or any number of live runs, at a time; never both |

No limit is clamped silently: a value outside its bound is a 422.

### The graph lease

Live runs and benchmark jobs share one Neo4j.
A live run takes the lease when it starts and gives it back once its pipelines are done.
A benchmark job takes it for its whole run, because it ingests other worlds.
Each side is refused with a retryable 409 while the other holds it (section 20, "Benchmark jobs and the shared graph").

### Configuration

The API settings are read once, when `create_app` runs: `CORS_ORIGINS`, `APP_DB_PATH`, `RUN_RETENTION`, `SSE_HEARTBEAT_S`, `BENCHMARK_DIR` and `LOG_LEVEL`, and the Neo4j connection settings.
A change to any of them needs a restart.
The retrieval, model and traversal settings (`from_env`) are read when the lab is built: at start-up, or by the next run after a failed build.
While no lab is built, `GET /models` reads them afresh on each request.
`.env.example` lists every variable with its default.
