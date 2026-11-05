# API

This page describes the HTTP routes, the execution events, the error contract and the bounds of the backend.
The architecture around it is in [architecture.md](architecture.md), the pipelines that emit the events in [retrieval.md](retrieval.md), and the screens that consume it in [ux.md](ux.md).

The contract itself is committed as `frontend/src/api/openapi.json`, and the frontend types in `frontend/src/api/schema.d.ts` are generated from it.
When this page and that file differ, the file is right.

## Purpose

The API lets a client start a run of one question through A, B and C, follow it live, replay it afterwards, score it, read the published benchmark runs, and inspect the world, the graph and the ontology.
The base path is `/api/v1`.
Every schema is typed, no route returns a database object directly, and ids are stable.

## Principles

- Endpoints are versioned, and bodies and responses are typed.
- Unknown request fields are refused with a 422, including the retired `profile` field.
- No value is clamped silently: a value outside its bound is a 422.
- No live query route, event, stream frame or log record carries an expected answer or a hidden truth.
  `GET /benchmarks/questions` is the one route that serves them, from evaluator output after the fact (owner decision of 2026-10-18).
- Every response carries `X-Request-ID`.
  The client's value is echoed when it is 1 to 64 letters, digits or hyphens, and otherwise one is generated.
- A breaking change needs an API version change or a compatibility layer, frontend coordination and tests.

## Routes

| Method and path | Purpose |
|---|---|
| `GET /health` | Liveness: `{status: "ok", version}` |
| `GET /health/ready` | Readiness with one check each for `lab`, `index`, `graph`, `model` and `embedding`. 200 when all pass, 503 otherwise. |
| `POST /queries` | Store a run and start it. Returns 202. |
| `GET /queries` | Run history, newest first |
| `GET /queries/{run_id}` | The run with each pipeline's result as it finishes |
| `POST /queries/{run_id}/cancel` | Ask a run to stop. Returns 202. |
| `GET /queries/{run_id}/events` | The recorded events, for replay |
| `GET /queries/{run_id}/events/stream` | The same events as server-sent events |
| `GET /demo/questions` | The four demo questions |
| `GET /settings` | The settings an official run records, as the system would record them now |
| `GET /benchmarks` | Published benchmark runs, newest first |
| `GET /benchmarks/latest` | The run Overview shows |
| `GET /benchmarks/questions` | The bank's questions with answer keys, hidden truths and scores |
| `GET /benchmarks/{run_id}` | One run's summary |
| `GET /benchmarks/{run_id}/instances` | One run's per-question scores |
| `GET /benchmarks/{run_id}/second-judge` | The run's second judge, a recorded second opinion (D-100), and the two judges' combined mark (D-105) |
| `POST /benchmarks` | Start a benchmark job. Returns 202. |
| `GET /benchmarks/jobs`, `GET /benchmarks/jobs/{job_id}` | List or read jobs |
| `POST /benchmarks/jobs/{job_id}/cancel` | Ask a job to stop |
| `GET /datasets`, `GET /datasets/{dataset_id}` | The worlds on disk, and one world's detail |
| `GET /datasets/{dataset_id}/dictionary` | The data dictionary |
| `GET /datasets/{dataset_id}/tables/{table}/rows` | A page of rows |
| `GET /datasets/{dataset_id}/tables/{table}/rows/{row_id}` | One record with its graph node |
| `GET /data-model/example` | The incident the Data Model Overview follows, never a planted one |
| `GET /graph/schema`, `GET /graph/stats` | The graph model, and the counts ingestion pushed |
| `GET /graph/nodes/{node_id}`, `.../neighbours` | One node, and its neighbours |
| `GET /ontology`, `GET /ontology/concepts/{concept_id}/members` | The concept tree, and the codes bound to a concept |
| `GET /scenarios` | The enabled scenarios and what was planted |
| `GET /models` | The configured models and whether each is reachable |

A route that is not in the contract is not built.
The first design listed experiments, dataset generation, scenario validation, a separate evidence route, a model status route and evidence-path routes, and none of them exists.
Evidence is embedded in each pipeline's result, and evidence paths are the recorded graph events.

## Query runs

### Request

```json
{
  "question": "Why did digital conversion fall in Greece?",
  "configurations": ["A", "B", "C"],
  "market_scope": ["GR"]
}
```

`question` is 1 to 2,000 characters.
`configurations` is a list drawn from A, B and C, three at most.
`market_scope` takes up to four entries, as two-letter codes (`UK`, `GR`, `AT`, `CZ`) or full ids (`MKT_UK`), and unknown markets are a 422.
An empty scope means all markets.
The scope is applied identically to every requested pipeline: the document search runs within it (the top-k is computed over in-scope items, never cropped afterwards), and structured evidence whose record carries a market outside it is discarded with the reason `out_of_scope_market`.
Items with no market are shared evidence and stay in scope.
The accepted scope is echoed as `market_scope` and recorded on each pipeline's first event.

A bank question is started with `benchmark_instance_id` instead of `question`:

```json
{ "benchmark_instance_id": "L05-2026-INC_037", "configurations": ["A", "B", "C"] }
```

It names an instance of the presentation world's frozen bank.
Every pipeline receives the instance text and nothing else, never its expected answer, checks or claims.
`question` may then be omitted, and if sent it must equal the instance text (a 422 otherwise).
A request `market_scope` that differs from the instance's own is also a 422.
An unknown instance is a 422, and a missing or stale bank is a 503 `CONFIGURATION_ERROR`.

### Response and lifecycle

`POST /queries` stores the run as `queued`, starts one worker thread and answers 202:

```json
{
  "run_id": "RUN-0A1B2C3D4E5F",
  "status": "queued",
  "results_url": "/api/v1/queries/RUN-0A1B2C3D4E5F",
  "events_url": "/api/v1/queries/RUN-0A1B2C3D4E5F/events"
}
```

`GET /queries/{run_id}` reads the run store and returns the run: `run_id`, `kind`, `question`, `status`, `configurations`, `market_scope`, `pipeline_status`, `created_at`, `finished_at`, `error`, `results`, and for a bank question `benchmark_instance_id`, `answer_key`, `score_status` and `score`.
Each pipeline's result appears in `results` as soon as that pipeline finishes, so A can be read while C is still traversing.

- Run `status` is `queued`, `running`, `completed`, `failed` or `cancelled`.
- Each `pipeline_status` is `pending`, `running`, `completed`, `failed`, `cancelled` or `skipped`.
- Pipelines run in order A, B, C in one worker thread per run, and several runs may execute together.
- When a run fails or is cancelled, the running pipeline takes that outcome and pipelines that never started are `skipped`.
- `error` is the error envelope for a failed or cancelled run (`CANCELLED`, retryable), else null.
- A run the server was executing when it stopped is marked `failed` with `INTERRUPTED` at the next start-up.

History: `GET /queries?limit=20&before=<cursor>&status=<status>` returns `{runs, next_before}`.
`limit` defaults to 20, and a value above 100 is a 422.
Pass `next_before` back unchanged as `before`, and a malformed cursor is a 422.

Cancellation is cooperative.
`POST /queries/{run_id}/cancel` sets a flag, and the running pipeline stops at its next event.
Finished pipelines keep their results, and the run ends `cancelled`.
A pipeline that fails before its next event ends the run `failed` with the real error.
A cancel of a run whose end is already being written, or of a finished run, is a 409 `CONFLICT`, and an unknown run is a 404.

### Live scoring of a bank question

A bank question is scored once its run completes, with the benchmark runner's deterministic scorer, and the score is stored (D-035).
No judge runs live, and the score is labelled "scored against the answer key".
A live score equals the deterministic part of the benchmark's score for the same results.
`answer_key` is `none` for an ad hoc question, which is never scored, and `available` for a bank question.
`score_status` is:

| Value | Meaning |
|---|---|
| `not_applicable` | An ad hoc question, or a run that was cancelled or failed |
| `pending` | A completed bank question whose score is not stored yet. It follows the final status by a few milliseconds. |
| `scored` | `score` is set |
| `failed` | Scoring raised, and the error is logged. `score_failure` is `interrupted` when the server stopped between the final row and the score. |

The score holds, for each pipeline, `answer`, `evidence_recall`, `evidence_f1`, `anchor_resolution` and `failure_class`.
A live score of method v0.3 sets `evidence_recall` and leaves `evidence_f1` null; a score stored under v0.2 has F1 and no recall.
A metric the instance does not define is null.

### Demo questions

`GET /demo/questions` returns the first instance in bank order of each of the strata H1, H2, H3 and H5, from the presentation world's frozen bank (D-036).
Each has `instance_id`, `question_id`, `text`, `stratum`, `market_scope` and `easy_text`.
`easy_text` is an easy-to-read wording of the same question (D-108), written by hand from the presentation world's records and kept in `backend/app/api/easy_questions.py`, or null.
It names the record by its name or kind, country and date and keeps the record's id in brackets.
It is served only when the bank's `world_manifest_hash` is the world the wordings were written from (`dev-seed2026`), because another world may give the id to another record.
A client asks it as its own question (`question`, no `benchmark_instance_id`), so it runs live and is not scored.
Before the bank is grounded the route is a 503 `CONFIGURATION_ERROR`, never an empty list.

## Events

### Envelope and transport

The envelope has eight fields and is identical in replay and in the stream (D-034):

```json
{
  "event_id": "5f0c1d2e3a4b4c5d9e8f7a6b5c4d3e2f",
  "timestamp": "2026-10-20T10:00:00.123456+00:00",
  "run_id": "RUN-0A1B2C3D4E5F",
  "pipeline": "C",
  "event_type": "graph.relationship.traversed",
  "t_ms": 1234.5,
  "payload": {},
  "sequence": 12
}
```

`sequence` starts at 1 and has no gaps within a run.
`t_ms` is a monotonic offset used for replay timing, and `timestamp` is the wall-clock emission time.
`pipeline` is `A`, `B`, `C` or `run`.
Every event is stored the moment it is emitted.

`GET /queries/{run_id}/events/stream` serves the stored events as server-sent events (`text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`).
Each frame is `id: <sequence>`, `event: <event_type>`, and `data:` holding the envelope.
The stream resumes after the sequence in the `Last-Event-ID` header, or else `?after=`, and the header wins when both are sent.
A resume point that is not a non-negative integer is a 422.
While nothing arrives, a `: keep-alive` comment is sent every `SSE_HEARTBEAT_S` seconds (15 by default).
The stream closes after the run's terminal event, and also when the run is no longer active with no terminal event, or when the run store fails mid-stream (logged with the run id).

`GET /queries/{run_id}/events` returns the stored sequence for replay.
Replay never re-runs retrieval.

Every event type has one payload model in `backend/app/events/payloads.py`.
The recorded-event type is a union discriminated on `event_type`, so the OpenAPI contract carries every payload.
The models forbid unknown fields, so an emitter that adds an undeclared field fails `test_event_payloads.py`.
The recording sink validates every event before storing it, and an event that does not validate fails the run (`RUN_ERROR`).
Replay of a stored event that no longer validates answers 500 `RUN_ERROR`, because an older version stored it.

### Lifecycle events

The worker brackets the pipelines' events with:

```text
run.started
pipeline.started   pipeline.completed   pipeline.failed   pipeline.cancelled
run.completed      run.failed           run.cancelled
```

`run.*` events use the pipeline id `run`, and `pipeline.*` events use the pipeline's own id.
A run's first event is `run.started`, and its last is exactly one of `run.completed`, `run.failed` or `run.cancelled`.
The failed and cancelled events carry the error envelope as payload.
`pipeline.cancelled` appears only when a pipeline was running at the cancellation.

### Pipeline A events

```text
rag.query.received  rag.embedding.started  rag.embedding.completed
rag.vector_search.started  rag.candidate.retrieved
rag.rerank.started  rag.candidate.reranked
rag.evidence.selected  rag.evidence.discarded
rag.context.assembled  rag.generation.started  rag.generation.completed
```

`rag.candidate.retrieved` carries the chunk id, document id, the fused similarity, the rank, and the dense and sparse ranks.
`rag.context.assembled` carries `selected`, `discarded`, `context_tokens` and `budget_tokens`, the shared token budget (D-084).
It has no slot count in method v0.3.
`rag.generation.completed` carries `model`, `latency_ms`, `context_tokens`, `verdict` and `cited_blocks`, the count of distinct shown blocks the answer cites.
`rag.evidence.discarded` reasons are `same_record`, `context_budget` and `duplicate`.

### Pipeline B and C events

```text
graph.entity_resolution.started  graph.entity.resolved  graph.target_types.resolved
graph.query.expanded  graph.seed.selected  graph.traversal.started  graph.node.discovered
graph.relationship.traversed  graph.ontology.expanded
graph.rerank.started  graph.candidate.reranked
graph.candidate.selected  graph.candidate.discarded
graph.evidence_path.completed  graph.context.assembled
graph.generation.started  graph.generation.completed
```

- `graph.entity.resolved` carries the entity id, label, origin (`id`, `market_alias`, `term`, `concept_binding` or `vector_fallback`), the matched text, the concept it came through, and a confidence from 0 to 1.
  A fallback seed carries the hit's fused score as `fused_score` and no confidence.
- `graph.target_types.resolved` carries `labels`, the graph labels the question names as target types (D-083), sorted and comma-joined, and empty when it names none.
  It follows the entity events and comes before query expansion and seed selection.
- `graph.seed.selected` is absent when nothing resolves and no record matches the fallback search.
  A seed is never fabricated.
- `graph.traversal.started` records the caps in force.
- `graph.node.discovered` and `graph.relationship.traversed` (from id, relationship type, to id, label and hop) draw the graph.
  Nodes added by concept expansion carry the concept they came through.
- `graph.candidate.reranked` is emitted once per document candidate the shared re-ranker scored (`kind` is `chunk` or `record`), with `candidate_id`, `rerank_score` and the 1-based `rank`.
  Graph nodes are never re-ranked in method v0.3, so there is no node event of this type.
- `graph.candidate.selected` and `graph.candidate.discarded` are node events (`node_id`, the composite `score`, `hops`, `seed`, `tier` and `graph_rank`, and the score components on selection) or document events (`chunk_id` and `rerank_score`).
  `tier` is `seed`, `target` or `other`, and `graph_rank` is the 1-based position in the graph relevance order (D-083).
  A discarded node has both as null only when it was refused before the graph order (`out_of_scope_market`, `excluded_label`).
  Discard reasons are `excluded_label`, `out_of_scope_market`, `same_record`, `context_budget` and `duplicate`.
- `graph.context.assembled` carries `structured_nodes`, `document_chunks`, `context_tokens`, `budget_tokens` and `stated_links`, the number of stated-link rows read for the target tier, null when the question names no target type.
- A run stored under method 0.2.0 still replays: its events validate against separate old-method payload models, which carry `rerank_score` on nodes, `evidence_slots`, and the reasons `slot_limit` and `superseded_by_structured_fact`.
  The Live Lab offers no such run: its recordings and live runs are of the current method.
- `graph.evidence_path.completed` carries counts only, not the paths.
  The paths are in the stored result.

The ontology event family and the evaluation event family in the first design (`ontology.*`, `evaluation.*`) are not emitted.
Concept expansion is the single event `graph.ontology.expanded`, and a bank question's score is stored beside the run instead of streamed.

### Evidence objects

Evidence is not a separate resource.
Each pipeline's result carries it:

- `EvidenceChunk` (A's `evidence`, and the document and record items in B and C's `document_evidence`): ids, text, title, document type, market, language, source system, validity window, `kind` (`chunk`, `record` or `node`), `record_table`, the fused `similarity`, `dense_rank`, `sparse_rank`, `rank`, `discovered_via`, `rerank_score`, `selected` and `discard_reason`, and, for a record, `facts_heading` and `facts` (the compact facts shown to the model, D-085).
  A graph node the walk reached also carries `graph_path` and `graph_seed`, the "reached from" path line and the seed it starts at; they are set together.
  For a graph node `rank` is its graph rank.
- `GraphEvidence` (B and C's `node_evidence`): node id and label, `hops`, `path` (node ids from the seed), the relationship type, the composite score and its `components`, `tier`, `graph_rank`, `selected`, `discard_reason` and `authoritative`, the facts read from the structured layer.
- `Citation`: one for each block shown to the model, in prompt order, with chunk, document, title, source system, source record, record table, market and language. `cited_blocks[i]` refers to `citations[cited_blocks[i] - 1]`.
- `RagAnswer` (each pipeline's `answer`): the parsed `text` and `verdict`, `cited_blocks`, `raw_text`, the model, latency, context tokens, citations and `usage`, and how the output was read and ended (D-096): `answer_form` (`json`, `repaired`, `unclosed` or `plain`; answer parser 2.0.0 wrote `cut_off` for `unclosed`), `finish_reason` as the gateway reported it, `token_limit_reached`, `max_tokens` (the output limit of the call), `cut_off` (stopped at the limit, or unclosed with no report either way) and `surrogates_replaced` (lone UTF-16 surrogates replaced with U+FFFD in the raw text, verdict and answer; null before answer parser 2.1.1).
  Each of the five is null in an answer recorded before answer parser 2.0.0.
- B and C also carry `ontology_concepts`, the concepts their expansion used.

An edge is a recorded `graph.relationship.traversed` event, and has no id of its own: it is the triple of its two node ids and its type.
The visual state of a node (seed, candidate, selected, discarded, ontology concept, source record) is derived by the client from the events, and the backend sends no state field.

## Benchmark routes

A run is published when its directory under `BENCHMARK_DIR` holds a `summary.json` of schema version 3, which the harness writes last, and its record's `method_version` is the method the code runs now (`METHOD_VERSION`, 0.3.0).
Any other run is not listed, not served by id and never `latest`; its files stay on disk untouched (D-104).
Schema 3 carries evidence recall and its comparisons, C against A cells (`not_in_family`), the ontology-dependent split, groundedness means, and a judge agreement with `answered` and `abstained` cells, each with `n`, `agreement` and `weighted_kappa`.
The summary's `method_note` is not served.
The weighted kappa is in the data at any n; a client shows it only from n of 10, as the Results screen does (D-086).
A malformed `summary.json` is a server error and is never silently skipped.

- `GET /benchmarks` lists published runs newest first by start time, each with `run_id`, `run_kind`, `label`, `method_version`, `started_at`, `selection` and `worlds`.
  `method_version` is the method the run was made under, read from its record (D-092); every listed run has the current one.
- `GET /benchmarks/latest` and `GET /benchmarks/{run_id}` return `{run_id, run_kind, label, method_version, summary}`.
  `latest` is the newest official run of the whole bank, else the newest run of any kind.
  It is a 404 when nothing is published.
  A key the harness adds later is ignored on read, so an older client keeps working.
- `GET /benchmarks/{run_id}/instances` lists the run's scored instances with each pipeline's mean of every metric, its repeat and generation-failure counts, its failure classes, and `cut_off_repeats` and `token_limit_repeats`, the repeats whose answer was cut off and those among them that stopped at the output limit (null for a run recorded before answer parser 2.0.0, D-096).
  It carries the question text and scores only, never the expected answer, claims, checks, answer text or context blocks.
  A run without `results.json` is a 404.
- `GET /benchmarks/{run_id}/second-judge` returns `{run_id, run, labels, combined}` (D-100, D-105): `run` is the newest second-judge summary of the run (schema 1), `labels` the newest label check of the same model, or null, and `combined` the two judges' combined mark (`combined.json`, schema 1, typed `JudgesMarkOut`), or null.
  `combined` holds the definitions and versions, the counts, per kind of question and approach the mean mark (`metrics`), the judges' own family of comparisons in the run's `ComparisonCell` shape, its headlines, the agreement between the judges and the list of answers the judges disagree on (`JudgesDisagreeOut`); see [evaluation.md](evaluation.md#judges-mark).
  It is null until `make judges-combined` (or `make second-judge`) has written it, and null again when it was computed from an earlier pass than the summary served, so a stale mark is not shown.
  The summaries are read from `second-judge/` beside the runs directory (`data/evaluation/second-judge/` by default), never from the run.
  It is a 404 for a run that is not published and for a published run with no second judge.
  A summary that does not fit the schema is a server error naming the run.
  It is descriptive and was added after the result; see [evaluation.md](evaluation.md#the-second-judge).
- `GET /benchmarks/questions` lists the presentation world's bank for the Help screen, with each question's expected answer, the hidden truth of a planted question, and per-pipeline scores (`answer`, `evidence_recall` and `evidence_f1`, means over the scored repeats) from the run named by the optional `run_id`, else the newest official run.
  A missing or stale bank is a 503 `CONFIGURATION_ERROR`.

### Settings

`GET /settings` returns `{values, judge_configured}`.
`values` holds the reproducibility fields of an official run of the default repeats, read from the environment and the code at the time of the request, without the git fields `git_sha` and `git_dirty`.
It holds no secret, and the route makes no model call.
When no judge model is set, `judge_configured` is false and the four judge model fields (`judge_model`, `judge_model_family`, `judge_reasoning` and `judge_temperature`) are null.
An invalid setting is a 503 `CONFIGURATION_ERROR`.

### Jobs

`POST /benchmarks` starts a benchmark job on one background thread of the API process, one at a time.
The body is `{"kind": "smoke" | "dev" | "official", "seeds": [...], "repeats": n, "strata": [...] | null, "limit": n | null}`.
The harness checks the request first: an unknown seed or stratum, a repeated seed, or a kind and repeat count the harness refuses is a 422.
The API accepts the seen seeds 2026 to 2028 only, and the seed guards of D-091 apply: a dev run is on 2026 only, and a full-bank official run needs the six unseen seeds, which the API never accepts, so it starts from the command line (`make run-benchmark`).
The Results start panel defaults to `{"kind": "dev", "seeds": [2026], "repeats": 1, "strata": null, "limit": null}`.
It answers 503 `CONFIGURATION_ERROR` before any thread starts when the presentation world is not the dev world with its own ledger.
The response is 202 with `{job_id, status, run_id, error, progress}`.
`status` is `running`, `completed`, `failed` or `cancelled`, and `progress` is `{world_seed, instances_done, instances_total, worlds_done, worlds_total}`.
Jobs live in memory, so a restart empties the list and loses a running job.
A cancel is cooperative: the job stops before its next instance or world, and a cancelled or failed job writes no `summary.json`.

## Data Model routes

- A dataset is a directory with a `_manifest.json` beside the active world.
  Only those directories are listed or served, so the ledger is not reachable, and an entry that resolves outside is refused.
- The dictionary is the world's `_data_dictionary.json`, in position order, with primary keys, source system and foreign keys.
  A field the file lacks comes from the schema registry, and `dictionary_source` says `world` or `registry`.
- Each table also carries `description`, one plain line saying what a row is and what the table is for.
  It comes from `TABLE_DESCRIPTIONS` in the schema registry for both sources, so every table has one.
- `rows` takes `offset` (default 0), `limit` (default 50, at most 200) and an optional `column` and `value` together.
  `table` and `column` must be registry names, otherwise 422 before any query.
  Rows are ordered by primary key, then the other columns, and `total` counts every match.
  The filter casts the value to the column's declared type, so a timestamp copied from a row matches it, and a value that does not cast is a 422.
- `rows/{row_id}` returns the row, with its graph node and a count of its relationships by type and direction.
  A 409 `CONFLICT` means the id is not unique in a link table.
  When Neo4j cannot be read, the row is still returned with `edges` null and `graph_error` `GRAPH_QUERY_ERROR`.
  A record of another world has `graph_error` `OTHER_WORLD`.
- `GET /data-model/example` returns `{incident_id}`, the incident the Overview follows through the three layers, and nothing else.
  Over the active world's `incidents` in id order, it leaves out every incident whose id, platform version or app version the world's truth ledger names, then takes the first whose platform version is also the version of an incident left in another market (a null market is a market of its own), else the first one left, else null.
  No part of the example's path is planted, because the Overview would then point at a story's answer, and the response never says which rows were planted or why.
  A ledger that cannot be read is logged by its path and the error's type only, never the error's text, which can quote ledger content.
  The route asks the evaluator for the planted ids (`presentation_planted_ids`), so it is the third API module allowed to import `app.evaluation` (ADR-008).
  The ledger must be the active world's own: its profile, world seed, generator version and scenario seed must match the world's manifest.
  When there is no such ledger, the planted check cannot be made, so `incident_id` is null and a warning names the reason; the rule is never applied without the check.
  A world without an `incidents` table is a 404.

## Graph and reference routes

- `GET /graph/schema` reads code and configuration only: the 29 labels, every relationship type with the labels it joins (44 triples), the allow-lists for B and C, the ranking weights, the traversal caps, the label version, and `node_tables`, the source table of each label (D-058).
- `GET /graph/stats` reads `_graph_stats.json` and works without Neo4j.
  It is a 404 for a dataset without the file.
- `GET /graph/nodes/{node_id}` returns labels, properties and provenance (table, row id and dataset).
  It also returns `edges`, how many relationships of each type meet the node in each direction, for every node including ontology concepts.
  Each item of the neighbours route carries `edges` empty: the counts are read for the requested node only.
  A node no table maps to (`PrizeType`, `BusinessConcept`) has null provenance.
- `GET /graph/nodes/{node_id}/neighbours` takes `limit` (default 25, 1 to 100) and an optional relationship `type`, ordered by type, direction and id, with `truncated` when there are more.
  An optional `direction` (`out` or `in`) keeps the links that leave or reach the node; any other value is a 422, as an unknown `type` is.
- `GET /ontology` reads the YAML: the version, every concept with its parent, labels, synonyms and definition (D-058), binding counts by market, and `relationships`, which is derived from ingestion and not declared.
- `GET /ontology/concepts/{concept_id}/members` lists the bound local codes, with an optional `market` filter.
- `GET /scenarios` lists each enabled scenario with what the manifest says was planted, and never where or why.
  Each carries `description`, the catalogue's plain description of the story, which is configuration and not truth.
- `GET /models` reports the embedding, sparse, re-ranker and generation models and the judge, each as `provider`, `model`, `reachable` and `detail`.
  Results are cached for 30 seconds.
  The sparse model and re-ranker run in process, so their `reachable` is null until the lab has loaded them.
  `judge` is null while `JUDGE_PROVIDER` is `fake`.

None of the reference routes query Neo4j.
All Cypher is in `backend/app/graph/statements.py`.
Each graph request opens one reader, runs each statement once under `NEO4J_TIMEOUT_S`, and closes it.

## Health and readiness

`GET /health/ready` runs five checks concurrently, each under its own timeout.

| Check | Passes when |
|---|---|
| `lab` | The retrieval lab is built. Otherwise the detail says `building`, `not started` or that the last build failed. Readiness never builds the lab. |
| `index` | The collection exists and holds points, and a persistent index's manifest names this code's serialiser version |
| `graph` | Neo4j answers within `NEO4J_TIMEOUT_S` and holds the configured world |
| `model` | The generation model is reachable, which is not the same as warm. An Ollama model must be listed by the server. Any other provider must answer one 1-token call. Cached for 30 seconds. |
| `embedding` | The embedding model is reachable (an Ollama model must be listed) |

Details are curated sentences, and raw driver text is logged only.
Each check also carries `stand_in`, true when an offline stand-in for testing passed it in place of a real model: the fake generator for `model`, the hashing embedder for `embedding` (D-111).
A stand-in still passes, so `ready` stays true and Live Lab still runs; the header shows the difference.
The decision record D-038 names four checks (`lab`, `index`, `graph`, `model`), and the code runs five.
The decision text is behind the code on this point.

### Which world the graph holds

Neo4j holds one ingested world at a time.
The API compares the live node count of every label with the active dataset's `_graph_stats.json`, and caches the answer for 30 seconds.
When the counts differ, the node routes answer 409 `CONFLICT`, a record's `graph_error` is `OTHER_WORLD`, and the readiness graph check fails.
A run of B or C is refused with 503 `CONFIGURATION_ERROR` ("the graph holds another world; run make ingest-graph"), and a run of A alone is accepted.
Equal counts are a fingerprint and not a proof.

### The graph lease

A live run holds the graph from start until its pipelines finish, and a benchmark job holds it for its whole run.
Any number of live runs, or one job, never both (D-037).
While a job runs, `POST /queries` and the graph node routes answer 409 `CONFLICT`, `POST /benchmarks` answers 409 while a live run or another job is active, and the readiness graph check says "a benchmark run is using the graph".
`GET /graph/stats` and `GET /graph/schema` read files only and are unaffected.

## Errors

Every error body is `{"error": {"error_code", "message", "retryable"}}`.
Each code has one curated message, and the exception's own text goes to the log only.

| Status | Code | When |
|---|---|---|
| 404 | `NOT_FOUND` | An unknown run, job, dataset, row, node, concept, published run or statistics file |
| 405 | `METHOD_NOT_ALLOWED` | A method the route does not have |
| 409 | `CONFLICT` | Cancelling a finished run or job. The graph is held by a job or a run (retryable). The graph holds another world. A record id that is not unique. |
| 422 | `VALIDATION_ERROR` | A body or parameter that fails validation, an unknown field, a limit above its maximum, an unknown market, table, column or relationship type, a malformed cursor or resume point, a bank question sent with other text or scope |
| 500 | `RUN_ERROR` | An unexpected failure. The body is a generic sentence. |
| 503 | `CONFIGURATION_ERROR` | The bank is not grounded or does not match the world. A run of B or C while the graph holds another world. An invalid setting, naming the variable. |
| 503 | `GRAPH_QUERY_ERROR` | Neo4j is unreachable or busy (retryable). Other Neo4j failures are 500. |
| 503 | readiness body | `GET /health/ready` with a failed check. The body is `Readiness` and not an error object. |

A run that fails carries one of these codes in its `run.failed` payload and its `error` field:

```text
VALIDATION_ERROR  NOT_FOUND  CONFLICT  METHOD_NOT_ALLOWED  MODEL_ERROR  EMBEDDING_ERROR
VECTOR_RETRIEVAL_ERROR  GRAPH_QUERY_ERROR  CONTEXT_BUILD_ERROR  INTERRUPTED  CANCELLED
RUN_ERROR  CONFIGURATION_ERROR
```

Any other 4xx the framework raises is a `VALIDATION_ERROR`, and none is ever a `RUN_ERROR`.
A timeout appears as the error of the stage that timed out.
The error schema is one `ErrorEnvelope` declared as the response for 404, 409, 422, 503 and 500 on every route (D-042).

## Bounds

| Where | Bound |
|---|---|
| `POST /queries` | `question` 1 to 2,000 characters, `configurations` from A, B and C, `market_scope` known markets (up to four) |
| `GET /queries` | `limit` 1 to 100 (default 20), `status` one of the five run statuses |
| Event stream | Resume point a non-negative integer, heartbeat every `SSE_HEARTBEAT_S` |
| Rows | `limit` at most 200 (default 50), `column` and `value` together |
| Neighbours | `limit` 1 to 100 (default 25) |
| Graph traversal | The `GRAPH_*` settings, shown by `GET /graph/schema` |
| Neo4j reads | One statement each, under `NEO4J_TIMEOUT_S` |
| Model calls | `GENERATION_TIMEOUT_S` per call |
| Run store | `RUN_RETENTION` finished live runs |

## Operation

```bash
make dev-backend            # uvicorn with reload on :8000
make serve-demo-api         # the same, against the demo world
make api-contract           # export the OpenAPI file and regenerate the frontend types
```

The API settings are read once when the app is created: `CORS_ORIGINS`, `APP_DB_PATH`, `RUN_RETENTION`, `SSE_HEARTBEAT_S`, `BENCHMARK_DIR`, `LOG_LEVEL`, and the Neo4j connection settings.
A change needs a restart.
The retrieval, model and traversal settings are read when the lab is built.
CORS allows the configured origins, GET and POST, and the headers `content-type`, `x-request-id` and `last-event-id`.

## Testing

- Offline: `test_api_queries.py`, `test_api_runs.py`, `test_api_stream.py`, `test_api_scoring.py`, `test_api_benchmarks.py`, `test_api_data_model.py`, `test_api_graph_model.py`, `test_api_reference.py`, `test_api_example.py`, `test_api_errors.py`, `test_store.py`, `test_health.py` and `test_event_payloads.py`.
- Contract: `test_openapi_contract.py` compares the committed `openapi.json` with the app's own schema and checks it does not depend on the environment.
  `pnpm api:check` regenerates the types and compares them byte for byte.
- Live: `test_api_live.py` starts the app on the presentation world, runs the first H1 demo question over the event stream, waits for its score, restarts the app on the same run store, and checks that the run, its events and readiness survive and that no log record holds the expected answer.
  It needs `GRAPH_E2E=1`, `VECTOR_E2E=1` and `LIVE_WORLD_E2E=1`.

## Extension points

A new route needs a typed response model, the `ErrorEnvelope` responses, a test, and `make api-contract`, which updates both generated files.
A new event type needs a payload model in `events/payloads.py`, an entry in the event union, a frontend reducer case and a test.
The run store's schema changes by adding one step to its migration list and raising the schema version.
A store with a newer version than the code is refused.

## Failure modes

| Failure | What the client sees |
|---|---|
| Server stops during a run | After restart the run is `failed` with `INTERRUPTED`, and its stream ends at a terminal event. |
| Stream connection drops | Reconnect with `Last-Event-ID` or `?after=` and resume without loss. |
| Neo4j unreachable at run start | The run is accepted. B and C fail with recorded `GRAPH_QUERY_ERROR` events, and A keeps its result. |
| Benchmark job running | 409 on live runs and graph node reads. Retry when it ends. |
| Run store write fails at the end | Start-up repair takes the outcome from the stored terminal event. |

The archived contract is [reference/07-api-event-spec.md](reference/07-api-event-spec.md).
