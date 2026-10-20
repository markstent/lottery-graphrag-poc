# ADR-007 — SQLite for Run, Event and Result Persistence

**Decision:** Application persistence (experiments, runs, ordered execution events, evidence records, benchmark results, reproducibility metadata) uses a single SQLite database (`data/app.db`, WAL mode) with JSON payloads where structure is open-ended.

**Reason:** The POC must persist every execution event for replay (`GET /queries/{run_id}/events`) and every result for the dashboards, without adding a database service. SQLite covers this in-process: ordered events by `sequence`, evidence lookups per run, cross-run aggregation for the Results Dashboard, all transactional and file-backed. One storage engine serves both telemetry and metrics, which keeps replay and scoring consistent (same rows the UI streamed).

**Consequences:**
- Replay reads persisted events by sequence; it never re-runs retrieval.
- The SSE stream and the replay endpoint are fed from the same stored events, so what the audience saw live is exactly what replay shows.
- Evidence objects are persisted per run for the Evidence Explorer and for scoring after the run.
- Schema versions recorded via `PRAGMA user_version`; migrations land with the phases that introduce the tables.
- `data/` is gitignored; reproducibility metadata (git SHA, seeds, model identifiers) is stored inside the database and exportable with results.
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
`created_at` and `finished_at` are ISO-8601 UTC strings, and callers must write them in one format (`+00:00` offset) so that text order is time order.
An index on `runs (created_at DESC, run_id DESC)` serves history paging.
`events`, `results` and `scores` reference `runs` with `ON DELETE CASCADE`, so deleting a run removes everything that belongs to it.

### Event sequences

`append_event` reads `MAX(sequence) + 1` for the run and inserts the event inside one `BEGIN IMMEDIATE` transaction.
`BEGIN IMMEDIATE` takes the database write lock before the read, so two writers can never read the same maximum, and sequences start at 1 and have no gaps.
`events(run_id, after)` returns events with a sequence greater than `after`, in order, each with its `sequence` added.

### History paging

`list_runs(limit, before, status)` orders by `created_at DESC, run_id DESC`, so the order is stable when two runs share a timestamp.
`before` is an exclusive `created_at` cursor: pass the last row's `created_at` to get the next page.
Runs that share a `created_at` across a page boundary would be skipped by this cursor; run identifiers and timestamps are generated per run, so this is not expected in practice.

### Retention

`create_run` inserts the run and then, in the same transaction, deletes every `live` run outside the newest `retention` live runs (by `created_at DESC, run_id DESC`).
Recorded runs are never pruned.
Pruning cascades to the pruned runs' events, results and scores.

### Interrupted runs

`mark_interrupted()` is called once at start-up.
It sets every `queued` or `running` run to `failed`, stamps `finished_at`, marks its `pending` or `running` pipelines `failed`, and records the error `{"error_code": "INTERRUPTED", "message": "the server stopped during this run", "retryable": true}`.
It returns how many runs it marked.

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
Every connection sets `PRAGMA foreign_keys = ON` (needed for the cascades), `journal_mode = WAL` (readers do not block the writer) and `busy_timeout = 5000` (a writer waits up to five seconds for the lock rather than failing).
`close()` closes the calling thread's connection; a thread that is about to end should call it.
