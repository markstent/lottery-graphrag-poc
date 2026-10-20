"""The SQLite run store: gap-free event sequences, retention, history
paging, interrupted runs and schema versioning."""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from pathlib import Path
from typing import Any

import pytest
from app.persistence.store import SCHEMA_VERSION, RunRow, RunStore


def row(
    run_id: str,
    *,
    kind: str = "live",
    status: str = "queued",
    created_at: str = "2026-10-20T00:00:00+00:00",
) -> RunRow:
    return RunRow(
        run_id=run_id,
        kind=kind,
        status=status,
        question="Which retailers in Greece breached the payout threshold?",
        market_scope=("GR", "UK"),
        configurations=("A", "C"),
        benchmark_instance_id=None,
        created_at=created_at,
        finished_at=None,
        pipeline_status={"A": "pending", "C": "pending"},
        error=None,
    )


@pytest.fixture
def store(tmp_path: Path) -> Iterator[RunStore]:
    opened = RunStore(tmp_path / "app.db", retention=10)
    yield opened
    opened.close()


def test_a_created_run_reads_back_unchanged(store: RunStore) -> None:
    created = row("RUN-1")
    store.create_run(created)
    assert store.get_run("RUN-1") == created
    assert store.get_run("RUN-MISSING") is None


def test_update_run_changes_only_the_named_fields(store: RunStore) -> None:
    store.create_run(row("RUN-1"))
    store.update_run(
        "RUN-1",
        status="completed",
        finished_at="2026-10-20T00:01:00+00:00",
        pipeline_status={"A": "completed", "C": "skipped"},
    )
    updated = store.get_run("RUN-1")
    assert updated is not None
    assert updated.status == "completed"
    assert updated.finished_at == "2026-10-20T00:01:00+00:00"
    assert updated.pipeline_status == {"A": "completed", "C": "skipped"}
    assert updated.market_scope == ("GR", "UK")


def test_update_run_refuses_unknown_fields_and_runs(store: RunStore) -> None:
    store.create_run(row("RUN-1"))
    with pytest.raises(ValueError, match="nonsense"):
        store.update_run("RUN-1", nonsense=1)
    with pytest.raises(ValueError, match="run_id"):
        store.update_run("RUN-1", run_id="RUN-2")
    with pytest.raises(KeyError, match="RUN-MISSING"):
        store.update_run("RUN-MISSING", status="running")


def test_invalid_kind_or_status_is_refused(store: RunStore) -> None:
    with pytest.raises(sqlite3.IntegrityError):
        store.create_run(row("RUN-1", kind="imaginary"))
    store.create_run(row("RUN-2"))
    with pytest.raises(sqlite3.IntegrityError):
        store.update_run("RUN-2", status="paused")


def test_sequences_are_gap_free_across_threads(store: RunStore) -> None:
    store.create_run(row("RUN-1"))

    def append(i: int) -> int:
        try:
            return store.append_event("RUN-1", {"i": i})
        finally:
            store.close()

    with ThreadPoolExecutor(8) as pool:
        returned = list(pool.map(append, range(200)))
    assert sorted(returned) == list(range(1, 201))
    assert [e["sequence"] for e in store.events("RUN-1")] == list(range(1, 201))
    assert sorted(e["i"] for e in store.events("RUN-1")) == list(range(200))


def test_events_after_a_sequence(store: RunStore) -> None:
    store.create_run(row("RUN-1"))
    store.create_run(row("RUN-2"))
    for n in range(5):
        store.append_event("RUN-1", {"type": "stage", "n": n})
    store.append_event("RUN-2", {"type": "other"})
    assert store.events("RUN-1", after=3) == [
        {"type": "stage", "n": 3, "sequence": 4},
        {"type": "stage", "n": 4, "sequence": 5},
    ]
    assert store.events("RUN-1", after=5) == []
    assert store.events("RUN-2") == [{"type": "other", "sequence": 1}]


def test_events_for_an_unknown_run_are_refused(store: RunStore) -> None:
    with pytest.raises(sqlite3.IntegrityError):
        store.append_event("RUN-MISSING", {"type": "stage"})


def test_retention_prunes_old_live_runs_and_keeps_recorded(tmp_path: Path) -> None:
    store = RunStore(tmp_path / "app.db", retention=2)
    try:
        for n, kind in enumerate(["recorded", "live", "live", "live"]):
            store.create_run(row(f"RUN-{n}", kind=kind, created_at=f"2026-10-20T00:00:0{n}+00:00"))
        assert {r.run_id for r in store.list_runs(100, None, None)} == {"RUN-0", "RUN-2", "RUN-3"}
    finally:
        store.close()


def test_pruning_a_run_cascades_to_its_events_results_and_score(tmp_path: Path) -> None:
    store = RunStore(tmp_path / "app.db", retention=1)
    try:
        store.create_run(row("RUN-OLD", created_at="2026-10-20T00:00:00+00:00"))
        store.append_event("RUN-OLD", {"type": "stage"})
        store.put_result("RUN-OLD", "A", {"answer": "x"})
        store.put_score("RUN-OLD", {"total": 1})
        store.create_run(row("RUN-NEW", created_at="2026-10-20T00:00:01+00:00"))
        assert store.get_run("RUN-OLD") is None
        with closing(sqlite3.connect(tmp_path / "app.db")) as raw:
            for table in ("events", "results", "scores"):
                count = raw.execute(
                    f"SELECT COUNT(*) FROM {table} WHERE run_id = 'RUN-OLD'"
                ).fetchone()
                assert count == (0,), table
    finally:
        store.close()


def test_history_pages_with_before_and_status(store: RunStore) -> None:
    for n in range(5):
        status = "completed" if n % 2 == 0 else "failed"
        store.create_run(row(f"RUN-{n}", status=status, created_at=f"2026-10-20T00:00:0{n}+00:00"))
    first = store.list_runs(2, None, None)
    assert [r.run_id for r in first] == ["RUN-4", "RUN-3"]
    second = store.list_runs(2, first[-1].created_at, None)
    assert [r.run_id for r in second] == ["RUN-2", "RUN-1"]
    third = store.list_runs(2, second[-1].created_at, None)
    assert [r.run_id for r in third] == ["RUN-0"]
    assert [r.run_id for r in store.list_runs(10, None, "completed")] == ["RUN-4", "RUN-2", "RUN-0"]
    assert [r.run_id for r in store.list_runs(10, "2026-10-20T00:00:04+00:00", "failed")] == [
        "RUN-3",
        "RUN-1",
    ]


def test_equal_created_at_orders_by_run_id_descending(store: RunStore) -> None:
    for run_id in ("RUN-A", "RUN-C", "RUN-B"):
        store.create_run(row(run_id))
    assert [r.run_id for r in store.list_runs(10, None, None)] == ["RUN-C", "RUN-B", "RUN-A"]


def test_results_and_score_round_trip(store: RunStore) -> None:
    store.create_run(row("RUN-1"))
    assert store.results("RUN-1") == {}
    assert store.score("RUN-1") is None
    result_a: dict[str, Any] = {"answer": "Two retailers", "evidence": [{"id": "E-1", "rank": 1}]}
    store.put_result("RUN-1", "A", result_a)
    store.put_result("RUN-1", "C", {"answer": "first"})
    store.put_result("RUN-1", "C", {"answer": "replaced"})
    assert store.results("RUN-1") == {"A": result_a, "C": {"answer": "replaced"}}
    store.put_score("RUN-1", {"total": 0.5})
    store.put_score("RUN-1", {"total": 0.75, "per_pipeline": {"A": 0.5, "C": 1.0}})
    assert store.score("RUN-1") == {"total": 0.75, "per_pipeline": {"A": 0.5, "C": 1.0}}


def test_runs_left_running_at_start_are_marked_interrupted(tmp_path: Path) -> None:
    first = RunStore(tmp_path / "app.db", 10)
    first.create_run(row("RUN-1", status="running"))
    first.create_run(row("RUN-2", status="queued"))
    first.create_run(row("RUN-3", status="completed"))
    first.close()
    reopened = RunStore(tmp_path / "app.db", 10)
    try:
        assert reopened.mark_interrupted() == 2
        interrupted = reopened.get_run("RUN-1")
        assert interrupted is not None and interrupted.error is not None
        assert interrupted.status == "failed"
        assert interrupted.error == {
            "error_code": "INTERRUPTED",
            "message": "the server stopped during this run",
            "retryable": True,
        }
        assert interrupted.finished_at is not None
        assert interrupted.pipeline_status == {"A": "failed", "C": "failed"}
        untouched = reopened.get_run("RUN-3")
        assert untouched is not None and untouched.status == "completed" and untouched.error is None
        assert reopened.mark_interrupted() == 0
    finally:
        reopened.close()


def test_a_fresh_database_is_stamped_with_the_schema_version(tmp_path: Path) -> None:
    RunStore(tmp_path / "app.db", 10).close()
    with closing(sqlite3.connect(tmp_path / "app.db")) as raw:
        assert raw.execute("PRAGMA user_version").fetchone() == (SCHEMA_VERSION,)
        assert raw.execute("PRAGMA journal_mode").fetchone() == ("wal",)


def test_reopening_keeps_existing_runs(tmp_path: Path) -> None:
    first = RunStore(tmp_path / "app.db", 10)
    first.create_run(row("RUN-1"))
    first.close()
    reopened = RunStore(tmp_path / "app.db", 10)
    try:
        assert reopened.get_run("RUN-1") == row("RUN-1")
    finally:
        reopened.close()


def test_a_newer_schema_is_refused(tmp_path: Path) -> None:
    with closing(sqlite3.connect(tmp_path / "app.db")) as raw:
        raw.execute("PRAGMA user_version = 99")
    with pytest.raises(RuntimeError, match=rf"99.*{SCHEMA_VERSION}"):
        RunStore(tmp_path / "app.db", 10)
