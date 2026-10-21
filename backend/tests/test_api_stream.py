"""The server-sent event stream of a run (docs/07 section 6, ADR-004).

``sse_frames`` is driven directly over a real run store with injected waits,
so no test depends on wall-clock pacing: a wait either returns at once or is
released by an explicit handshake. The route is tested through
``TestClient.stream`` over runs written straight into the store.
"""

from __future__ import annotations

import json
import logging
import queue
import threading
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from app.api.runs import RecordingSink
from app.api.stream import HEARTBEAT, sse_frames
from app.events import RUN_COMPLETED, RUN_PIPELINE, RUN_STARTED, RetrievalEvent
from app.main import create_app
from app.persistence.store import RunRow, RunStore
from fastapi.testclient import TestClient

RETENTION = 50
EVENT_COUNT = 12
# The only timeout of a blocked handshake: a deadline, never a pacing delay.
DEADLINE_S = 15.0
WaitFor = Callable[[str, int, float], bool]


# -- helpers ------------------------------------------------------------------


def envelope(
    run_id: str,
    index: int,
    event_type: str,
    pipeline: str = "A",
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "event_id": f"{index:032x}",
        "timestamp": "2026-01-01T10:00:00.000000+00:00",
        "run_id": run_id,
        "pipeline": pipeline,
        "event_type": event_type,
        "t_ms": float(index),
        "payload": payload or {},
    }


def add_run(store: RunStore, run_id: str, status: str) -> None:
    store.create_run(
        RunRow(
            run_id=run_id,
            kind="live",
            status=status,
            question="Which incidents affected the Greek digital checkout?",
            market_scope=(),
            configurations=("A",),
            benchmark_instance_id=None,
            created_at="2026-01-01T10:00:00+00:00",
            finished_at=None,
            pipeline_status={"A": "completed"},
            error=None,
        )
    )


def add_events(store: RunStore, run_id: str, count: int, *, terminal: bool) -> None:
    """``count`` events: run.started, pipeline events, then run.completed when ``terminal``."""
    for index in range(1, count + 1):
        if index == 1:
            event = envelope(run_id, index, RUN_STARTED, RUN_PIPELINE)
        elif index == count and terminal:
            event = envelope(run_id, index, RUN_COMPLETED, RUN_PIPELINE)
        else:
            event = envelope(run_id, index, "rag.vector_search.started", payload={"top_k": index})
        store.append_event(run_id, event)


def ids(frames: list[str]) -> list[int]:
    return [int(frame.split("\n", 1)[0].removeprefix("id: ")) for frame in frames]


def parse(text: str) -> list[dict[str, Any]]:
    """The data of every event frame in a stream body (heartbeats skipped)."""
    events = []
    for block in text.split("\n\n"):
        data = [
            line.removeprefix("data: ") for line in block.split("\n") if line.startswith("data: ")
        ]
        if data:
            events.append(json.loads(data[0]))
    return events


def returns(value: bool) -> WaitFor:
    def wait_for(run_id: str, after: int, timeout: float) -> bool:
        del run_id, after, timeout
        return value

    return wait_for


@dataclass
class Run:
    run_id: str
    store: RunStore
    count: int
    wait_for: WaitFor
    never_wakes: WaitFor


@pytest.fixture
def run_store(tmp_path: Path) -> Iterator[RunStore]:
    store = RunStore(tmp_path / "stream.db", RETENTION)
    yield store
    store.close()


@pytest.fixture
def finished_run(run_store: RunStore) -> Run:
    add_run(run_store, "RUN-FINISHED0001", "completed")
    add_events(run_store, "RUN-FINISHED0001", EVENT_COUNT, terminal=True)
    # A finished run is no longer active: the service's wait returns at once.
    return Run("RUN-FINISHED0001", run_store, EVENT_COUNT, returns(True), returns(False))


@pytest.fixture
def slow_run(run_store: RunStore) -> Run:
    add_run(run_store, "RUN-SLOW00000001", "running")
    add_events(run_store, "RUN-SLOW00000001", 3, terminal=False)
    return Run("RUN-SLOW00000001", run_store, 3, returns(True), returns(False))


@pytest.fixture
def finished_run_id(run_database: Path) -> str:
    store = RunStore(run_database, RETENTION)
    try:
        add_run(store, "RUN-HTTPFINISHED", "completed")
        add_events(store, "RUN-HTTPFINISHED", EVENT_COUNT, terminal=True)
    finally:
        store.close()
    return "RUN-HTTPFINISHED"


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(create_app()) as test_client:
        yield test_client


def stream_url(run_id: str) -> str:
    return f"/api/v1/queries/{run_id}/events/stream"


def parsed_stream(client: TestClient, run_id: str) -> list[dict[str, Any]]:
    with client.stream("GET", stream_url(run_id)) as response:
        return parse("".join(response.iter_text()))


# -- the frame generator -------------------------------------------------------


def test_stream_resumes_after_last_event_id(finished_run: Run) -> None:
    frames = list(sse_frames(finished_run.run_id, 7, finished_run.store, finished_run.wait_for, 15))
    assert ids(frames) == list(range(8, finished_run.count + 1))


def test_a_frame_is_id_event_and_the_envelope_as_data(finished_run: Run) -> None:
    first = next(sse_frames(finished_run.run_id, 0, finished_run.store, finished_run.wait_for, 15))
    expected = {**envelope(finished_run.run_id, 1, RUN_STARTED, RUN_PIPELINE), "sequence": 1}
    head, data = first.removesuffix("\n\n").split("\ndata: ")
    assert head == "id: 1\nevent: run.started"
    assert json.loads(data) == expected
    assert first.endswith("\n\n") and first.count("\n") == 4


def test_the_generator_returns_after_the_terminal_event(finished_run: Run) -> None:
    calls: list[int] = []

    def wait_for(run_id: str, after: int, timeout: float) -> bool:
        calls.append(after)
        return True

    frames = list(sse_frames(finished_run.run_id, 0, finished_run.store, wait_for, 15))
    assert ids(frames) == list(range(1, finished_run.count + 1))
    assert "event: run.completed" in frames[-1]
    assert calls == []  # every event was already stored: no wait was needed


def test_resuming_after_the_terminal_event_closes_at_once(finished_run: Run) -> None:
    frames = list(
        sse_frames(finished_run.run_id, finished_run.count, finished_run.store, returns(True), 15)
    )
    assert frames == []


def test_heartbeat_while_waiting(slow_run: Run) -> None:
    first = next(
        sse_frames(slow_run.run_id, slow_run.count, slow_run.store, slow_run.never_wakes, 0.01)
    )
    assert first == ": keep-alive\n\n"


def test_heartbeats_repeat_until_an_event_arrives(slow_run: Run) -> None:
    replies = iter([False, False])
    waited: list[tuple[int, float]] = []

    def wait_for(run_id: str, after: int, timeout: float) -> bool:
        waited.append((after, timeout))
        reply = next(replies, None)
        if reply is None:  # the third wait: the worker stores the terminal event
            slow_run.store.append_event(
                run_id, envelope(run_id, slow_run.count + 1, RUN_COMPLETED, RUN_PIPELINE)
            )
            return True
        return reply

    frames = list(sse_frames(slow_run.run_id, slow_run.count, slow_run.store, wait_for, 4.0))
    assert frames[:2] == [HEARTBEAT, HEARTBEAT]
    assert ids(frames[2:]) == [slow_run.count + 1]
    assert waited == [(slow_run.count, 4.0)] * 3


def test_a_retired_run_without_a_terminal_event_closes_rather_than_spinning(
    slow_run: Run,
) -> None:
    """The final write failed: no terminal event, the row still reads running,
    and the run is no longer active, so every wait returns True at once."""
    waits: list[int] = []

    def retired(run_id: str, after: int, timeout: float) -> bool:
        waits.append(after)
        assert len(waits) <= 1, "the stream kept waiting on a run that will store nothing more"
        return True

    frames = list(sse_frames(slow_run.run_id, 0, slow_run.store, retired, 15))
    assert ids(frames) == [1, 2, 3]
    assert waits == [3]


def test_live_events_stream_as_the_worker_records_them(run_store: RunStore) -> None:
    """The real sink's wait: each event recorded on this thread reaches the
    stream thread through the handshake, then the terminal event closes it."""
    run_id = "RUN-LIVE00000001"
    add_run(run_store, run_id, "running")
    sink = RecordingSink(run_store, run_id, threading.Event())
    received: queue.Queue[str | None] = queue.Queue()

    def wait_for(_run_id: str, after: int, _timeout: float) -> bool:
        return sink.wait(after, DEADLINE_S)

    def consume() -> None:
        try:
            for frame in sse_frames(run_id, 0, run_store, wait_for, DEADLINE_S):
                received.put(frame)
        finally:
            run_store.close()
            received.put(None)

    consumer = threading.Thread(target=consume, name="stream-consumer")
    consumer.start()
    types = [RUN_STARTED, "pipeline.started", RUN_COMPLETED]
    frames = []
    for index, event_type in enumerate(types, start=1):
        pipeline = RUN_PIPELINE if event_type.startswith("run.") else "A"
        sink.record(
            RetrievalEvent(
                event_type=event_type,
                pipeline=pipeline,
                t_ms=float(index),
                event_id=f"{index:032x}",
                timestamp="2026-01-01T10:00:00.000000+00:00",
            )
        )
        frame = received.get(timeout=DEADLINE_S)
        assert frame is not None
        frames.append(frame)
    assert received.get(timeout=DEADLINE_S) is None  # the stream closed itself
    consumer.join(DEADLINE_S)
    assert not consumer.is_alive(), "the stream consumer did not end"
    assert ids(frames) == [1, 2, 3]
    assert [frame.split("\n")[1] for frame in frames] == [f"event: {t}" for t in types]


class FailingStore:
    """A run store whose event read fails after the first call."""

    def __init__(self, inner: RunStore) -> None:
        self._inner = inner
        self.reads = 0
        self.closes = 0

    def events(self, run_id: str, after: int = 0) -> list[dict[str, Any]]:
        self.reads += 1
        if self.reads > 1:
            raise OSError("disk I/O error on /var/lib/app.db")
        return self._inner.events(run_id, after)

    def close(self) -> None:
        self.closes += 1
        self._inner.close()


def test_a_store_failure_mid_stream_closes_cleanly_and_is_logged(
    slow_run: Run, caplog: pytest.LogCaptureFixture
) -> None:
    failing = FailingStore(slow_run.store)
    with caplog.at_level(logging.ERROR):
        frames = list(sse_frames(slow_run.run_id, 0, failing, slow_run.wait_for, 15))  # type: ignore[arg-type]
    assert ids(frames) == [1, 2, 3]
    assert all(frame.endswith("\n\n") for frame in frames)
    (logged,) = [r for r in caplog.records if r.name == "app.api.stream"]
    assert logged.levelname == "ERROR"
    assert getattr(logged, "run_id", None) == slow_run.run_id
    assert logged.exc_info is not None


def test_every_read_closes_its_thread_connection(slow_run: Run) -> None:
    """Starlette may resume the generator on any pool thread, so no read may
    leave a connection open on the thread it ran on (ADR-007)."""
    counting = FailingStore(slow_run.store)
    list(sse_frames(slow_run.run_id, 0, counting, returns(False), 15))  # type: ignore[arg-type]
    assert counting.closes == counting.reads == 2


# -- the route -----------------------------------------------------------------


def test_stream_of_a_finished_run_replays_and_closes(
    client: TestClient, finished_run_id: str
) -> None:
    with client.stream("GET", f"/api/v1/queries/{finished_run_id}/events/stream") as response:
        text = "".join(response.iter_text())
    assert text.rstrip().endswith("}") and "event: run.completed" in text


def test_stream_headers(client: TestClient, finished_run_id: str) -> None:
    with client.stream("GET", stream_url(finished_run_id)) as response:
        response.read()
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert response.headers["cache-control"] == "no-cache"
    assert response.headers["x-accel-buffering"] == "no"


def test_stream_and_replay_share_one_envelope(client: TestClient, finished_run_id: str) -> None:
    replay = client.get(f"/api/v1/queries/{finished_run_id}/events").json()["events"]
    assert parsed_stream(client, finished_run_id) == replay


def test_resume_by_query_parameter(client: TestClient, finished_run_id: str) -> None:
    with client.stream("GET", stream_url(finished_run_id), params={"after": 9}) as response:
        events = parse("".join(response.iter_text()))
    assert [event["sequence"] for event in events] == [10, 11, 12]


def test_the_last_event_id_header_wins_over_the_query_parameter(
    client: TestClient, finished_run_id: str
) -> None:
    with client.stream(
        "GET", stream_url(finished_run_id), params={"after": 2}, headers={"Last-Event-ID": "10"}
    ) as response:
        events = parse("".join(response.iter_text()))
    assert [event["sequence"] for event in events] == [11, 12]


@pytest.mark.parametrize(
    ("params", "headers"),
    [
        ({"after": "-1"}, {}),
        ({"after": "abc"}, {}),
        ({"after": "1.5"}, {}),
        ({"after": "+3"}, {}),
        ({"after": ""}, {}),
        ({}, {"Last-Event-ID": "x"}),
        ({}, {"Last-Event-ID": "-4"}),
        ({"after": "3"}, {"Last-Event-ID": " 3"}),
        ({}, {"Last-Event-ID": str(2**63)}),
        ({"after": "9" * 5000}, {}),
    ],
)
def test_a_malformed_resume_point_is_a_validation_error(
    client: TestClient, finished_run_id: str, params: dict[str, str], headers: dict[str, str]
) -> None:
    response = client.get(stream_url(finished_run_id), params=params, headers=headers)
    assert response.status_code == 422
    assert response.json()["error"]["error_code"] == "VALIDATION_ERROR"


def test_an_unknown_run_is_a_404_before_the_stream_opens(client: TestClient) -> None:
    response = client.get(stream_url("RUN-NOSUCHRUN000"))
    assert response.status_code == 404
    assert response.headers["content-type"].startswith("application/json")
    assert response.json()["error"]["error_code"] == "NOT_FOUND"


def test_a_cross_origin_reconnect_may_send_last_event_id(client: TestClient) -> None:
    response = client.options(
        stream_url("RUN-ANY"),
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "last-event-id",
        },
    )
    assert response.status_code == 200
    assert "last-event-id" in response.headers["access-control-allow-headers"].lower()


def test_a_streamed_response_carries_the_request_id_and_its_logs_do_too(
    client: TestClient,
    finished_run_id: str,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """The store fails mid-stream, so the stream writes a log record while
    its body is being sent; that record carries the request's id."""
    store = client.app.state.query_service.store  # type: ignore[attr-defined]
    read = store.events
    reads: list[int] = []

    def failing_events(run_id: str, after: int = 0) -> list[dict[str, Any]]:
        reads.append(after)
        if len(reads) > 1:
            raise OSError("disk I/O error")
        return [event for event in read(run_id, after) if event["sequence"] <= 3]

    monkeypatch.setattr(store, "events", failing_events)
    with (
        caplog.at_level(logging.ERROR),
        client.stream(
            "GET", stream_url(finished_run_id), headers={"X-Request-ID": "stream-request-1"}
        ) as response,
    ):
        text = "".join(response.iter_text())
    assert response.headers["x-request-id"] == "stream-request-1"
    assert [event["sequence"] for event in parse(text)] == [1, 2, 3]
    (logged,) = [r for r in caplog.records if r.name == "app.api.stream"]
    assert logged.context["request_id"] == "stream-request-1"  # type: ignore[attr-defined]
