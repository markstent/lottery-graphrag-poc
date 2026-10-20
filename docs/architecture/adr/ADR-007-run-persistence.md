# ADR-007 — SQLite for Run, Event and Result Persistence

**Decision:** Application persistence stores four things: runs, their ordered execution events, their per-pipeline results and their live scores. It uses a single SQLite database (`data/app.db`, WAL mode) with JSON payloads where structure is open-ended.

**Reason:** The POC must persist every execution event for replay (`GET /queries/{run_id}/events`) and every pipeline result and live score of a run, without adding a database service. SQLite covers this in-process: ordered events by `sequence`, results and scores per run, run history, all transactional and file-backed. One storage engine serves both the event stream and the results, which keeps replay and scoring consistent (same rows the UI streamed). Benchmark results are not stored here: they are the run directories the harness writes.

**Consequences:**
- Replay reads persisted events by sequence; it never re-runs retrieval.
- The SSE stream and the replay endpoint are fed from the same stored events, so what the audience saw live is exactly what replay shows.
- Evidence objects are stored inside each pipeline's result, for the Evidence Explorer and for scoring after the run.
- Schema versions recorded via `PRAGMA user_version`; migrations land with the phases that introduce the tables.
- `data/` is gitignored; the reproducibility metadata of a benchmark (git SHA, seeds, model identifiers) is in the run directory's `summary.json`, not in the database.
- Rejected alternatives: JSONL files per run (no cross-run queries for dashboards), PostgreSQL/Redis (extra service for no POC-scale benefit).

## As built (Phase 4, Task 4)

The store lives in `backend/app/persistence/store.py` as `RunStore`.
It takes the database path and the retention count as constructor arguments; the API passes `ApiSettings.db_path` (`APP_DB_PATH`) and `ApiSettings.run_retention` (`RUN_RETENTION`, default 500).
The store never reads the environment and never references the truth ledger.

### Schema (version 1)

| Table | Columns | Key |
|---|---|---|
| `runs` | `run_id`, `kind`, `status`, `question`, `market_scope_json`, `configurations_json`, `benchmark_instance_id`, `created_at`, `finished_at`, `pipeline_status_json`, `error_json` | `run_id` |
| `events` | `run_id`, `sequence`, `event_json` | `(run_id, sequence)` |
| `results` | `run_id`, `pipeline`, `result_json` | `(run_id, pipeline)` |
| `scores` | `run_id`, `score_json` | `run_id` |

`kind` is checked to be `live` or `recorded`.
`status` is checked to be `queued`, `running`, `completed`, `failed` or `cancelled`.
`pipeline_status` maps each configuration to `pending`, `running`, `completed`, `failed`, `cancelled` or `skipped`.
Tuples and dicts are stored as JSON written with sorted keys and compact separators, so equal values give identical text.
`created_at` and `finished_at` are ISO-8601 UTC strings.
`create_run` refuses a `created_at` that is not the canonical `datetime.isoformat()` text of a UTC instant with a `+00:00` offset (for example `2026-10-20T00:00:00+00:00` or `2026-10-20T00:00:00.123456+00:00`), raising `ValueError`.
One canonical form is what makes text order equal time order; `Z`, other offsets, naive times and truncated fractions are all refused.
An index on `runs (created_at DESC, run_id DESC)` serves history paging.
`events`, `results` and `scores` reference `runs` with `ON DELETE CASCADE`, so deleting a run removes everything that belongs to it.

### Event sequences

`append_event` reads `MAX(sequence) + 1` for the run and inserts the event inside one `BEGIN IMMEDIATE` transaction.
`BEGIN IMMEDIATE` takes the database write lock before the read, so two writers can never read the same maximum, and sequences start at 1 and have no gaps.
`events(run_id, after)` returns events with a sequence greater than `after`, in order, each with its `sequence` added.

### History paging

`list_runs(limit, before, status)` raises `ValueError` when `limit < 1`, and orders by `created_at DESC, run_id DESC`, so the order is stable when two runs share a timestamp.
`before` is an opaque cursor `"<created_at>|<run_id>"`, built from the last row of a page with `cursor(row)`.
The query returns only rows where `(created_at, run_id) < (cursor created_at, cursor run_id)`, so runs that share a `created_at` are each returned exactly once across pages.
A malformed cursor (no separator, an empty run id, or a `created_at` that is not canonical UTC) raises `ValueError`.

### Retention

`create_run` inserts the run and then, in the same transaction, deletes every finished `live` run outside the newest `retention` finished live runs (by `created_at DESC, run_id DESC`).
A run is finished when its status is `completed`, `failed` or `cancelled`.
Queued and running runs are excluded from both the delete and the window, so an active run is never deleted under its writer; the number of stored live runs may briefly exceed `retention` while runs are active, which is intended.
Recorded runs are never pruned.
A live run inserted already finished with a `created_at` older than the window is pruned by its own insert; callers stamp `created_at` with the current time, so this only affects backdated rows.
Pruning cascades to the pruned runs' events, results and scores.

### Updates

`update_run` changes only a run's progress: `status`, `finished_at`, `pipeline_status` and `error`.
Any other field, including `run_id`, `kind`, `created_at` and the request fields, raises `ValueError`, because a run's identity and request are fixed at creation.

### Interrupted runs

`mark_interrupted()` is called once at start-up.
It sets every `queued` or `running` run to `failed`, stamps `finished_at`, marks its `pending` or `running` pipelines `failed`, and records the INTERRUPTED error envelope (`{"error_code": "INTERRUPTED", "message": "The server stopped during this run.", "retryable": true}`, from `RUN_ERROR_MESSAGES`).
In the same transaction it appends, with the next sequences, a `pipeline.failed` event for each pipeline that was `running` and then a `run.failed` event, each carrying that envelope, so a stream of the run reaches a terminal event.
The caller builds those events (the store does not know the event types); a run whose terminal event is already stored, because the write of its final row failed, is marked the same way and gets no second terminal event.
It returns how many runs it marked.
This assumes a single API process owns the database: any queued or running run found at start-up must have belonged to a process that has stopped.
Running two API processes against one database would let one process fail the other's live runs, so that deployment is not supported.

### Migrations by `user_version`

`SCHEMA_VERSION` is 1.
On open, inside one write transaction, the store reads `PRAGMA user_version`.
At 0 it creates the schema and sets the version to 1.
Between 0 and `SCHEMA_VERSION` it runs the stepwise migrations in order; only the step to version 1 exists today.
At `SCHEMA_VERSION` it leaves the database alone.
Above `SCHEMA_VERSION` it raises `RuntimeError` naming both versions; the store never downgrades.
A later schema change adds one step to `_MIGRATIONS` and bumps `SCHEMA_VERSION`.

### Threading model

Each thread gets its own connection through `threading.local`, so no connection is ever shared across threads.
Connections open with `isolation_level=None`, so transactions are explicit: every write uses `BEGIN IMMEDIATE` and commits or rolls back as a whole, while reads run in autocommit.
`COMMIT` runs inside the guarded block, and on any error the store issues `ROLLBACK` only if the connection is still in a transaction, so a failed commit never masks the original error.
Every connection sets, in this order, `PRAGMA foreign_keys = ON` (needed for the cascades), `busy_timeout = 5000` (a writer waits up to five seconds for a lock rather than failing) and `journal_mode = WAL` (readers do not block the writer).
`busy_timeout` comes first so that switching to WAL also waits for locks rather than failing.
`close()` closes the calling thread's connection.
Every thread that uses the store must call `close()` before it ends; otherwise its connection is left to garbage collection, which emits a `ResourceWarning`.
The API follows this rule for every thread it runs store calls on.
Each run's worker thread closes its connection in a `finally` when the run ends.
The synchronous routes run on the server's thread pool, so each route closes its thread's connection before it returns.
The start-up lifespan opens the store, calls `mark_interrupted()` and closes its own connection before the server accepts requests.
