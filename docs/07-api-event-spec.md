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

### Bank questions and live scoring (Phase 4)

```json
{"benchmark_instance_id": "L05-2026-INC_S007_GR", "configurations": ["A", "B", "C"]}
```

`benchmark_instance_id` names an instance of the presentation world's frozen bank (seed 2026, `make ground-bank`).
The run asks that instance's text: every pipeline receives the instance text and nothing else, never its expected answer, checks or claims.
`question` may then be left out; when it is sent it must equal the instance text, otherwise the request is a 422 `VALIDATION_ERROR` "a bank question runs with its own text".
An id the bank does not hold is a 422 `VALIDATION_ERROR`, and before the bank is grounded the request is a 503 `CONFIGURATION_ERROR` "the question bank has not been grounded; run make ground-bank".
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
GET  /api/v1/demo/questions      one frozen-bank instance per demo stratum
GET  /api/v1/benchmarks/latest   published harness output only
```

`GET /api/v1/benchmarks/latest` returns the newest official run of the whole bank, else the newest run of any kind with its label; the rule and the `summary.json` it serves are in `docs/evaluation/reproducibility.md`.

### Benchmark jobs and the shared graph (Phase 4)

`POST /api/v1/benchmarks` starts a benchmark job on a background thread of the API process, one at a time; it is tested in `tests/test_api_benchmarks.py`.
A job ingests seeds 2027 and 2028 into the same Neo4j that Live Lab reads, then ingests seed 2026 again, so one graph lease keeps jobs and live runs apart:

- `POST /api/v1/queries` answers 409 `VALIDATION_ERROR` "a benchmark run is using the graph; try again when it finishes" while a job runs, and `POST /api/v1/benchmarks` answers 409 while a live query or another job runs.
- `GET /api/v1/graph/nodes/{node_id}` and `/neighbours` answer the same 409; a record read answers with `edges: null` and `graph_error: "OTHER_WORLD"`; the readiness `graph` check reads "a benchmark run is using the graph".
  None of these consult the 30 s world cache while a job runs, and the cache does not survive a job.
- `GET /api/v1/graph/stats` and `/graph/schema` read files only and are unaffected.

Cancelling a job (`POST /api/v1/benchmarks/jobs/{job_id}/cancel`) is cooperative: the job stops before its next instance, or before preparing its next world.
The instance in progress finishes first, with every repeat of every pipeline and its judging, so on an official run a cancel can take minutes; preparing a world (generation, ingestion, indexing) has no cancellation point inside it.
A cancelled or failed job writes no `summary.json` and ingests seed 2026 again before it ends.

Recovery after a server stop during a job: jobs live in memory, so the job is lost, its run directory has no `summary.json` and is never published, and Neo4j may still hold a benchmark world.
Readiness then reports `the graph holds another world`; the server does not re-ingest at start-up.
Run `make ingest-graph`, then check that `GET /api/v1/health/ready` reports every check green.

Superseded in Phase 4: runs, events and results are persisted in the SQLite run store (ADR-007), keeping the newest `RUN_RETENTION` live runs, rather than held in memory for the last 50 runs.
Phase 4 also adds `GET /api/v1/queries` (history) and `POST /api/v1/queries/{run_id}/cancel` (section 5), tested in `tests/test_api_runs.py`.

Phase 4 adds `GET /api/v1/health/ready`, tested in `tests/test_health.py`; `GET /api/v1/health` stays the liveness probe.
It returns `Readiness {ready, checks}` with one `Check {ok, detail}` each for `lab`, `index`, `graph` and `model`, with status 200 when every check passes and 503 otherwise.

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

The checks run concurrently, each under its own timeout; a check that times out reports `timed out after N s`.
Details are curated sentences: raw driver and provider text, which can name service addresses, is logged only.

Phase 4 adds the Data Model reads, tested in `tests/test_api_data_model.py`:

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
- `rows/{row_id}` reads the row whose primary key is `row_id` (cast the same way): a 404 when none matches, a 409 when the row id is not unique in the table (link tables such as `incident_game_map`, whose first column repeats).
  `graph_node_id` follows the ingestion mapping (`app.graph.node_rows.NODE_TABLES`, the table-to-label-and-id rule ingestion builds every table node by): for a table that creates no nodes it is null and `edges` is empty.
  The graph holds the active world only and ids repeat across worlds, so a record of another world has `graph_node_id` and `edges` null and `graph_error` `OTHER_WORLD`.
  The same holds for a record of the active world when the graph holds another world (see "Which world the graph holds" below).
  `edges` counts the node's relationships per type and direction in one bounded statement (`statements.record_edge_summary_statement`).
  When Neo4j cannot be read, the row is still returned, with `edges` null and `graph_error` `GRAPH_QUERY_ERROR`.

Phase 4 adds the graph reads, tested in `tests/test_api_graph_model.py`:

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

Which world the graph holds.
Neo4j holds one ingested world at a time, and node ids repeat across worlds.
`app.api.graph_world.graph_world_matches` compares the live node count of every label (one statement) with the active dataset's `_graph_stats.json`.
It returns null when the dataset has no statistics file, so the world cannot be compared.
The result is cached for 30 s, for the last dataset and statistics file checked, so a re-ingestion that rewrites the file is seen at once.
When the counts differ, the node routes return 409 `VALIDATION_ERROR` with the message `the graph holds a different world than the active dataset`, a record's `graph_error` is `OTHER_WORLD`, and the readiness graph check fails.
Equal counts are a fingerprint, not a proof: another world with the same count for every label would pass.

Reserved for later phases (not implemented): experiments, dataset generation and scenario management, `GET /queries/{run_id}/evidence` (evidence is embedded in the results DTO), and benchmark submission/cancel (the harness runs via `make run-benchmark`; the API only publishes results).
