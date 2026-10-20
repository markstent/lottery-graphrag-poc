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
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, fields
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

SCHEMA_VERSION = 1

BUSY_TIMEOUT_MS = 5000

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


@dataclass(frozen=True)
class RunEnd:
    """How start-up ends a run it found unfinished: the events to append
    (full envelope, the store assigns their sequences) and the run's new
    state. The store knows no event types; the caller decides all of it."""

    events: list[dict[str, Any]]
    status: str
    finished_at: str
    pipeline_status: dict[str, str]
    error: dict[str, Any] | None


# What ends an unfinished run: the run as stored and its stored events to its end.
EndRun = Callable[["RunRow", list[dict[str, Any]]], RunEnd]

_RUN_FIELDS = tuple(f.name for f in fields(RunRow))
# A run's identity and request are fixed at creation; only its progress changes.
_UPDATABLE_FIELDS = frozenset({"status", "finished_at", "pipeline_status", "error"})
_RUN_COLUMNS = ", ".join(_JSON_COLUMNS.get(name, name) for name in _RUN_FIELDS)


def _dumps(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def _column_value(name: str, value: Any) -> Any:
    if name in _JSON_COLUMNS:
        return None if value is None else _dumps(list(value) if isinstance(value, tuple) else value)
    return value


_CURSOR_SEPARATOR = "|"


def _require_utc_timestamp(value: str, what: str) -> None:
    """Refuse anything but the canonical ``datetime.isoformat()`` text of a
    UTC instant (``+00:00`` offset), so that text order is time order."""
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        parsed = None
    if parsed is None or parsed.utcoffset() != timedelta(0) or parsed.isoformat() != value:
        raise ValueError(
            f"{what} must be an ISO-8601 UTC timestamp with a +00:00 offset, got {value!r}"
        )


def cursor(row: RunRow) -> str:
    """The ``before`` value that continues history paging after ``row``."""
    return f"{row.created_at}{_CURSOR_SEPARATOR}{row.run_id}"


def _parse_cursor(before: str) -> tuple[str, str]:
    created_at, separator, run_id = before.partition(_CURSOR_SEPARATOR)
    if not separator or not run_id:
        raise ValueError(f"malformed history cursor {before!r}")
    _require_utc_timestamp(created_at, "the history cursor's created_at")
    return created_at, run_id


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
    """Run persistence over one SQLite file in WAL mode.

    Each thread gets its own connection on first use. Every thread that uses
    the store must call ``close()`` before it ends, or its connection is left
    to garbage collection, which emits a ``ResourceWarning``."""

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
            connection.execute(f"PRAGMA busy_timeout = {BUSY_TIMEOUT_MS}")
            connection.execute("PRAGMA journal_mode = WAL")
            self._local.connection = connection
        return connection

    @contextmanager
    def _write(self) -> Iterator[sqlite3.Connection]:
        connection = self._connection()
        connection.execute("BEGIN IMMEDIATE")
        try:
            yield connection
            connection.execute("COMMIT")
        except BaseException:
            if connection.in_transaction:
                connection.execute("ROLLBACK")
            raise

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
        """Insert a run, then prune finished live runs beyond the newest
        ``retention``. Queued and running runs are never pruned, so the count
        may briefly exceed ``retention`` while runs are active.
        ``created_at`` must be ISO-8601 UTC with a ``+00:00`` offset."""
        _require_utc_timestamp(row.created_at, "created_at")
        values = [_column_value(name, getattr(row, name)) for name in _RUN_FIELDS]
        placeholders = ", ".join("?" for _ in _RUN_FIELDS)
        with self._write() as connection:
            connection.execute(f"INSERT INTO runs ({_RUN_COLUMNS}) VALUES ({placeholders})", values)
            connection.execute(
                """
                DELETE FROM runs
                WHERE kind = 'live' AND status NOT IN ('queued', 'running')
                  AND run_id NOT IN (
                    SELECT run_id FROM runs
                    WHERE kind = 'live' AND status NOT IN ('queued', 'running')
                    ORDER BY created_at DESC, run_id DESC LIMIT ?
                  )
                """,
                (self._retention,),
            )

    def update_run(self, run_id: str, /, **changes: Any) -> None:
        """Change a run's progress: ``status``, ``finished_at``,
        ``pipeline_status`` or ``error``. Anything else raises ValueError."""
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
        """Newest first by ``(created_at, run_id)``. ``before`` is an opaque
        cursor from ``cursor(row)``; only rows strictly after it are returned."""
        if limit < 1:
            raise ValueError(f"limit must be at least 1, got {limit}")
        created_at, run_id = (None, None) if before is None else _parse_cursor(before)
        records = (
            self._connection()
            .execute(
                f"""
                SELECT {_RUN_COLUMNS} FROM runs
                WHERE (:created_at IS NULL OR (created_at, run_id) < (:created_at, :run_id))
                  AND (:status IS NULL OR status = :status)
                ORDER BY created_at DESC, run_id DESC
                LIMIT :limit
                """,
                {"created_at": created_at, "run_id": run_id, "status": status, "limit": limit},
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

    def mark_interrupted(self, end_run: EndRun) -> int:
        """End every queued or running run, as left behind by a server that
        stopped mid-run (or whose final write failed).

        ``end_run(run, stored_events)`` returns a ``RunEnd``: the events that
        end the run, stored after its own with the next sequences, and the
        run's new state, written in the same transaction, so a client
        streaming the run reaches a terminal event. A run whose terminal
        event is already stored has none to append. Returns how many runs
        were ended."""
        with self._write() as connection:
            records = connection.execute(
                f"SELECT {_RUN_COLUMNS} FROM runs WHERE status IN ('queued', 'running')"
            ).fetchall()
            for record in records:
                run_id = record["run_id"]
                stored = connection.execute(
                    "SELECT sequence, event_json FROM events WHERE run_id = ? ORDER BY sequence",
                    (run_id,),
                ).fetchall()
                end = end_run(
                    _row_from_record(record),
                    [{**json.loads(r["event_json"]), "sequence": r["sequence"]} for r in stored],
                )
                next_sequence = stored[-1]["sequence"] + 1 if stored else 1
                for offset, event in enumerate(end.events):
                    connection.execute(
                        "INSERT INTO events (run_id, sequence, event_json) VALUES (?, ?, ?)",
                        (run_id, next_sequence + offset, _dumps(event)),
                    )
                connection.execute(
                    "UPDATE runs SET status = ?, finished_at = ?, "
                    "pipeline_status_json = ?, error_json = ? WHERE run_id = ?",
                    (
                        end.status,
                        end.finished_at,
                        _dumps(end.pipeline_status),
                        None if end.error is None else _dumps(end.error),
                        run_id,
                    ),
                )
        return len(records)

    def mark_unscored(self, record: dict[str, Any]) -> int:
        """Give ``record`` as the score of every completed bank-question run
        that has none, as left behind by a server that stopped between a
        run's final row and its score. Call it at start-up, before any
        worker runs. Returns how many runs were marked."""
        with self._write() as connection:
            cursor = connection.execute(
                "INSERT INTO scores (run_id, score_json) "
                "SELECT run_id, ? FROM runs WHERE status = 'completed' "
                "AND benchmark_instance_id IS NOT NULL "
                "AND run_id NOT IN (SELECT run_id FROM scores)",
                (_dumps(record),),
            )
            return cursor.rowcount
