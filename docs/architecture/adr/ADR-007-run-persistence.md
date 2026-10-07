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
