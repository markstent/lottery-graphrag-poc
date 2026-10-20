"""SQLite run store: runs, their ordered events, per-pipeline results and
scores (ADR-007).

Each thread gets its own connection. Writes run inside ``BEGIN IMMEDIATE``
so that assigning an event's sequence and inserting it is one write
transaction, which keeps sequences gap-free under concurrent writers.
"""

from __future__ import annotations

import json
import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, fields
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

SCHEMA_VERSION = 1

BUSY_TIMEOUT_MS = 5000

INTERRUPTED_ERROR: dict[str, Any] = {
    "error_code": "INTERRUPTED",
    "message": "the server stopped during this run",
    "retryable": True,
}

# Index ``n`` holds the statements that take the schema from version n to n + 1.
_MIGRATIONS: tuple[tuple[str, ...], ...] = (
    (
        """
        CREATE TABLE runs (
            run_id TEXT PRIMARY KEY,
            kind TEXT NOT NULL CHECK (kind IN ('live', 'recorded')),
            status TEXT NOT NULL
                CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
            question TEXT NOT NULL,
            market_scope_json TEXT NOT NULL,
            configurations_json TEXT NOT NULL,
            benchmark_instance_id TEXT,
            created_at TEXT NOT NULL,
            finished_at TEXT,
            pipeline_status_json TEXT NOT NULL,
            error_json TEXT
        )
        """,
        "CREATE INDEX runs_newest_first ON runs (created_at DESC, run_id DESC)",
        """
        CREATE TABLE events (
            run_id TEXT NOT NULL REFERENCES runs (run_id) ON DELETE CASCADE,
            sequence INTEGER NOT NULL,
            event_json TEXT NOT NULL,
            PRIMARY KEY (run_id, sequence)
        )
        """,
        """
        CREATE TABLE results (
            run_id TEXT NOT NULL REFERENCES runs (run_id) ON DELETE CASCADE,
            pipeline TEXT NOT NULL,
            result_json TEXT NOT NULL,
            PRIMARY KEY (run_id, pipeline)
        )
        """,
        """
        CREATE TABLE scores (
            run_id TEXT PRIMARY KEY REFERENCES runs (run_id) ON DELETE CASCADE,
            score_json TEXT NOT NULL
        )
        """,
    ),
)
assert len(_MIGRATIONS) == SCHEMA_VERSION

_JSON_COLUMNS = {
    "market_scope": "market_scope_json",
    "configurations": "configurations_json",
    "pipeline_status": "pipeline_status_json",
    "error": "error_json",
}


@dataclass(frozen=True)
class RunRow:
    """One run as stored. ``kind`` is ``live`` or ``recorded``; ``status`` is
    ``queued``, ``running``, ``completed``, ``failed`` or ``cancelled``;
    ``pipeline_status`` values are ``pending``, ``running``, ``completed``,
    ``failed``, ``cancelled`` or ``skipped``. Timestamps are ISO-8601 UTC."""

    run_id: str
    kind: str
    status: str
    question: str
    market_scope: tuple[str, ...]
    configurations: tuple[str, ...]
    benchmark_instance_id: str | None
    created_at: str
    finished_at: str | None
    pipeline_status: dict[str, str]
    error: dict[str, Any] | None


_RUN_FIELDS = tuple(f.name for f in fields(RunRow))
_UPDATABLE_FIELDS = frozenset(_RUN_FIELDS) - {"run_id"}
_RUN_COLUMNS = ", ".join(_JSON_COLUMNS.get(name, name) for name in _RUN_FIELDS)


def _dumps(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def _column_value(name: str, value: Any) -> Any:
    if name in _JSON_COLUMNS:
        return None if value is None else _dumps(list(value) if isinstance(value, tuple) else value)
    return value


def _row_from_record(record: sqlite3.Row) -> RunRow:
    error_json = record["error_json"]
    return RunRow(
        run_id=record["run_id"],
        kind=record["kind"],
        status=record["status"],
        question=record["question"],
        market_scope=tuple(json.loads(record["market_scope_json"])),
        configurations=tuple(json.loads(record["configurations_json"])),
        benchmark_instance_id=record["benchmark_instance_id"],
        created_at=record["created_at"],
        finished_at=record["finished_at"],
        pipeline_status=json.loads(record["pipeline_status_json"]),
        error=None if error_json is None else json.loads(error_json),
    )


class RunStore:
    """Run persistence over one SQLite file in WAL mode."""

    def __init__(self, path: Path, retention: int) -> None:
        self._path = path
        self._retention = retention
        self._local = threading.local()
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            self._migrate()
        except BaseException:
            self.close()
            raise

    def close(self) -> None:
        """Close the calling thread's connection, if it has one."""
        connection: sqlite3.Connection | None = getattr(self._local, "connection", None)
        if connection is not None:
            connection.close()
            self._local.connection = None

    def _connection(self) -> sqlite3.Connection:
        connection: sqlite3.Connection | None = getattr(self._local, "connection", None)
        if connection is None:
            connection = sqlite3.connect(self._path, isolation_level=None)
            connection.row_factory = sqlite3.Row
            connection.execute("PRAGMA foreign_keys = ON")
            connection.execute("PRAGMA journal_mode = WAL")
            connection.execute(f"PRAGMA busy_timeout = {BUSY_TIMEOUT_MS}")
            self._local.connection = connection
        return connection

    @contextmanager
    def _write(self) -> Iterator[sqlite3.Connection]:
        connection = self._connection()
        connection.execute("BEGIN IMMEDIATE")
        try:
            yield connection
        except BaseException:
            connection.execute("ROLLBACK")
            raise
        connection.execute("COMMIT")

    def _migrate(self) -> None:
        with self._write() as connection:
            (version,) = connection.execute("PRAGMA user_version").fetchone()
            if version > SCHEMA_VERSION:
                raise RuntimeError(
                    f"database {self._path} has schema version {version}, "
                    f"newer than this code's version {SCHEMA_VERSION}; refusing to downgrade"
                )
            for step in range(version, SCHEMA_VERSION):
                for statement in _MIGRATIONS[step]:
                    connection.execute(statement)
            if version != SCHEMA_VERSION:
                connection.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")

    def create_run(self, row: RunRow) -> None:
        """Insert a run, then prune live runs beyond the newest ``retention``."""
        values = [_column_value(name, getattr(row, name)) for name in _RUN_FIELDS]
        placeholders = ", ".join("?" for _ in _RUN_FIELDS)
        with self._write() as connection:
            connection.execute(f"INSERT INTO runs ({_RUN_COLUMNS}) VALUES ({placeholders})", values)
            connection.execute(
                """
                DELETE FROM runs WHERE kind = 'live' AND run_id NOT IN (
                    SELECT run_id FROM runs WHERE kind = 'live'
                    ORDER BY created_at DESC, run_id DESC LIMIT ?
                )
                """,
                (self._retention,),
            )

    def update_run(self, run_id: str, /, **changes: Any) -> None:
        unknown = sorted(set(changes) - _UPDATABLE_FIELDS)
        if unknown:
            raise ValueError(f"cannot update run fields: {', '.join(unknown)}")
        if not changes:
            return
        assignments = ", ".join(f"{_JSON_COLUMNS.get(name, name)} = ?" for name in changes)
        values = [_column_value(name, value) for name, value in changes.items()]
        with self._write() as connection:
            cursor = connection.execute(
                f"UPDATE runs SET {assignments} WHERE run_id = ?", [*values, run_id]
            )
            if cursor.rowcount == 0:
                raise KeyError(run_id)

    def get_run(self, run_id: str) -> RunRow | None:
        record = (
            self._connection()
            .execute(f"SELECT {_RUN_COLUMNS} FROM runs WHERE run_id = ?", (run_id,))
            .fetchone()
        )
        return None if record is None else _row_from_record(record)

    def list_runs(self, limit: int, before: str | None, status: str | None) -> list[RunRow]:
        """Newest first; ``before`` is an exclusive ``created_at`` cursor."""
        records = (
            self._connection()
            .execute(
                f"""
                SELECT {_RUN_COLUMNS} FROM runs
                WHERE (:before IS NULL OR created_at < :before)
                  AND (:status IS NULL OR status = :status)
                ORDER BY created_at DESC, run_id DESC
                LIMIT :limit
                """,
                {"before": before, "status": status, "limit": limit},
            )
            .fetchall()
        )
        return [_row_from_record(record) for record in records]

    def append_event(self, run_id: str, event: dict[str, Any]) -> int:
        """Store ``event`` as the run's next event and return its sequence."""
        with self._write() as connection:
            (sequence,) = connection.execute(
                "SELECT COALESCE(MAX(sequence), 0) + 1 FROM events WHERE run_id = ?", (run_id,)
            ).fetchone()
            connection.execute(
                "INSERT INTO events (run_id, sequence, event_json) VALUES (?, ?, ?)",
                (run_id, sequence, _dumps(event)),
            )
        return int(sequence)

    def events(self, run_id: str, after: int = 0) -> list[dict[str, Any]]:
        """The run's events with sequence greater than ``after``, in order,
        each with its ``sequence`` added."""
        records = (
            self._connection()
            .execute(
                "SELECT sequence, event_json FROM events WHERE run_id = ? AND sequence > ? "
                "ORDER BY sequence",
                (run_id, after),
            )
            .fetchall()
        )
        return [{**json.loads(r["event_json"]), "sequence": r["sequence"]} for r in records]

    def put_result(self, run_id: str, pipeline: str, result: dict[str, Any]) -> None:
        with self._write() as connection:
            connection.execute(
                "INSERT INTO results (run_id, pipeline, result_json) VALUES (?, ?, ?) "
                "ON CONFLICT (run_id, pipeline) DO UPDATE SET result_json = excluded.result_json",
                (run_id, pipeline, _dumps(result)),
            )

    def results(self, run_id: str) -> dict[str, dict[str, Any]]:
        records = (
            self._connection()
            .execute(
                "SELECT pipeline, result_json FROM results WHERE run_id = ? ORDER BY pipeline",
                (run_id,),
            )
            .fetchall()
        )
        return {r["pipeline"]: json.loads(r["result_json"]) for r in records}

    def put_score(self, run_id: str, score: dict[str, Any]) -> None:
        with self._write() as connection:
            connection.execute(
                "INSERT INTO scores (run_id, score_json) VALUES (?, ?) "
                "ON CONFLICT (run_id) DO UPDATE SET score_json = excluded.score_json",
                (run_id, _dumps(score)),
            )

    def score(self, run_id: str) -> dict[str, Any] | None:
        record = (
            self._connection()
            .execute("SELECT score_json FROM scores WHERE run_id = ?", (run_id,))
            .fetchone()
        )
        return None if record is None else dict(json.loads(record["score_json"]))

    def mark_interrupted(self) -> int:
        """Fail every queued or running run, as left behind by a server that
        stopped mid-run. Their unfinished pipelines are marked failed too.
        Returns how many runs were marked."""
        finished_at = datetime.now(UTC).isoformat()
        with self._write() as connection:
            records = connection.execute(
                "SELECT run_id, pipeline_status_json FROM runs "
                "WHERE status IN ('queued', 'running')"
            ).fetchall()
            for record in records:
                pipelines = {
                    name: "failed" if state in ("pending", "running") else state
                    for name, state in json.loads(record["pipeline_status_json"]).items()
                }
                connection.execute(
                    "UPDATE runs SET status = 'failed', finished_at = ?, "
                    "pipeline_status_json = ?, error_json = ? WHERE run_id = ?",
                    (finished_at, _dumps(pipelines), _dumps(INTERRUPTED_ERROR), record["run_id"]),
                )
        return len(records)
