# Phase 4: Backend as a Product API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the backend into the live, typed, persisted API that every v2 screen reads, with live event streaming, run history, read-only data-model endpoints, benchmark control, post-run scoring of bank questions and the robustness and structure fixes of spec section 6.

**Architecture:** Runs execute in one background worker per run.
They write every event to one SQLite store (ADR-007) through a recording sink, which also wakes the server-sent-event streams.
Read-only data-model endpoints sit over the existing schema registry, DuckDB over Parquet, Neo4j through centralised Cypher, the ontology loader and the world manifest.
`app.api` reaches `app.evaluation` through exactly two modules, `app/api/scoring.py` and `app/api/benchmarks.py`, as spec 10a.1 allows.

**Tech Stack:** Python 3.13, uv, FastAPI and Pydantic, the standard library `sqlite3`, DuckDB, the Neo4j 6 driver, Qdrant, pytest.
No new dependency is added: server-sent events use Starlette's `StreamingResponse`.

**Spec:** `docs/superpowers/specs/2026-10-18-overhaul-design.md`, sections 6.1, 6.2, 6.3 and 10a.1 (with 10a.6 for the presentation world).
ADR-007: `docs/architecture/adr/ADR-007-run-persistence.md`.

## Global Constraints

- All `AGENTS.md` rules apply.
  - Never use the real employer name, or "Atlas".
  - All data is synthetic.
  - All model access goes through the gateway.
  - No hidden chain of thought.
  - The API is typed and versioned, under the `/api/v1` prefix.
  - Cypher is centralised.
  - Every traversal is bounded.
  - Never log secrets.
- Truth-ledger isolation (spec 10a.1).
  - `app.retrieval`, `app.graph`, `app.ontology`, `app.datasets` and `app.scenarios` never import `app.evaluation` or `app.api`.
  - Inside `app.api`, only `app/api/scoring.py` and `app/api/benchmarks.py` may import `app.evaluation`.
  - No module outside `app.evaluation` reads the truth ledger file.
  - Question texts sent to pipelines carry no expected answer.
- The event envelope is the same for replay and stream: `event_id`, `timestamp`, `run_id`, `pipeline`, `event_type`, `t_ms`, `payload`, plus `sequence` (1-based, per run).
- Persistence follows ADR-007.
  - One SQLite database, at `data/app.db` by default (env `APP_DB_PATH`).
  - WAL journal mode.
  - The schema version lives in `PRAGMA user_version`, starting at 1.
  - Payloads are stored as JSON text.
- Run retention: keep the newest `RUN_RETENTION` live runs (default 500).
  Runs whose `kind` is `recorded` are never pruned.
- Endpoint bounds:
  - sample rows: page size default 50, maximum 200;
  - graph neighbours: default 25, maximum 100;
  - run history: limit default 20, maximum 100.
    A value above a maximum is a 422, never a silent clamp.
- Server-sent events:
  - heartbeat comment every 15 seconds (`SSE_HEARTBEAT_S`);
  - `id:` is the event `sequence`;
  - `Last-Event-ID` resumes after that sequence;
  - the stream closes after a terminal event: `run.completed`, `run.failed` or `run.cancelled`.
- Error envelope for every non-2xx response: `{"error": {"error_code": str, "message": str, "retryable": bool}}`.
  Neo4j failures map to `GRAPH_QUERY_ERROR`.
- The presentation world is dev seed 2026 (spec 10a.6).
  The data-model endpoints read the dataset the lab was built from.
- No new dependencies.
  Any that proves necessary is recorded in `DECISIONS.md` before use.
- Markdown: one sentence per line, British spelling, no em dashes.
  Commits carry no co-author line.
- Lean code (AGENTS.md):
  - no repository or service layer that only passes calls through;
  - one store module, one settings module;
  - no abstraction with a single implementation unless it isolates an external dependency or is a test seam.

## Review Focus

1. A client reconnects mid-run with `Last-Event-ID: 7`.
   It must receive events 8 onward exactly once, with none duplicated or lost.
   Test: `test_stream_resumes_after_last_event_id` (Task 6).
2. A client opens the stream of a run that has already finished.
   It must receive every stored event and the terminal event, then the stream closes, with no hang.
   Test: `test_stream_of_a_finished_run_replays_and_closes` (Task 6).
3. A run is cancelled while B is traversing.
   C never starts, B stops at its next event, A's finished result is kept, and status is `cancelled`.
   Test: `test_cancel_stops_at_the_next_stage_and_keeps_finished_pipelines` (Task 5).
4. A sample-rows request names a table that is not in the schema registry, or a filter column with SQL in it.
   It must get a 422 and no DuckDB statement may run.
   Test: `test_unknown_table_or_column_is_refused_before_any_query` (Task 9).
5. The server restarts while a run is in progress.
   On start the run shows `failed` with error code `INTERRUPTED`, never `running` for ever.
   Test: `test_runs_left_running_at_start_are_marked_interrupted` (Task 4).

---

## File Structure

| Path                                                                                            | Responsibility                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `backend/app/config/__init__.py`                                                                | The one settings module: retrieval, graph (moved from `app/graph/config.py`), API (CORS, DB path, retention, SSE heartbeat, benchmark dir), `REPO_ROOT`, `DEFAULT_DATASET_DIR` |
| `backend/app/lab.py`                                                                            | Composition root for A, B and C (moved from `app/retrieval/graph/lab.py`)                                                                                                      |
| `backend/app/traces.py`                                                                         | Trace CLI (moved from `app/retrieval/graph/traces.py`), `python -m app.traces`                                                                                                 |
| `backend/app/observability/logging.py`                                                          | JSON log formatter, `configure_logging()`, run context variables, `stage_timer`                                                                                                |
| `backend/app/persistence/store.py`                                                              | SQLite run store: schema, migrations by `user_version`, runs, events, results, retention                                                                                       |
| `backend/app/api/errors.py`                                                                     | Error codes, exception-to-code mapping, the error envelope and its handlers                                                                                                    |
| `backend/app/api/runs.py`                                                                       | Run worker: recording sink, per-pipeline status, cancellation, lab start-up                                                                                                    |
| `backend/app/api/queries.py`                                                                    | Query, history, results, replay and stream routes                                                                                                                              |
| `backend/app/api/stream.py`                                                                     | Server-sent event framing, resume and heartbeat                                                                                                                                |
| `backend/app/api/health.py`                                                                     | Liveness and readiness                                                                                                                                                         |
| `backend/app/api/data_model.py`                                                                 | Datasets, tables, records routes                                                                                                                                               |
| `backend/app/api/graph_model.py`                                                                | Graph schema, stats, node, neighbours routes                                                                                                                                   |
| `backend/app/api/reference.py`                                                                  | Ontology, scenarios, models routes                                                                                                                                             |
| `backend/app/api/benchmarks.py`                                                                 | Benchmark list, get, start, cancel, question catalogue (may import `app.evaluation`)                                                                                           |
| `backend/app/api/scoring.py`                                                                    | Post-run scoring of bank questions (may import `app.evaluation`)                                                                                                               |
| `backend/app/api/schemas.py`                                                                    | Every request and response model                                                                                                                                               |
| `backend/app/graph/statements.py`                                                               | All Cypher, including the new read statements                                                                                                                                  |
| `backend/app/retrieval/graph/stages.py`                                                         | Typed stages of the graph pipeline                                                                                                                                             |
| `docs/07-api-event-spec.md`, `docs/architecture/adr/ADR-007-run-persistence.md`, `DECISIONS.md` | API reference, store schema and retention, decisions                                                                                                                           |

---

### Task 1: One settings module, one composition root, no empty packages

**Files:**

- Modify: `backend/app/config/__init__.py`.
- Delete: `backend/app/graph/config.py`.
- Delete: `backend/app/domain/`.
- Move: `backend/app/retrieval/graph/lab.py` to `backend/app/lab.py`.
- Move: `backend/app/retrieval/graph/traces.py` to `backend/app/traces.py`.
- Modify: every importer.
- Modify: `backend/app/datasets/config.py` (drop `REPO_ROOT`).
- Modify: `backend/app/evaluation/truth_ledger.py` (import `DEFAULT_TRUTH_PATH` from `app.scenarios.ledger`).
- Modify: `Makefile` (trace target).
- Test: `backend/tests/test_settings.py` (create).
- Test: `backend/tests/test_truth_ledger_isolation.py`.

**Interfaces:**

- Produces:
  - `app.config.REPO_ROOT: Path`
  - `app.config.DEFAULT_DATASET_DIR: Path`
  - `app.config.GraphConfig` (unchanged fields; `from_env()`)
  - `app.config.ApiSettings(cors_origins: tuple[str, ...], db_path: Path, run_retention: int, sse_heartbeat_s: float, benchmark_dir: Path)`
  - `app.config.api_from_env() -> ApiSettings`
  - `app.lab.Lab`, `build_lab`, `wired_pipelines` and `graph_pipelines`, with unchanged signatures
- Env: `CORS_ORIGINS`, `APP_DB_PATH` (default `REPO_ROOT/data/app.db`), `RUN_RETENTION` (default 500), `SSE_HEARTBEAT_S` (default 15), `BENCHMARK_DIR` (default `REPO_ROOT/data/evaluation/runs`).
  Invalid values raise `ValueError` naming the variable.
- `app/models/`, `app/persistence/` and `app/observability/` stay, and are filled by Tasks 2 and 4.
- Every `__init__.py` that remains empty in a package with real modules stays as a package marker.

- [ ] **Step 1: Write the failing tests**

```python
def test_one_repo_root() -> None:
    import app.config, app.datasets.config
    assert not hasattr(app.datasets.config, "REPO_ROOT") and app.config.REPO_ROOT.joinpath("backend").is_dir()

def test_api_settings_refuse_bad_values(monkeypatch) -> None:
    monkeypatch.setenv("RUN_RETENTION", "0")
    with pytest.raises(ValueError, match="RUN_RETENTION"):
        api_from_env()

def test_no_empty_domain_package() -> None:
    assert not (BACKEND / "app" / "domain").exists()
```

Extend `test_truth_ledger_isolation.py`:

- `ISOLATED_NAMESPACES` becomes `("retrieval", "datasets", "graph", "ontology", "scenarios", "config", "events", "observability", "persistence", "models")`.
- Add `lab.py` and `traces.py` as isolated top-level modules.
- `app/api` is checked by the Task 13 rule.
- Add `test_retrieval_imports_nothing_from_api`.

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_settings.py tests/test_truth_ledger_isolation.py -v`
Expected: FAIL.

- [ ] **Step 3: Move the modules, merge the settings and update every importer**

There is no behaviour change.
`DEFAULT_TRUTH_PATH` is defined once, in `app.scenarios.ledger`, the writer.

- [ ] **Step 4: Run the full gate**

Run: `cd backend && uv run ruff format . && uv run ruff check . && uv run mypy && uv run pytest -q -W error`
Expected: PASS, with the same pass count plus the new tests.

- [ ] **Step 5: Commit**

```bash
git commit -am "refactor: one settings module, the lab and trace CLI at the app root, no empty domain package"
```

---

### Task 2: Structured JSON logging with run context and stage timings

**Files:**

- Create: `backend/app/observability/logging.py`.
- Modify: `backend/app/main.py` (configure at start-up, request-id middleware).
- Modify: `backend/app/evaluation/runner.py` and `official.py`, which use the context in place of their own `extra=` fields.
- Test: `backend/tests/test_logging.py`.

**Interfaces:**

- Produces:
  - `configure_logging(level: str = "INFO") -> None`. It installs one JSON handler on the root logger, and is idempotent.
  - `JsonFormatter` writes one JSON object per line with these keys: `ts`, `level`, `logger`, `message`, then every key of the run context and every key passed in `extra`.
  - `run_context(**fields: str) -> ContextManager[None]`. It binds `experiment_id`, `run_id`, `question_id` and `pipeline` through `contextvars`.
  - `stage_timer(stage: str) -> ContextManager[None]`. On exit it logs `stage`, `duration_ms` and `outcome` (`ok` or the exception class name).
- Stage names, logged by the API run worker and by the pipelines' existing event points:
  `embedding`, `vector_retrieval`, `graph_traversal`, `reranking`, `context_building`, `generation`, `evaluation`.
- Secrets never reach a record.
  The formatter drops any key whose name contains `key`, `token`, `password` or `secret`, case-insensitive.
- Env: `LOG_LEVEL` (default `INFO`).

- [ ] **Step 1: Write the failing tests**

```python
def test_records_are_json_with_run_context(capsys) -> None:
    configure_logging()
    with run_context(run_id="RUN-1", pipeline="B"):
        logging.getLogger("x").info("hello", extra={"api_key": "s3cret", "n": 3})
    line = json.loads(capsys.readouterr().err.strip().splitlines()[-1])
    assert line["run_id"] == "RUN-1" and line["pipeline"] == "B" and line["n"] == 3 and "api_key" not in line

def test_stage_timer_logs_duration_and_outcome(caplog) -> None:
    with pytest.raises(KeyError), stage_timer("reranking"):
        raise KeyError
    record = caplog.records[-1]
    assert record.stage == "reranking" and record.outcome == "KeyError" and record.duration_ms >= 0
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_logging.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement the module, wire it into `create_app`, and use `stage_timer` in the run worker around each pipeline**

The pipelines themselves log nothing new.
The worker times each stage from the pipeline's own stage events, so retrieval code stays free of logging plumbing.

- [ ] **Step 4: Run the tests and the gate**

Run: `cd backend && uv run pytest tests/test_logging.py tests/test_benchmark_runner.py -q && uv run mypy`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(observability): JSON logs with run context, stage timings and secret redaction"
```

---

### Task 3: One error model

**Files:**

- Create: `backend/app/api/errors.py`.
- Modify: `backend/app/api/runs.py` (use the mapping).
- Modify: `backend/app/main.py` (handlers).
- Modify: `backend/app/config/__init__.py` (`GraphConfig.timeout_s`, env `NEO4J_TIMEOUT_S`, default 10; `GenerationSettings.timeout_s`, env `GENERATION_TIMEOUT_S`, default 120).
- Modify: `backend/app/graph/reader.py` and the graph reader in retrieval (pass the timeouts).
- Test: `backend/tests/test_api_errors.py`.

**Interfaces:**

- Produces:
  - `ErrorCode` (a `StrEnum`) with these members: `VALIDATION_ERROR`, `NOT_FOUND`, `MODEL_ERROR`, `EMBEDDING_ERROR`, `VECTOR_RETRIEVAL_ERROR`, `GRAPH_QUERY_ERROR`, `CONTEXT_BUILD_ERROR`, `INTERRUPTED`, `CANCELLED`, `RUN_ERROR`.
  - `classify(exc: BaseException) -> tuple[ErrorCode, bool]`, which returns the code and whether the error is retryable.
  - `ApiErrorBody(error_code: str, message: str, retryable: bool)`.
  - `install_handlers(app: FastAPI) -> None`.
- Mapping rules:
  - Neo4j `ServiceUnavailable`, `SessionExpired` and timeouts map to `GRAPH_QUERY_ERROR`, retryable.
  - Neo4j `ClientError` maps to `GRAPH_QUERY_ERROR`, not retryable.
  - `GenerationError` and `GatewayError` map to `MODEL_ERROR`, retryable.
  - `EmbeddingError` and `SparseEmbeddingError` map to `EMBEDDING_ERROR`, retryable.
  - `VectorStoreError` maps to `VECTOR_RETRIEVAL_ERROR`, retryable.
  - `RerankError` maps to `CONTEXT_BUILD_ERROR`, not retryable.
  - Anything else maps to `RUN_ERROR`, not retryable.
- HTTP:
  - FastAPI validation errors become 422 `VALIDATION_ERROR`.
  - `HTTPException(404)` becomes `NOT_FOUND`.
  - An unhandled error becomes 500 `RUN_ERROR` with a generic message.
  - The technical detail goes to the log, never to the body.

- [ ] **Step 1: Write the failing tests**

```python
@pytest.mark.parametrize(("exc", "code", "retryable"), [
    (neo4j.exceptions.ServiceUnavailable("down"), "GRAPH_QUERY_ERROR", True),
    (neo4j.exceptions.ClientError("bad"), "GRAPH_QUERY_ERROR", False),
    (GenerationError("x"), "MODEL_ERROR", True),
    (ValueError("x"), "RUN_ERROR", False),
])
def test_classify(exc, code, retryable) -> None:
    assert classify(exc) == (code, retryable)

def test_every_error_response_uses_the_envelope(client) -> None:
    body = client.get("/api/v1/queries/RUN-nope").json()
    assert body == {"error": {"error_code": "NOT_FOUND", "message": "unknown run_id", "retryable": False}}

def test_a_neo4j_outage_surfaces_as_graph_query_error(client_with_failing_graph) -> None:
    run = run_to_completion(client_with_failing_graph, configurations=["B"])
    assert run["error"]["error_code"] == "GRAPH_QUERY_ERROR" and run["error"]["retryable"] is True
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_api_errors.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement it.** Remove `_ERROR_CODES` from `runs.py`, and update `test_api_queries.py` assertions that read FastAPI's `{"detail": ...}` body.

- [ ] **Step 4: Run the tests**

Run: `cd backend && uv run pytest tests/test_api_errors.py tests/test_api_queries.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(api): one error envelope, GRAPH_QUERY_ERROR and configured timeouts"
```

---

### Task 4: SQLite run store

**Files:**

- Create: `backend/app/persistence/store.py`.
- Modify: `docs/architecture/adr/ADR-007-run-persistence.md` (append "As built": schema and retention).
- Test: `backend/tests/test_store.py`.

**Interfaces:**

- Produces:
  - `SCHEMA_VERSION = 1`.
  - `RunRow(run_id: str, kind: str, status: str, question: str, market_scope: tuple[str, ...], configurations: tuple[str, ...], benchmark_instance_id: str | None, created_at: str, finished_at: str | None, pipeline_status: dict[str, str], error: dict[str, Any] | None)`.
    - `kind` is one of `live` or `recorded`.
    - `status` is one of `queued`, `running`, `completed`, `failed` or `cancelled`.
    - `pipeline_status` values are `pending`, `running`, `completed`, `failed`, `cancelled` or `skipped`.
  - `class RunStore`, with these methods:
    - `__init__(path: Path, retention: int)`: opens the database, sets WAL, migrates.
    - `create_run(row: RunRow) -> None`: prunes after insert.
    - `update_run(run_id: str, **fields: Any) -> None`.
    - `get_run(run_id: str) -> RunRow | None`.
    - `list_runs(limit: int, before: str | None, status: str | None) -> list[RunRow]`: newest first by `created_at`, with `before` as an exclusive `created_at` cursor.
    - `append_event(run_id: str, event: dict[str, Any]) -> int`: returns the sequence.
    - `events(run_id: str, after: int = 0) -> list[dict[str, Any]]`.
    - `put_result(run_id: str, pipeline: str, result: dict[str, Any]) -> None`.
    - `results(run_id: str) -> dict[str, dict[str, Any]]`.
    - `put_score(run_id: str, score: dict[str, Any]) -> None`.
    - `score(run_id: str) -> dict[str, Any] | None`.
    - `mark_interrupted() -> int`.
- Tables:
  - `runs` (columns as in `RunRow`, JSON for tuples and dicts);
  - `events` (`run_id`, `sequence`, `event_json`, primary key `(run_id, sequence)`);
  - `results` (`run_id`, `pipeline`, `result_json`, primary key `(run_id, pipeline)`);
  - `scores` (`run_id` primary key, `score_json`).
    Deleting a run cascades to the other three tables.
- `append_event` assigns `sequence = max + 1` inside one transaction, so sequences are gap-free under concurrent writers.
  One connection per thread, with `check_same_thread=False` avoided by giving each thread its own connection.
- `mark_interrupted` runs at start-up.
  It sets every `queued` or `running` run to `failed` with error `{"error_code": "INTERRUPTED", "message": "the server stopped during this run", "retryable": true}`.
- Retention keeps the newest `retention` runs of kind `live`.
  Recorded runs are never pruned.
- An unknown future `user_version` raises `RuntimeError` naming both versions; the store never downgrades.

- [ ] **Step 1: Write the failing tests**

```python
def test_sequences_are_gap_free_across_threads(store) -> None:
    store.create_run(row("RUN-1"))
    with ThreadPoolExecutor(8) as pool:
        list(pool.map(lambda i: store.append_event("RUN-1", {"i": i}), range(200)))
    assert [e["sequence"] for e in store.events("RUN-1")] == list(range(1, 201))

def test_retention_prunes_old_live_runs_and_keeps_recorded(tmp_path) -> None:
    store = RunStore(tmp_path / "app.db", retention=2)
    for n, kind in enumerate(["recorded", "live", "live", "live"]):
        store.create_run(row(f"RUN-{n}", kind=kind, created_at=f"2026-10-20T00:00:0{n}+00:00"))
    assert {r.run_id for r in store.list_runs(100, None, None)} == {"RUN-0", "RUN-2", "RUN-3"}

def test_runs_left_running_at_start_are_marked_interrupted(tmp_path) -> None:
    RunStore(tmp_path / "app.db", 10).create_run(row("RUN-1", status="running"))
    reopened = RunStore(tmp_path / "app.db", 10)
    assert reopened.mark_interrupted() == 1 and reopened.get_run("RUN-1").error["error_code"] == "INTERRUPTED"

def test_a_newer_schema_is_refused(tmp_path) -> None:
    sqlite3.connect(tmp_path / "app.db").execute("PRAGMA user_version = 99")
    with pytest.raises(RuntimeError, match="99"):
        RunStore(tmp_path / "app.db", 10)
```

Also add `test_history_pages_with_before_and_status`, `test_results_and_score_round_trip` and `test_events_after_a_sequence`.

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_store.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement `store.py`, and append the as-built schema and retention to ADR-007**

- [ ] **Step 4: Run the tests**

Run: `cd backend && uv run pytest tests/test_store.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(persistence): SQLite run store with gap-free event sequences, retention and interrupted runs"
```

---

### Task 5: Live run worker, per-pipeline status, cancellation and history

**Files:**

- Modify: `backend/app/api/runs.py` (rewrite around the store).
- Modify: `backend/app/api/queries.py` and `backend/app/api/schemas.py`.
- Modify: `backend/app/events/__init__.py`: add `run_id` to the envelope through the recording sink, add the run-level event types, delete the unused `new_run_id`.
- Test: `backend/tests/test_api_runs.py` (create; move the run tests out of `test_api_queries.py`).

**Interfaces:**

- Consumes: `RunStore` (Task 4), `classify` (Task 3), `run_context` and `stage_timer` (Task 2), `app.lab` (Task 1).
- Produces:
  - `RecordingSink(store: RunStore, run_id: str, cancelled: threading.Event)`, an `EventSink`.
    - `emit` appends to the store and notifies waiters through a per-run `threading.Condition`, exposed as `QueryService.wait_for(run_id, after, timeout) -> bool`.
    - `emit` raises `RunCancelled` when `cancelled` is set. Every pipeline event is therefore a cancellation point between stages.
  - Run-level event types: `run.started`, `pipeline.started`, `pipeline.completed`, `pipeline.failed`, `pipeline.cancelled`, `run.completed`, `run.failed`, `run.cancelled`.
    Pipeline `"run"` is used for run-level events.
    `run.error` is retired; `run.failed` carries the error envelope as payload.
  - `QueryService(store: RunStore, lab_factory: Callable[[], Lab], graph_config: GraphConfig)`, with methods:
    - `start(request: QueryRequest) -> str`;
    - `cancel(run_id: str) -> bool`, which returns False when the run is unknown or already finished;
    - `wait_for(run_id: str, after: int, timeout: float) -> bool`.
- Routes:
  - `POST /api/v1/queries` (202, unchanged shape);
  - `GET /api/v1/queries?limit&before&status` returns `RunHistory(runs: list[RunSummary], next_before: str | None)`;
  - `GET /api/v1/queries/{run_id}` returns `QueryResults` from the store, with `pipeline_status`;
  - `POST /api/v1/queries/{run_id}/cancel` returns 202 `RunSummary`, or 409 `VALIDATION_ERROR` when the run has already finished;
  - `GET /api/v1/queries/{run_id}/events` returns `EventStream`. Its events carry `run_id` and `sequence`.
- Pipelines run in order A, B, C inside one worker thread per run.
  Each result is stored as soon as its pipeline finishes, so A is readable while C is still traversing.
- The service lock guards only the store handle and the in-memory map of cancel flags.
  The lab is built once by `lab_factory` behind its own `threading.Lock`, which no route holds.
  Cold-start indexing therefore never blocks history or results requests.
- `QueryRequest.profile` and `DemoQuestion.profile` are removed.
  A request that sends `profile` gets a 422.
  Update `frontend/src/api/backend-run.ts` and its test to stop sending it and to read `run.failed`.

- [ ] **Step 1: Write the failing tests** (fake lab with the fake generator, store in `tmp_path`)

```python
def test_results_of_a_finished_pipeline_are_readable_while_the_next_runs(service_with_slow_c) -> None:
    run_id = service_with_slow_c.start(request(configurations=["A", "C"]))
    wait_until(lambda: store(service_with_slow_c).get_run(run_id).pipeline_status["A"] == "completed")
    assert "A" in store(service_with_slow_c).results(run_id) and store(service_with_slow_c).get_run(run_id).pipeline_status["C"] == "running"

def test_cancel_stops_at_the_next_stage_and_keeps_finished_pipelines(service_with_slow_b) -> None:
    run_id = service_with_slow_b.start(request(configurations=["A", "B", "C"]))
    wait_until(lambda: pipeline_running(service_with_slow_b, run_id, "B"))
    assert service_with_slow_b.cancel(run_id)
    run = wait_finished(service_with_slow_b, run_id)
    assert run.status == "cancelled" and run.pipeline_status == {"A": "completed", "B": "cancelled", "C": "skipped"}

def test_events_carry_run_id_and_gap_free_sequences(client) -> None:
    events = run_to_completion(client)["events"]
    assert {e["run_id"] for e in events} == {events[0]["run_id"]} and [e["sequence"] for e in events] == list(range(1, len(events) + 1))
    assert events[0]["event_type"] == "run.started" and events[-1]["event_type"] == "run.completed"

def test_history_lists_newest_first_and_pages(client) -> None:
    ids = [start(client) for _ in range(3)]
    page = client.get("/api/v1/queries?limit=2").json()
    assert [r["run_id"] for r in page["runs"]] == ids[::-1][:2] and page["next_before"]

def test_history_limit_above_the_maximum_is_refused(client) -> None:
    assert client.get("/api/v1/queries?limit=101").status_code == 422

def test_a_slow_cold_start_does_not_block_history(client_with_slow_lab) -> None:
    start(client_with_slow_lab)
    assert client_with_slow_lab.get("/api/v1/queries", timeout=1).status_code == 200
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_api_runs.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement the worker, the routes and the frontend client change**

- [ ] **Step 4: Run the backend and frontend tests**

Run: `cd backend && uv run pytest tests/test_api_runs.py tests/test_api_queries.py tests/test_api_errors.py -q`
Then run Vitest for `backend-run.test.ts` with the pnpm.mjs workaround (`node ~/.cache/node/corepack/v1/pnpm/12.14.0/bin/pnpm.mjs vitest run src/api` in `frontend/`).
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(api): persisted runs with live per-pipeline results, cooperative cancellation and history"
```

---

### Task 6: Server-sent event stream

**Files:**

- Create: `backend/app/api/stream.py`.
- Modify: `backend/app/api/queries.py`.
- Test: `backend/tests/test_api_stream.py`.

**Interfaces:**

- Consumes: `RunStore.events`, `QueryService.wait_for` (Task 5), `ApiSettings.sse_heartbeat_s`.
- Produces:
  - `GET /api/v1/queries/{run_id}/events/stream`, with media type `text/event-stream`.
  - `sse_frames(run_id: str, after: int, store: RunStore, wait_for: Callable[[str, int, float], bool], heartbeat_s: float) -> Iterator[str]`.
- Framing per event: `id: <sequence>\nevent: <event_type>\ndata: <envelope JSON>\n\n`.
  The heartbeat is `: keep-alive\n\n`.
  The resume point is the `Last-Event-ID` header, or the `?after=` query parameter.
  An unknown run gets a 404 envelope before the stream opens.
  After the terminal event the generator returns.

- [ ] **Step 1: Write the failing tests** (drive `sse_frames` directly with a fake clock and condition; one HTTP test through `TestClient.stream`)

```python
def test_stream_resumes_after_last_event_id(finished_run) -> None:
    frames = list(sse_frames(finished_run.run_id, 7, finished_run.store, finished_run.wait_for, 15))
    assert ids(frames) == list(range(8, finished_run.count + 1))

def test_stream_of_a_finished_run_replays_and_closes(client, finished_run_id) -> None:
    with client.stream("GET", f"/api/v1/queries/{finished_run_id}/events/stream") as response:
        text = "".join(response.iter_text())
    assert text.rstrip().endswith("}") and "event: run.completed" in text

def test_heartbeat_while_waiting(slow_run) -> None:
    first = next(sse_frames(slow_run.run_id, slow_run.count, slow_run.store, slow_run.never_wakes, 0.01))
    assert first == ": keep-alive\n\n"

def test_stream_and_replay_share_one_envelope(client, finished_run_id) -> None:
    replay = client.get(f"/api/v1/queries/{finished_run_id}/events").json()["events"]
    assert parsed_stream(client, finished_run_id) == replay
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_api_stream.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement it**

- [ ] **Step 4: Run the tests**

Run: `cd backend && uv run pytest tests/test_api_stream.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(api): server-sent event stream with resume, heartbeat and terminal close"
```

---

### Task 7: Readiness and embedding checks

**Files:**

- Modify: `backend/app/api/health.py`.
- Modify: `backend/app/retrieval/standard/embeddings.py` (L2-normalise Ollama vectors, check dimensions).
- Modify: `backend/app/lab.py` (check the collection's vector size against the embedder at build).
- Test: `backend/tests/test_health.py`, `backend/tests/test_embeddings.py`.

**Interfaces:**

- Produces:
  - `GET /api/v1/health` (liveness) returns `{status: "ok", version}`, unchanged.
  - `GET /api/v1/health/ready` returns `Readiness(ready: bool, checks: dict[str, Check])`, with `Check(ok: bool, detail: str)`.
    The status is 200 when ready, otherwise 503 with the same body.
- Checks:
  - `lab` (built without error);
  - `index` (the collection exists, holds points, and its manifest's serialiser version matches);
  - `graph` (Neo4j answers `RETURN 1` within `NEO4J_TIMEOUT_S`);
  - `model` (the generation provider is reachable: `fake` is always ok; litellm makes one gateway call to the provider's model list or a 1-token completion with `max_tokens=1`).
    Each check runs with its own timeout, and readiness never raises.
- `OllamaEmbedder.embed` returns unit vectors.
  A vector whose length differs from `self.dimensions` raises `EmbeddingError` naming both numbers.
- `build_lab` raises `VectorStoreError` naming both numbers when the existing collection's size differs from the embedder's.
- Vector hits: add the test that pins identical handling, as spec 6.3 requires.
  Hits are built from the Qdrant payload only, in every pipeline, through `hit_to_evidence`.

- [ ] **Step 1: Write the failing tests**

```python
def test_ready_reports_each_check_and_503_when_the_graph_is_down(client_with_graph_down) -> None:
    response = client_with_graph_down.get("/api/v1/health/ready")
    assert response.status_code == 503 and response.json()["checks"]["graph"]["ok"] is False and response.json()["checks"]["lab"]["ok"] is True

def test_ollama_vectors_are_unit_length(stub_ollama) -> None:
    (vector,) = OllamaEmbedder(...).embed(["x"])
    assert math.isclose(math.fsum(v * v for v in vector), 1.0, rel_tol=1e-9)

def test_a_wrong_dimension_is_refused(stub_ollama_returning_512) -> None:
    with pytest.raises(EmbeddingError, match="1024.*512|512.*1024"):
        OllamaEmbedder(..., dimensions=1024).embed(["x"])

def test_a_collection_of_another_size_is_refused_at_build(in_memory_store_of_size_8) -> None:
    with pytest.raises(VectorStoreError, match="8"):
        build_lab(settings_with_dimensions(16), store=in_memory_store_of_size_8)

def test_vector_hits_are_built_from_the_payload_in_every_pipeline(offline_lab) -> None:
    assert all(uses_payload_only(p) for p in pipelines(offline_lab))
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_health.py tests/test_embeddings.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement it**

- [ ] **Step 4: Run the tests and the fairness suite**

Run: `cd backend && uv run pytest tests/test_health.py tests/test_embeddings.py tests/test_lab_fairness.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(api): readiness checks; unit-length, dimension-checked embeddings"
```

---

### Task 8: Graph pipeline in typed stages, and table-driven seed resolution

**Files:**

- Create: `backend/app/retrieval/graph/stages.py`.
- Modify: `backend/app/retrieval/graph/pipeline.py` (`run()` composes the stages).
- Modify: `backend/app/retrieval/graph/resolution.py` (id prefixes from the schema registry).
- Test: `backend/tests/test_graph_stages.py`.
- Test: the existing `test_graph_rag.py`, `test_lab_fairness.py` and `test_traces.py` must pass unchanged.

**Interfaces:**

- Produces, in `stages.py`, one function per stage with typed inputs and outputs:
  - `resolve(...) -> Resolution`
  - `traverse(...) -> Traversal`
  - `rank_and_scope(...) -> Ranked`
  - `select_and_attach(...) -> Selection`
  - `document_channel(...) -> DocumentCandidates`
  - `assemble_and_generate(...) -> Answer`
    Each takes only what it needs, plus the `EventEmitter`.
    `GraphRagPipeline.run` becomes the ordered composition, at most 40 lines.
- Seed id prefixes are derived from the registry that maps tables to graph labels (`source_lookup.RECORD_LABELS` and the dataset schema's id columns), not from the literal `_SEED_PREFIXES` tuple.
  A new table bound to a label becomes resolvable without editing `resolution.py`.
- No behaviour change: event order, payloads, selection and answers are identical.
  Ingestion is already split into `node_rows.py` and `relationship_rows.py`, and the inventory found no quadratic rebuild.
  Record that in the task report; no ingestion change is made.

- [ ] **Step 1: Write the failing tests**

```python
def test_run_composes_the_stages_in_order(monkeypatch, offline_graph) -> None:
    calls = record_stage_calls(monkeypatch)
    offline_graph.pipeline_c.run("Which markets ran INC_001?")
    assert calls == ["resolve", "traverse", "rank_and_scope", "document_channel", "select_and_attach", "assemble_and_generate"]

def test_seed_prefixes_come_from_the_schema_registry() -> None:
    assert set(seed_prefixes()) == {id_prefix(table) for table in RECORD_LABELS}

def test_event_stream_is_unchanged(offline_graph, golden_events) -> None:
    assert [(e.event_type, e.payload) for e in run_events(offline_graph)] == golden_events
```

Capture `golden_events` from the current implementation in `tests/fixtures/graph_events_c.json` before refactoring, and commit it with the test.

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_graph_stages.py -v`
Expected: the stage tests FAIL; the golden test PASSES on the unrefactored code.

- [ ] **Step 3: Split `run()` into the stages and derive the prefixes**

- [ ] **Step 4: Run the tests**

Run: `cd backend && uv run pytest tests/test_graph_stages.py tests/test_graph_rag.py tests/test_lab_fairness.py tests/test_traces.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "refactor(retrieval): graph pipeline as typed stages; seed prefixes from the schema registry"
```

---

### Task 9: Datasets, tables and records

**Files:**

- Create: `backend/app/api/data_model.py`.
- Modify: `backend/app/api/schemas.py` and `backend/app/main.py`.
- Modify: `backend/app/graph/statements.py` (record node and edge-summary read).
- Test: `backend/tests/test_api_data_model.py`.

**Interfaces:**

- Consumes: `app.datasets.schema.TABLE_SCHEMAS`, the dataset `_manifest.json`, the index manifest, and `Lab.settings.dataset_dir`.
- Routes:
  - `GET /api/v1/datasets` returns `list[DatasetSummary(dataset_id, generator_version, world_seed, scenario_seed, profile, row_counts, active: bool)]`.
    It lists every directory under `data/generated/` with a manifest; `active` marks the lab's dataset.
  - `GET /api/v1/datasets/{dataset_id}` returns `DatasetDetail(summary, provenance, index_status: IndexStatus(collection, points, serialiser_version, built_at))`.
  - `GET /api/v1/datasets/{dataset_id}/dictionary` returns `list[TableSchemaOut(table, source_system, primary_key, columns: list[ColumnOut(name, type, description)], foreign_keys: list[ForeignKeyOut(column, table, ref_column)], provenance)]`.
  - `GET /api/v1/datasets/{dataset_id}/tables/{table}/rows?offset&limit&column&value` returns `RowPage(table, offset, limit, total, rows: list[dict[str, JsonValue]])`.
  - `GET /api/v1/datasets/{dataset_id}/tables/{table}/rows/{row_id}` returns `RecordOut(table, row, graph_node_id: str | None, edges: list[EdgeSummary(type, direction, count)])`.
- Rules:
  - `table` and `column` must be names in `TABLE_SCHEMAS`, otherwise 422 before any query.
  - `value` is bound as a DuckDB parameter.
  - The Parquet path is built from the validated table name only.
  - `dataset_id` must be one of the listed directory names (no path segments).
  - Truth-ledger files and anything under `data/truth/` are never listed.

- [ ] **Step 1: Write the failing tests** (on the tiny world fixture)

```python
def test_unknown_table_or_column_is_refused_before_any_query(client, spy_duckdb) -> None:
    assert client.get("/api/v1/datasets/tiny/tables/players;drop/rows").status_code == 422
    assert client.get("/api/v1/datasets/tiny/tables/players/rows?column=1=1--&value=x").status_code == 422
    assert spy_duckdb.statements == []

def test_dataset_id_cannot_escape_the_data_directory(client) -> None:
    assert client.get("/api/v1/datasets/..%2Ftruth").status_code in (404, 422)

def test_rows_page_and_filter_with_a_bound_value(client) -> None:
    page = client.get("/api/v1/datasets/tiny/tables/players/rows?limit=2&column=market_id&value=MKT_GR").json()
    assert page["limit"] == 2 and all(r["market_id"] == "MKT_GR" for r in page["rows"]) and page["total"] >= len(page["rows"])

def test_page_size_above_the_maximum_is_refused(client) -> None:
    assert client.get("/api/v1/datasets/tiny/tables/players/rows?limit=201").status_code == 422

def test_dictionary_names_keys_sources_and_provenance(client) -> None:
    players = table(client.get("/api/v1/datasets/tiny/dictionary").json(), "players")
    assert players["primary_key"] == "player_id" and players["source_system"] and players["foreign_keys"]
```

Add `test_record_carries_its_graph_node_and_edge_summary`, which is graph-gated (`GRAPH_E2E`) plus an offline fake-reader version.

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_api_data_model.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement it**

- [ ] **Step 4: Run the tests**

Run: `cd backend && uv run pytest tests/test_api_data_model.py tests/test_truth_ledger_isolation.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(api): datasets, data dictionary, paginated rows and records with their graph node"
```

---

### Task 10: Graph schema, stats, nodes and neighbours

**Files:**

- Create: `backend/app/api/graph_model.py`.
- Modify: `backend/app/graph/statements.py` (node by id, bounded neighbours).
- Modify: `backend/app/api/schemas.py`.
- Test: `backend/tests/test_api_graph_model.py`.

**Interfaces:**

- Routes:
  - `GET /api/v1/graph/schema` returns `GraphSchema(labels: list[str], relationship_types: list[RelTypeOut(type, from_label, to_label)], allow_list: dict[str, list[str]], weights: dict[str, float], caps: dict[str, int], label_version)`.
    `allow_list` is keyed by pipeline (`B`, `C`) from `bc_graph_settings`.
  - `GET /api/v1/graph/stats` returns `GraphStats(nodes_by_label, relationships_by_type, ingestion_version, source: "ingestion")` from `_graph_stats.json` beside the active dataset.
    It works without Neo4j.
  - `GET /api/v1/graph/nodes/{node_id}` returns `NodeOut(node_id, labels, properties, provenance: ProvenanceOut(table, row_id, dataset_id))`.
  - `GET /api/v1/graph/nodes/{node_id}/neighbours?limit&type` returns `Neighbours(node_id, items: list[NeighbourOut(rel_type, direction, node: NodeOut)], truncated: bool)`.
    The query fetches `limit + 1` to set `truncated`.
    `type` must be a known relationship type, otherwise 422.
- All Cypher lives in `statements.py`, with every limit a parameter.
- Neo4j failures surface as `GRAPH_QUERY_ERROR` through Task 3.

- [ ] **Step 1: Write the failing tests** (offline with a fake reader; one `GRAPH_E2E` test against the live graph)

```python
def test_stats_work_without_neo4j(client_without_graph) -> None:
    stats = client_without_graph.get("/api/v1/graph/stats").json()
    assert sum(stats["nodes_by_label"].values()) == expected_node_total() and stats["ingestion_version"]

def test_neighbours_are_bounded_and_report_truncation(client_with_fake_graph_of_degree_30) -> None:
    body = client_with_fake_graph_of_degree_30.get("/api/v1/graph/nodes/PLAYER_GR_000001/neighbours?limit=25").json()
    assert len(body["items"]) == 25 and body["truncated"] is True

def test_neighbour_limit_above_the_maximum_is_refused(client) -> None:
    assert client.get("/api/v1/graph/nodes/X/neighbours?limit=101").status_code == 422

def test_schema_shows_the_b_and_c_allow_lists(client) -> None:
    schema = client.get("/api/v1/graph/schema").json()
    assert set(schema["allow_list"]) == {"B", "C"} and "SIMILAR_TO" in schema["allow_list"]["C"] and "SIMILAR_TO" not in schema["allow_list"]["B"]
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_api_graph_model.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement it**

- [ ] **Step 4: Run the tests**

Run: `cd backend && uv run pytest tests/test_api_graph_model.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(api): graph schema, ingestion stats, nodes with provenance and bounded neighbours"
```

---

### Task 11: Ontology, scenarios and models

**Files:**

- Create: `backend/app/api/reference.py`.
- Modify: `backend/app/api/schemas.py`.
- Test: `backend/tests/test_api_reference.py`.

**Interfaces:**

- Routes:
  - `GET /api/v1/ontology` returns `OntologyOut(version, concepts: list[ConceptOut(concept_id, parent_id, labels: dict[str, str], synonyms: dict[str, list[str]], allowed_relationships: list[str], binding_counts: dict[str, int])])`.
    `labels` and `synonyms` are keyed by language; `binding_counts` is keyed by market.
  - `GET /api/v1/ontology/concepts/{concept_id}/members?market` returns `list[MemberOut(kind, code, market_id, name)]`.
  - `GET /api/v1/scenarios` returns `list[ScenarioOut(scenario_id, scenario_type, title, planted: bool, planted_rows: dict[str, int], strength, noise_level)]`.
    It is built from `app.scenarios.catalogue` and the active dataset's `_manifest.json` `scenarios.applied`.
    It carries no truth.
  - `GET /api/v1/models` returns `ModelsOut(embedding: ModelOut, sparse: ModelOut, rerank: ModelOut, generation: ModelOut)`, with `ModelOut(provider, model, reachable: bool | None, detail)`.
    Reachability reuses Task 7's checks and is cached for 30 seconds.
- Hidden truths and expected answers are served only by Task 12.

- [ ] **Step 1: Write the failing tests**

```python
def test_concepts_carry_four_language_labels(client) -> None:
    concept = next(c for c in client.get("/api/v1/ontology").json()["concepts"] if c["concept_id"] == NUMBER_DRAW)
    assert set(concept["labels"]) >= {"en", "el", "de", "cs"} and sum(concept["binding_counts"].values()) > 0

def test_scenarios_report_planted_rows_and_no_truth(client) -> None:
    scenarios = client.get("/api/v1/scenarios").json()
    assert len(scenarios) == 8 and all(s["planted"] for s in scenarios)
    assert not any(key in json.dumps(scenarios) for key in ("required_evidence", "expected_signals", "truth"))

def test_models_name_the_configured_providers(client) -> None:
    body = client.get("/api/v1/models").json()
    assert body["generation"]["provider"] == "fake" and body["generation"]["reachable"] is True
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_api_reference.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement it**

- [ ] **Step 4: Run the tests**

Run: `cd backend && uv run pytest tests/test_api_reference.py tests/test_truth_ledger_isolation.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(api): ontology tree and members, scenario catalogue with planted rows, configured models"
```

---

### Task 12: Benchmarks: list, get, start, cancel and the question catalogue

**Files:**

- Create: `backend/app/api/benchmarks.py`.
- Modify: `backend/app/api/queries.py` (move `/benchmarks/latest` here).
- Modify: `backend/app/evaluation/official.py` (cooperative cancel between instances: `run_benchmark(..., cancelled: threading.Event | None = None)`).
- Create: `backend/app/evaluation/catalogue.py`.
- Test: `backend/tests/test_api_benchmarks.py`.

**Interfaces:**

- Produces:
  - `app.evaluation.catalogue.question_catalogue(bank: FrozenBank, ledger_path: Path) -> list[QuestionCard]`.
    `QuestionCard` has these fields: `question_id`, `instance_id`, `text`, `tests`, `stratum`, `scenario_id`, `ontology_dependent`, `expected_answer`, `hidden_truth`.
    `hidden_truth` is the scenario narrative from the ledger for H5, otherwise None.
- Routes:
  - `GET /api/v1/benchmarks` returns `list[BenchmarkRunOut(run_id, run_kind, label, started_at, selection, worlds)]`, newest first.
    It is read from `summary.json` files.
  - `GET /api/v1/benchmarks/latest` is unchanged.
  - `GET /api/v1/benchmarks/{run_id}` returns the run's `summary.json` as `BenchmarkSummary`.
  - `GET /api/v1/benchmarks/questions?run_id` returns `list[QuestionOut(card fields, scores: dict[str, PipelineScore] | None)]`.
    The questions come from the frozen seed-2026 bank.
    The scores come from the given run's `results.json`, or the latest official run.
    They are means over repeats, with None when no run exists.
  - `POST /api/v1/benchmarks` takes `BenchmarkStart(kind: Literal["smoke", "official"], seeds: list[int], repeats: int, strata: list[str] | None, limit: int | None)` and returns 202 `BenchmarkJob(job_id, status)`.
    Only one benchmark job runs at a time; a second start gets 409.
    Official runs pass `app.evaluation.official.preflight` (Phase 3) before 202.
  - `GET /api/v1/benchmarks/jobs/{job_id}` returns `BenchmarkJob(job_id, status, run_id | None, error | None, progress: JobProgress(world_seed, instances_done, instances_total))`.
  - `POST /api/v1/benchmarks/jobs/{job_id}/cancel` returns 202.
- A cancelled job writes no `summary.json`, and restores the presentation graph through `run_benchmark`'s existing restore.
- Jobs are kept in memory.
  A restart loses a running job, and the run directory then has no `summary.json`, so it is never published.
- Isolation, rewritten in `test_truth_ledger_isolation.py`:
  - `test_only_two_api_modules_import_evaluation` asserts the set of `app/api` files importing `app.evaluation` is exactly `{benchmarks.py, scoring.py}`.
  - `test_api_reads_the_ledger_only_through_evaluation` asserts no `app/api` file mentions `data/truth` or `truth_ledger`.

- [ ] **Step 1: Write the failing tests** (tiny world, recorders for `run_benchmark`)

```python
def test_question_catalogue_serves_answer_keys_and_hidden_truths(client_with_bank) -> None:
    questions = client_with_bank.get("/api/v1/benchmarks/questions").json()
    h5 = [q for q in questions if q["stratum"] == "H5"]
    assert questions and all(q["expected_answer"] for q in questions) and all(q["hidden_truth"] for q in h5)

def test_one_benchmark_job_at_a_time(client_with_blocking_benchmark) -> None:
    assert client_with_blocking_benchmark.post("/api/v1/benchmarks", json=smoke()).status_code == 202
    assert client_with_blocking_benchmark.post("/api/v1/benchmarks", json=smoke()).status_code == 409

def test_cancelled_job_publishes_nothing(client_with_blocking_benchmark, runs_dir) -> None:
    job = client_with_blocking_benchmark.post("/api/v1/benchmarks", json=smoke()).json()
    client_with_blocking_benchmark.post(f"/api/v1/benchmarks/jobs/{job['job_id']}/cancel")
    assert wait_job(client_with_blocking_benchmark, job["job_id"])["status"] == "cancelled" and not list(runs_dir.glob("*/summary.json"))

def test_official_start_runs_preflight_before_accepting(client) -> None:
    response = client.post("/api/v1/benchmarks", json={"kind": "official", "seeds": [2026], "repeats": 1})
    assert response.status_code == 422 and response.json()["error"]["error_code"] == "VALIDATION_ERROR"
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_api_benchmarks.py tests/test_truth_ledger_isolation.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement it**

- [ ] **Step 4: Run the tests**

Run: `cd backend && uv run pytest tests/test_api_benchmarks.py tests/test_official.py tests/test_truth_ledger_isolation.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(api): benchmark runs list, jobs with cancel, and the question catalogue with answer keys"
```

---

### Task 13: Post-run scoring of bank questions and demo questions from the bank

**Files:**

- Create: `backend/app/api/scoring.py`.
- Modify: `backend/app/api/runs.py` (call scoring after the run record is final).
- Modify: `backend/app/api/queries.py` (demo questions).
- Modify: `backend/app/api/schemas.py` (`QueryRequest.benchmark_instance_id`, `QueryResults.score`).
- Test: `backend/tests/test_api_scoring.py`.

**Interfaces:**

- Produces:
  - `score_run(run: RunRow, results: dict[str, dict[str, Any]], bank: FrozenBank) -> LiveScore`.
    `LiveScore` has three fields:
    - `instance_id`;
    - `label`, which is `"scored against the answer key"`;
    - `per_pipeline: dict[str, LivePipelineScore(answer: float | None, evidence_f1: float | None, anchor_resolution: float | None, failure_class: str | None)]`.
      It uses the deterministic scorers only, never the judge.
  - `DEMO_STRATA = ("H1", "H2", "H3", "H5")`.
  - `demo_questions(bank: FrozenBank) -> list[DemoQuestion]` takes the first instance in bank order of each of those strata.
    `DemoQuestion` has these fields: `instance_id`, `question_id`, `text`, `stratum`, `market_scope`.
- Rules:
  - A run started with `benchmark_instance_id` sends only the instance's `text` to the pipelines.
  - The worker calls `score_run` only after every pipeline's result is stored and the run status is final (`completed`).
  - The score is stored with `RunStore.put_score` and returned in `QueryResults.score`.
  - A cancelled or failed run is not scored.
  - An ad hoc question has `score: None`, and `QueryResults.answer_key: Literal["none"]` states that no answer key exists.
  - The four v1 demo questions (Q30, Q25, Q28 and so on) are deleted.
- The frontend's Live Lab v2 note from Phase 3 is removed in `backend-run.ts` and `live-lab.tsx`.
  Live Lab shows the `score.label` and the per-pipeline values as plain text, until Phase 6 redesigns it.

- [ ] **Step 1: Write the failing tests**

```python
def test_scoring_happens_only_after_the_run_record_is_complete(service, spy_score) -> None:
    run_id = service.start(request(benchmark_instance_id=first_h1(), configurations=["A", "B"]))
    wait_finished(service, run_id)
    assert spy_score.calls == [run_id] and spy_score.status_at_call == ["completed"] and spy_score.results_at_call == [{"A", "B"}]

def test_pipelines_receive_no_expected_answer(service, recording_pipelines) -> None:
    instance = bank_instance(first_h5())
    wait_finished(service, service.start(request(benchmark_instance_id=instance.instance_id)))
    assert recording_pipelines.questions == [instance.text] * 3 and instance.expected_answer not in " ".join(recording_pipelines.questions)

def test_cancelled_runs_are_not_scored(service_with_slow_b, spy_score) -> None:
    run_id = service_with_slow_b.start(request(benchmark_instance_id=first_h1()))
    service_with_slow_b.cancel(run_id)
    wait_finished(service_with_slow_b, run_id)
    assert spy_score.calls == []

def test_demo_questions_are_one_bank_instance_per_stratum(client_with_bank) -> None:
    demos = client_with_bank.get("/api/v1/demo/questions").json()
    assert [d["stratum"] for d in demos] == ["H1", "H2", "H3", "H5"] and not any(d["question_id"].startswith("Q") for d in demos)

def test_ad_hoc_questions_state_that_no_answer_key_exists(client) -> None:
    results = run_to_completion(client, question="Which games had incidents?")
    assert results["score"] is None and results["answer_key"] == "none"
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_api_scoring.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement the scoring, the demo questions and the frontend change**

- [ ] **Step 4: Run the backend and frontend tests**

Run: `cd backend && uv run pytest tests/test_api_scoring.py tests/test_api_runs.py tests/test_truth_ledger_isolation.py -q`
Then run the frontend tsc, Vitest, prettier and oxlint with the pnpm.mjs workaround.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(api): bank questions scored against the answer key after the run; demo questions from the bank"
```

---

### Task 14: Live API end to end, documentation and decisions

**Files:**

- Modify: `backend/tests/test_api_live.py` (gated `VECTOR_E2E` and `GRAPH_E2E`).
- Modify: `docs/07-api-event-spec.md` (every route, the envelope, SSE, errors, bounds).
- Modify: `docs/architecture/event-streaming.md`.
- Modify: `DECISIONS.md` (D-033 onward).
- Modify: `HITL_STATUS.md` and `.env.example`.

**Interfaces:**

- Consumes: every route above.
- Decision rows, dated 2026-10-20 and marked "Proposed (controller ruling, for owner review at CP2)" unless the owner already decided:
  - D-033: SQLite schema and retention.
  - D-034: the envelope, run-level event types, and cancellation at event boundaries.
  - D-035: the two `app.api` modules that may import `app.evaluation`.
  - D-036: the demo questions are the first bank instance of H1, H2, H3 and H5.
- The `HITL_STATUS.md` row is "Phase 4 Product API" with status BUILT. There is no checkpoint here; CP2 follows Phases 5 and 6.

- [ ] **Step 1: Write the live test**

```python
@live
def test_live_run_streams_persists_scores_and_survives_a_restart(live_app_factory) -> None:
    client = live_app_factory()
    run_id = start_bank_question(client, first_h1())
    events = stream_all(client, run_id)
    assert events[-1]["event_type"] == "run.completed" and client.get(f"/api/v1/queries/{run_id}").json()["score"]["label"] == "scored against the answer key"
    restarted = live_app_factory()
    assert restarted.get(f"/api/v1/queries/{run_id}/events").json()["events"] == events
    assert restarted.get("/api/v1/health/ready").json()["ready"] is True
```

- [ ] **Step 2: Run the live test against the services** (Neo4j, Qdrant, Ollama up; graph at seed 2026)

Run: `cd backend && VECTOR_E2E=1 GRAPH_E2E=1 uv run pytest tests/test_api_live.py -q -W error`
Expected: PASS.

- [ ] **Step 3: Write the docs and decision rows, as built, and update `.env.example` with every new variable**

The new variables are `APP_DB_PATH`, `RUN_RETENTION`, `SSE_HEARTBEAT_S`, `LOG_LEVEL`, `NEO4J_TIMEOUT_S` and `GENERATION_TIMEOUT_S`, each with a one-line comment.

- [ ] **Step 4: Run the full offline gate and the frontend checks**

Run: `cd backend && uv run ruff format . && uv run ruff check . && uv run mypy && uv run pytest -q -W error`
Then run the frontend tsc, Vitest, prettier and oxlint.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "docs(api): product API reference, event streaming, store decisions; live end-to-end test"
```

---

## Not in this plan

- New screens (Overview, Live Lab, Data Model, Help) and the recorded-run fixture: Phases 5 and 6, then CP2.
- Results screen: Phase 7.
- `compare_runs` settings equality, keeping finished worlds after a later world fails, reasoning-off on OpenRouter, and Live Lab sharing Neo4j while a benchmark run holds another seed: CP3 prerequisites, with Phase 8.
- Ingestion restructuring: already split by node and relationship rows, and no quadratic rebuild exists (Task 8 records this).

## Self-review notes

- Spec 6.1 coverage:
  - recording sink, envelope and SSE with resume and heartbeat: Tasks 5 and 6;
  - per-pipeline status and cancellation: Task 5;
  - SQLite store with retention and history: Tasks 4 and 5;
  - readiness: Task 7.
- Spec 6.2 coverage:
  - datasets, tables and records: Task 9;
  - graph: Task 10;
  - ontology, scenarios and models: Task 11;
  - benchmarks and the question catalogue, and the isolation extension: Tasks 12 and 13.
- Spec 6.3 coverage:
  - logging: Task 2;
  - Neo4j errors, timeouts and retryable flags: Task 3;
  - lock scope and cold start: Task 5;
  - identical vector hits, normalisation and dimension checks: Task 7;
  - empty packages, one settings module, one root, graph defaults, lab and trace CLI: Task 1;
  - typed graph stages and table-driven grounding: Task 8;
  - ingestion split: verified done, no change;
  - ingestion stats on disk: already true, now served by Task 10.
- Spec 10a.1 coverage:
  - post-run deterministic scoring with the label, ad hoc questions without a key, no judge live, the two importing modules, and scoring after the run record is complete: Tasks 12 and 13.
- Type chain:
  - `RunStore` and `RunRow` (Task 4) feed Tasks 5, 6, 13 and 14;
  - `classify` (Task 3) feeds Task 5;
  - `QueryService.wait_for` (Task 5) feeds Task 6;
  - `FrozenBank` (Phase 3) feeds Tasks 12 and 13;
  - `QuestionCard` (Task 12) feeds the Help screen in Phase 6.
