"""Persisted runs: the worker, per-pipeline status, cancellation, history and
the run routes (docs/07 sections 3-6, ADR-007).

Two labs are used, both offline. The offline lab (hashing embedders, an
in-memory store holding the SCN-007 corpus, the fake generator) runs A, B and
C, with B and C wired over the static SCN-007 neighbourhood instead of Neo4j.
The tiny generated world drives the cold-start and index-guard tests through
``start_lab``, as the real API does.
"""

from __future__ import annotations

import dataclasses
import json
import logging
import shutil
import sqlite3
import threading
import time
from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, ClassVar, cast

import app.api.runs as runs_module
import app.lab as lab_module
import pytest
from app.api.errors import ApiError
from app.api.graph_world import GraphWorldCheck
from app.api.runs import QueryService, start_lab
from app.api.schemas import QueryRequest
from app.config import GraphConfig, RetrievalSettings
from app.events import TERMINAL_EVENT_TYPES, EventSink
from app.evidence import EvidenceChunk
from app.lab import Lab, WiredGraphPipelines, graph_pipelines
from app.main import create_app
from app.persistence.store import RunRow, RunStore
from app.retrieval.graph.neo4j_adapter import GraphReader
from app.retrieval.graph.resolution import StaticEntityResolver
from app.retrieval.graph.traversal import NeighbourEdge, NeighbourProvider
from app.retrieval.standard.generation import GenerationError, GenerationOutput
from app.retrieval.standard.index import index_corpus
from app.retrieval.standard.vector_store import InMemoryVectorStore
from fastapi.testclient import TestClient

from tests.conftest import build_lab_offline
from tests.test_graph_rag import build_corpus, resolved, scn007_adjacency
from tests.test_standard_rag import make_settings

GRAPH = GraphConfig(uri="bolt://unused", user="unused", password="unused", database="unused")
FINISHED = frozenset({"completed", "failed", "cancelled"})
ENVELOPE = {"event_id", "timestamp", "run_id", "pipeline", "event_type", "t_ms", "payload"}
QUESTION = "Which incidents affected the Greek digital checkout on PLV_PAYMENTS_3?"
# The only timeout of a blocked test double: a deadline, never a pacing delay.
DEADLINE_S = 15.0


# -- doubles ------------------------------------------------------------------


class FailingGenerator:
    """Gateway stub whose every call fails, like a downed provider."""

    model_name = "failing-gateway-v1"

    def generate(self, question: str, contexts: list[EvidenceChunk]) -> GenerationOutput:
        raise GenerationError("Model gateway call failed: http://internal-gateway:4000 refused")


class _Reader:
    def close(self) -> None:
        pass


class _FailingReader:
    def close(self) -> None:
        raise ConnectionError("bolt://internal-host:7687 reset during close")


class SlowNeighbours:
    """Blocks every neighbour lookup until released, so a graph pipeline is
    observably running for as long as the test needs."""

    def __init__(self, inner: NeighbourProvider, release: threading.Event) -> None:
        self._inner = inner
        self._release = release

    def neighbours(
        self,
        ids: list[str],
        rel_types: tuple[str, ...],
        per_type: int,
        excluded_labels: tuple[str, ...],
    ) -> list[NeighbourEdge]:
        assert self._release.wait(DEADLINE_S), "the test never released the graph"
        return self._inner.neighbours(ids, rel_types, per_type, excluded_labels)

    def concept_bound(
        self, concept_id: str, limit: int, excluded_labels: tuple[str, ...]
    ) -> list[tuple[str, str]]:
        assert self._release.wait(DEADLINE_S), "the test never released the graph"
        return self._inner.concept_bound(concept_id, limit, excluded_labels)


def offline_wiring(
    neighbours: NeighbourProvider, reader: object | None = None
) -> Callable[[Lab, GraphConfig, EventSink | None], WiredGraphPipelines]:
    """B and C over the given neighbourhood: no Neo4j. ``reader`` stands in
    for the Neo4j reader the worker closes."""

    def wire(
        lab: Lab, graph_config: GraphConfig, sink: EventSink | None = None
    ) -> WiredGraphPipelines:
        del graph_config
        resolver = StaticEntityResolver(resolved())
        pipelines = graph_pipelines(lab, neighbours, resolver, resolver, sink=sink)
        stand_in = reader if reader is not None else _Reader()
        return WiredGraphPipelines(reader=cast(GraphReader, stand_in), pipelines=pipelines)

    return wire


# -- helpers ------------------------------------------------------------------


def wait_until(predicate: Callable[[], bool], timeout: float = 2 * DEADLINE_S) -> None:
    deadline = time.monotonic() + timeout
    while not predicate():
        if time.monotonic() > deadline:
            pytest.fail("condition not reached in time")
        time.sleep(0.01)


def request(**fields: Any) -> QueryRequest:
    return QueryRequest(question=QUESTION, **fields)


def store(service: QueryService) -> RunStore:
    return service.store


def row(service: QueryService, run_id: str) -> RunRow:
    found = service.store.get_run(run_id)
    assert found is not None
    return found


def pipeline_running(service: QueryService, run_id: str, tag: str) -> bool:
    return row(service, run_id).pipeline_status[tag] == "running"


def wait_finished(service: QueryService, run_id: str) -> RunRow:
    wait_until(lambda: row(service, run_id).status in FINISHED)
    return row(service, run_id)


def start(client: TestClient, **body: Any) -> str:
    response = client.post("/api/v1/queries", json={"question": QUESTION, **body})
    assert response.status_code == 202, response.text
    run_id: str = response.json()["run_id"]
    return run_id


def await_finished(client: TestClient, run_id: str) -> dict[str, Any]:
    payload: dict[str, Any] = {}

    def finished() -> bool:
        payload.update(client.get(f"/api/v1/queries/{run_id}").json())
        return payload["status"] in FINISHED

    wait_until(finished)
    return payload


def run_to_completion(client: TestClient, **body: Any) -> dict[str, Any]:
    run_id = start(client, **body)
    results = await_finished(client, run_id)
    events = client.get(f"/api/v1/queries/{run_id}/events").json()["events"]
    return {"run_id": run_id, "results": results, "events": events}


def wait_idle(client: TestClient) -> None:
    """Every run of this test has finished, so no worker outlives it."""

    def idle() -> bool:
        runs = client.get("/api/v1/queries?limit=100").json()["runs"]
        return all(run["status"] in FINISHED for run in runs)

    wait_until(idle)
    # Retired too: a worker scores a bank question after its final status.
    service = client.app.state.query_service  # type: ignore[attr-defined]
    wait_until(lambda: not service._active)


# -- fixtures -----------------------------------------------------------------


@pytest.fixture(scope="module")
def lab() -> Lab:
    built = build_lab_offline()
    index_corpus(built.store, built.embeddings, built.sparse, list(build_corpus().values()))
    return built


@pytest.fixture()
def release() -> threading.Event:
    return threading.Event()


@pytest.fixture()
def slow_service(
    lab: Lab, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, release: threading.Event
) -> Iterator[QueryService]:
    """A service whose graph pipelines wait on every hop until released."""
    monkeypatch.setattr(
        runs_module, "wired_pipelines", offline_wiring(SlowNeighbours(scn007_adjacency(), release))
    )
    service = QueryService(RunStore(tmp_path / "runs.db", retention=50), lambda: lab, GRAPH)
    yield service
    release.set()
    wait_until(lambda: all(r.status in FINISHED for r in service.store.list_runs(100, None, None)))
    service.store.close()


service_with_slow_b = slow_service
service_with_slow_c = slow_service


@pytest.fixture()
def client(lab: Lab, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setattr(runs_module, "wired_pipelines", offline_wiring(scn007_adjacency()))
    with TestClient(create_app(lab_factory=lambda: lab, graph_config=GRAPH)) as test_client:
        yield test_client
        wait_idle(test_client)


@pytest.fixture()
def lab_gate() -> threading.Event:
    return threading.Event()


@pytest.fixture()
def lab_built() -> threading.Event:
    return threading.Event()


@pytest.fixture()
def client_with_slow_lab(
    lab: Lab,
    monkeypatch: pytest.MonkeyPatch,
    lab_gate: threading.Event,
    lab_built: threading.Event,
) -> Iterator[TestClient]:
    """The lab builds only once ``lab_gate`` is set, like a cold start, and
    sets ``lab_built`` when it returns."""
    monkeypatch.setattr(runs_module, "wired_pipelines", offline_wiring(scn007_adjacency()))

    def slow_lab() -> Lab:
        assert lab_gate.wait(DEADLINE_S), "the test never released the lab"
        lab_built.set()
        return lab

    with TestClient(create_app(lab_factory=slow_lab, graph_config=GRAPH)) as test_client:
        yield test_client
        lab_gate.set()
        wait_idle(test_client)


def tiny_client(settings: RetrievalSettings) -> TestClient:
    """A client over ``start_lab``, the API's own lab start-up with cold-start indexing."""
    return TestClient(create_app(lab_factory=lambda: start_lab(settings), graph_config=GRAPH))


# -- live per-pipeline results ------------------------------------------------


def test_results_of_a_finished_pipeline_are_readable_while_the_next_runs(
    service_with_slow_c: QueryService, release: threading.Event
) -> None:
    run_id = service_with_slow_c.start(request(configurations=["A", "C"]))
    wait_until(
        lambda: (
            row(service_with_slow_c, run_id).pipeline_status == {"A": "completed", "C": "running"}
        )
    )
    assert "A" in store(service_with_slow_c).results(run_id)
    assert row(service_with_slow_c, run_id).pipeline_status["C"] == "running"
    release.set()  # the run ends inside the test, so no worker crosses its teardown
    assert wait_finished(service_with_slow_c, run_id).status == "completed"
    wait_until(lambda: not service_with_slow_c._active)


def test_a_completed_run_stores_every_result_and_status(client: TestClient) -> None:
    run = run_to_completion(client, configurations=["A", "B", "C"])["results"]
    assert run["status"] == "completed" and run["error"] is None
    assert run["pipeline_status"] == {"A": "completed", "B": "completed", "C": "completed"}
    assert set(run["results"]) == {"A", "B", "C"}
    assert run["results"]["A"]["evidence"] and run["results"]["C"]["node_evidence"]
    assert run["created_at"].endswith("+00:00") and run["finished_at"].endswith("+00:00")


def test_two_runs_at_once_each_complete_with_their_own_events(client: TestClient) -> None:
    first, second = start(client), start(client)
    for run_id in (first, second):
        assert await_finished(client, run_id)["status"] == "completed"
        events = client.get(f"/api/v1/queries/{run_id}/events").json()["events"]
        assert {event["run_id"] for event in events} == {run_id}


# -- cancellation -------------------------------------------------------------


def test_cancel_stops_at_the_next_stage_and_keeps_finished_pipelines(
    service_with_slow_b: QueryService, release: threading.Event
) -> None:
    run_id = service_with_slow_b.start(request(configurations=["A", "B", "C"]))
    wait_until(lambda: pipeline_running(service_with_slow_b, run_id, "B"))
    assert service_with_slow_b.cancel(run_id)
    release.set()  # B resumes, and its next event is the cancellation point
    run = wait_finished(service_with_slow_b, run_id)
    assert run.status == "cancelled" and run.pipeline_status == {
        "A": "completed",
        "B": "cancelled",
        "C": "skipped",
    }
    assert set(store(service_with_slow_b).results(run_id)) == {"A"}
    wait_until(lambda: not service_with_slow_b._active)
    events = store(service_with_slow_b).events(run_id)
    assert [(e["event_type"], e["pipeline"]) for e in events[-2:]] == [
        ("pipeline.cancelled", "B"),
        ("run.cancelled", "run"),
    ]
    assert not any(e["pipeline"] == "C" for e in events)
    assert run.error == {
        "error_code": "CANCELLED",
        "message": "The run was cancelled.",
        "retryable": True,
    }


def test_cancel_before_any_pipeline_starts_skips_them_all(
    lab: Lab, tmp_path: Path, lab_gate: threading.Event
) -> None:
    def slow_lab() -> Lab:
        assert lab_gate.wait(DEADLINE_S), "the test never released the lab"
        return lab

    service = QueryService(RunStore(tmp_path / "runs.db", retention=50), slow_lab, GRAPH)
    try:
        run_id = service.start(request(configurations=["A", "B"]))
        # At once: run.started is recorded even when the flag is already set.
        assert service.cancel(run_id)
        lab_gate.set()
        run = wait_finished(service, run_id)
        assert run.status == "cancelled"
        assert run.pipeline_status == {"A": "skipped", "B": "skipped"}
        types = [e["event_type"] for e in service.store.events(run_id)]
        assert types == ["run.started", "run.cancelled"]
    finally:
        lab_gate.set()
        service.store.close()


def test_cancel_of_an_unknown_or_finished_run_is_refused(client: TestClient) -> None:
    run_id = run_to_completion(client, configurations=["A"])["run_id"]
    response = client.post(f"/api/v1/queries/{run_id}/cancel")
    assert response.status_code == 409
    assert response.json()["error"]["error_code"] == "CONFLICT"
    missing = client.post("/api/v1/queries/RUN-UNKNOWN/cancel")
    assert missing.status_code == 404
    assert missing.json()["error"]["error_code"] == "NOT_FOUND"


def test_cancel_route_accepts_an_active_run(
    client_with_slow_lab: TestClient, lab_gate: threading.Event
) -> None:
    run_id = start(client_with_slow_lab, configurations=["A"])
    response = client_with_slow_lab.post(f"/api/v1/queries/{run_id}/cancel")
    assert response.status_code == 202
    assert response.json()["run_id"] == run_id
    # The summary is read after the flag is set, so the worker may already have stopped.
    assert response.json()["status"] in {"queued", "running", "cancelled"}
    lab_gate.set()
    assert await_finished(client_with_slow_lab, run_id)["status"] == "cancelled"


# -- events -------------------------------------------------------------------


def test_events_carry_run_id_and_gap_free_sequences(client: TestClient) -> None:
    events = run_to_completion(client)["events"]
    assert {e["run_id"] for e in events} == {events[0]["run_id"]} and [
        e["sequence"] for e in events
    ] == list(range(1, len(events) + 1))
    assert events[0]["event_type"] == "run.started" and events[-1]["event_type"] == "run.completed"


def test_events_use_exactly_the_envelope(client: TestClient) -> None:
    events = run_to_completion(client, configurations=["A"])["events"]
    assert all(set(event) == ENVELOPE | {"sequence"} for event in events)
    assert all(e["event_id"] and e["timestamp"].endswith("+00:00") for e in events)
    assert len({e["event_id"] for e in events}) == len(events)


def test_pipeline_lifecycle_events_bracket_each_pipeline(client: TestClient) -> None:
    events = run_to_completion(client, configurations=["A", "C"])["events"]
    lifecycle = [
        (e["event_type"], e["pipeline"])
        for e in events
        if e["event_type"].startswith(("run.", "pipeline."))
    ]
    assert lifecycle == [
        ("run.started", "run"),
        ("pipeline.started", "A"),
        ("pipeline.completed", "A"),
        ("pipeline.started", "C"),
        ("pipeline.completed", "C"),
        ("run.completed", "run"),
    ]
    a_events = [e["event_type"] for e in events if e["pipeline"] == "A"]
    assert a_events[1] == "rag.query.received"


def test_replay_returns_the_identical_recorded_stream(client: TestClient) -> None:
    run_id = run_to_completion(client, configurations=["A"])["run_id"]
    first = client.get(f"/api/v1/queries/{run_id}/events").json()
    assert first["status"] == "completed"
    assert client.get(f"/api/v1/queries/{run_id}/events").json() == first


def test_wait_for_wakes_on_a_new_event_and_times_out_otherwise(
    lab: Lab, tmp_path: Path, lab_gate: threading.Event
) -> None:
    def slow_lab() -> Lab:
        assert lab_gate.wait(DEADLINE_S), "the test never released the lab"
        return lab

    service = QueryService(RunStore(tmp_path / "runs.db", retention=50), slow_lab, GRAPH)
    try:
        run_id = service.start(request(configurations=["A"]))
        wait_until(lambda: len(service.store.events(run_id)) == 1)
        assert service.wait_for(run_id, 1, 0.05) is False
        lab_gate.set()
        assert service.wait_for(run_id, 1, 10) is True
        assert len(service.store.events(run_id)) > 1
        wait_finished(service, run_id)
        # The final row is written just before the run is retired.
        wait_until(lambda: not service._active)
        assert service.wait_for(run_id, 10_000, 0.01) is True
    finally:
        lab_gate.set()
        service.store.close()


# -- history ------------------------------------------------------------------


def test_history_lists_newest_first_and_pages(client: TestClient) -> None:
    ids = [start(client) for _ in range(3)]
    page = client.get("/api/v1/queries?limit=2").json()
    assert [r["run_id"] for r in page["runs"]] == ids[::-1][:2] and page["next_before"]
    rest = client.get("/api/v1/queries", params={"limit": 2, "before": page["next_before"]}).json()
    assert [r["run_id"] for r in rest["runs"]] == [ids[0]] and rest["next_before"] is None


def test_history_filters_by_status(client: TestClient) -> None:
    run_id = run_to_completion(client, configurations=["A"])["run_id"]
    completed = client.get("/api/v1/queries?status=completed").json()["runs"]
    assert [r["run_id"] for r in completed] == [run_id]
    assert client.get("/api/v1/queries?status=failed").json() == {"runs": [], "next_before": None}


def test_history_summaries_carry_status_but_no_results(client: TestClient) -> None:
    run_to_completion(client, configurations=["A"])
    (summary,) = client.get("/api/v1/queries").json()["runs"]
    assert summary["pipeline_status"] == {"A": "completed"} and summary["kind"] == "live"
    assert "results" not in summary and summary["question"] == QUESTION


def test_history_limit_above_the_maximum_is_refused(client: TestClient) -> None:
    assert client.get("/api/v1/queries?limit=101").status_code == 422


@pytest.mark.parametrize("before", ["garbage", "2026-10-20T00:00:00Z|RUN-1", "|RUN-1"])
def test_a_malformed_history_cursor_is_a_validation_error(client: TestClient, before: str) -> None:
    response = client.get("/api/v1/queries", params={"before": before})
    assert response.status_code == 422
    assert response.json()["error"]["error_code"] == "VALIDATION_ERROR"


def test_a_slow_cold_start_does_not_block_history(
    client_with_slow_lab: TestClient, lab_built: threading.Event, lab_gate: threading.Event
) -> None:
    run_id = start(client_with_slow_lab)
    assert client_with_slow_lab.get("/api/v1/queries").status_code == 200
    # The lab is still building: the worker may not yet have marked the run running.
    assert client_with_slow_lab.get(f"/api/v1/queries/{run_id}").json()["status"] in {
        "queued",
        "running",
    }
    # Both reads returned while the lab factory was still blocked on its gate,
    # so neither waited for the cold start. No wall-clock bound is needed.
    assert not lab_built.is_set()
    lab_gate.set()  # the run ends inside the test, so no worker crosses its teardown
    assert await_finished(client_with_slow_lab, run_id)["status"] == "completed"
    wait_idle(client_with_slow_lab)


# -- start-up -----------------------------------------------------------------


def test_runs_left_running_are_marked_interrupted_at_start_up(lab: Lab, run_database: Path) -> None:
    left = RunStore(run_database, retention=50)
    left.create_run(
        RunRow(
            run_id="RUN-LEFT",
            kind="live",
            status="running",
            question=QUESTION,
            market_scope=(),
            configurations=("A",),
            benchmark_instance_id=None,
            created_at=datetime.now(UTC).isoformat(),
            finished_at=None,
            pipeline_status={"A": "running"},
            error=None,
        )
    )
    app = create_app(lab_factory=lambda: lab, graph_config=GRAPH)
    assert left.get_run("RUN-LEFT").status == "running"  # type: ignore[union-attr]
    left.close()
    with TestClient(app) as test_client:
        run = test_client.get("/api/v1/queries/RUN-LEFT").json()
    assert run["status"] == "failed" and run["error"]["error_code"] == "INTERRUPTED"
    assert run["pipeline_status"] == {"A": "failed"}


def test_an_interrupted_run_streams_to_a_terminal_event_and_closes(
    lab: Lab, run_database: Path
) -> None:
    left = RunStore(run_database, retention=50)
    left.create_run(
        RunRow(
            run_id="RUN-LEFT",
            kind="live",
            status="running",
            question=QUESTION,
            market_scope=(),
            configurations=("A", "B"),
            benchmark_instance_id=None,
            created_at=datetime.now(UTC).isoformat(),
            finished_at=None,
            pipeline_status={"A": "completed", "B": "running"},
            error=None,
        )
    )
    left.append_event(
        "RUN-LEFT",
        {
            "event_id": "EV-1",
            "timestamp": datetime.now(UTC).isoformat(),
            "run_id": "RUN-LEFT",
            "event_type": "run.started",
            "pipeline": "run",
            "t_ms": 1.0,
            "payload": {},
        },
    )
    left.close()
    with TestClient(create_app(lab_factory=lambda: lab, graph_config=GRAPH)) as test_client:
        # The stream returns only because the server closes it after the terminal event.
        stream = test_client.get("/api/v1/queries/RUN-LEFT/events/stream")
        events = test_client.get("/api/v1/queries/RUN-LEFT/events").json()["events"]
    interrupted = {
        "error_code": "INTERRUPTED",
        "message": "The server stopped during this run.",
        "retryable": True,
    }
    assert [(e["event_type"], e["pipeline"]) for e in events] == [
        ("run.started", "run"),
        ("pipeline.failed", "B"),
        ("run.failed", "run"),
    ]
    assert events[1]["payload"] == events[2]["payload"] == interrupted
    assert set(events[2]) >= ENVELOPE and events[2]["run_id"] == "RUN-LEFT"
    frames = [f for f in stream.text.split("\n\n") if f.startswith("id:")]
    assert len(frames) == 3 and "event: run.failed" in frames[-1]


# -- request validation (moved from test_api_queries) -------------------------


class TestRequestValidation:
    def test_empty_question_rejected(self, client: TestClient) -> None:
        assert client.post("/api/v1/queries", json={"question": ""}).status_code == 422

    def test_unknown_configuration_rejected(self, client: TestClient) -> None:
        response = client.post(
            "/api/v1/queries", json={"question": "What happened?", "configurations": ["D"]}
        )
        assert response.status_code == 422

    @pytest.mark.parametrize("profile", ["fraud", None])
    def test_the_retired_profile_field_is_refused(
        self, client: TestClient, profile: str | None
    ) -> None:
        response = client.post(
            "/api/v1/queries", json={"question": "What happened?", "profile": profile}
        )
        assert response.status_code == 422
        assert "profile" in response.json()["error"]["message"]

    def test_unknown_market_rejected(self, client: TestClient) -> None:
        response = client.post(
            "/api/v1/queries", json={"question": "What happened?", "market_scope": ["XX"]}
        )
        assert response.status_code == 422

    def test_markets_normalised_to_full_ids(self, client: TestClient) -> None:
        run_id = start(client, configurations=["A"], market_scope=["uk", "MKT_GR"])
        assert await_finished(client, run_id)["market_scope"] == ["MKT_UK", "MKT_GR"]

    def test_unknown_run_returns_404(self, client: TestClient) -> None:
        assert client.get("/api/v1/queries/RUN-UNKNOWN").status_code == 404
        assert client.get("/api/v1/queries/RUN-UNKNOWN/events").status_code == 404


# -- lifecycle over the tiny world (moved from test_api_queries) --------------


class TestTinyWorldRuns:
    def test_submission_returns_run_pointer_immediately(self, client: TestClient) -> None:
        response = client.post(
            "/api/v1/queries", json={"question": "Which game costs 3.50?", "configurations": ["A"]}
        )
        assert response.status_code == 202
        payload = response.json()
        assert payload["status"] == "queued"
        assert payload["events_url"].startswith("/api/v1/queries/")
        assert payload["results_url"] == payload["events_url"].removesuffix("/events")

    def test_pipeline_a_completes_with_answer_and_evidence(self, tiny_dataset: Path) -> None:
        with tiny_client(make_settings(dataset_dir=str(tiny_dataset))) as client:
            run_id = start(
                client,
                question="What do the game rules say about prize tiers?",
                configurations=["A"],
            )
            payload = await_finished(client, run_id)
        assert payload["status"] == "completed" and payload["error"] is None
        result = payload["results"]["A"]
        assert result["answer"]["text"] and result["answer"]["verdict"]
        assert result["answer"]["cited_blocks"] == [1]
        assert result["evidence"], "pipeline A must retrieve document chunks"

    def test_scoped_run_filters_pipeline_a_evidence(self, tiny_dataset: Path) -> None:
        with tiny_client(make_settings(dataset_dir=str(tiny_dataset))) as client:
            run_id = start(
                client,
                question="What do the game rules say about prize tiers?",
                configurations=["A"],
                market_scope=["MKT_GR"],
            )
            payload = await_finished(client, run_id)
        assert payload["status"] == "completed"
        evidence = payload["results"]["A"]["evidence"]
        # The scoped market, plus shared (market-less) evidence.
        assert {chunk["market_id"] for chunk in evidence} <= {"MKT_GR", ""}
        assert any(chunk["market_id"] == "MKT_GR" for chunk in evidence)

    @staticmethod
    def _cold_start(settings: RetrievalSettings) -> None:
        with tiny_client(settings) as client:
            run_id = start(client, question="Anything at all.", configurations=["A"])
            assert await_finished(client, run_id)["status"] == "completed"

    def test_in_memory_cold_start_never_writes_a_manifest(
        self, tiny_dataset: Path, tmp_path: Path
    ) -> None:
        """An in-memory index dies with the process: it must not overwrite the
        manifest of the persistent index built for the same world."""
        dataset_dir = tmp_path / "world"
        shutil.copytree(tiny_dataset, dataset_dir)
        manifest = dataset_dir / "vector-index.json"
        manifest.write_text('{"record_serialiser_version": "built-elsewhere"}')
        self._cold_start(make_settings(dataset_dir=str(dataset_dir)))
        assert manifest.read_text() == '{"record_serialiser_version": "built-elsewhere"}'
        manifest.unlink()
        self._cold_start(make_settings(dataset_dir=str(dataset_dir)))
        assert not manifest.exists()

    def test_persistent_cold_start_indexing_stamps_the_serialiser_version(
        self, tiny_dataset: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.retrieval.standard.embeddings import HashingEmbedder
        from app.retrieval.standard.records import RECORD_SERIALISER_VERSION

        dataset_dir = tmp_path / "world"
        shutil.copytree(tiny_dataset, dataset_dir)
        (dataset_dir / "vector-index.json").unlink(missing_ok=True)
        base = make_settings(dataset_dir=str(dataset_dir))
        # A persistent provider (the empty store stands in for a fresh Qdrant collection).
        settings = dataclasses.replace(
            base,
            embedding=dataclasses.replace(
                base.embedding, provider="ollama", sparse_provider="hashing"
            ),
            rerank=dataclasses.replace(base.rerank, provider="lexical"),
        )
        embedder = HashingEmbedder(dimensions=settings.embedding.dimensions)
        monkeypatch.setattr(lab_module, "build_embedder", lambda _settings: embedder)
        monkeypatch.setattr(lab_module, "build_store", lambda *_args: InMemoryVectorStore())
        self._cold_start(settings)
        written = json.loads((dataset_dir / "vector-index.json").read_text())
        assert written["record_serialiser_version"] == RECORD_SERIALISER_VERSION


# -- failures -----------------------------------------------------------------


class TestFailures:
    def test_a_failed_pipeline_fails_the_run_and_skips_the_rest(
        self, lab: Lab, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
    ) -> None:
        monkeypatch.setattr(runs_module, "wired_pipelines", offline_wiring(scn007_adjacency()))
        failing = dataclasses.replace(lab, generator=FailingGenerator())
        app = create_app(lab_factory=lambda: failing, graph_config=GRAPH)
        with TestClient(app) as client, caplog.at_level(logging.ERROR):
            run = run_to_completion(client, configurations=["A", "B", "C"])
        results, events = run["results"], run["events"]
        assert results["status"] == "failed"
        assert results["pipeline_status"] == {"A": "failed", "B": "skipped", "C": "skipped"}
        envelope = {
            "error_code": "MODEL_ERROR",
            "message": "The language model could not produce an answer.",
            "retryable": True,
        }
        assert results["error"] == envelope
        assert [(e["event_type"], e["pipeline"]) for e in events[-2:]] == [
            ("pipeline.failed", "A"),
            ("run.failed", "run"),
        ]
        assert events[-1]["payload"] == envelope and events[-2]["payload"] == envelope
        assert "internal-gateway" not in json.dumps(run)
        assert any("internal-gateway" in str(r.exc_info) for r in caplog.records if r.exc_info)

    def test_dense_only_collection_maps_to_vector_error(
        self, tiny_dataset: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
    ) -> None:
        class DenseOnlyStore(InMemoryVectorStore):
            def count(self) -> int:
                return 1

            def collection_info(self) -> dict[str, object]:
                return {"vectors": [""], "sparse_vectors": [], "points": 1, "dimensions": None}

        monkeypatch.setattr(lab_module, "build_store", lambda *_args: DenseOnlyStore())
        with (
            tiny_client(make_settings(dataset_dir=str(tiny_dataset))) as client,
            caplog.at_level(logging.ERROR),
        ):
            payload = await_finished(client, start(client, configurations=["A"]))
        assert payload["status"] == "failed"
        assert payload["pipeline_status"] == {"A": "skipped"}
        assert payload["error"] == {
            "error_code": "VECTOR_RETRIEVAL_ERROR",
            "message": "The vector index could not be searched.",
            "retryable": True,
        }
        assert any("lacks a sparse vector" in str(r.exc_info) for r in caplog.records)

    @pytest.mark.parametrize("manifest", [None, {"record_serialiser_version": "2.0.0"}])
    def test_index_built_by_another_serialiser_maps_to_vector_error(
        self,
        tiny_dataset: Path,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
        caplog: pytest.LogCaptureFixture,
        manifest: dict[str, str] | None,
    ) -> None:
        class PopulatedStore(InMemoryVectorStore):
            def count(self) -> int:
                return 1

        dataset_dir = tmp_path / "world"
        shutil.copytree(tiny_dataset, dataset_dir)
        (dataset_dir / "vector-index.json").unlink(missing_ok=True)
        if manifest is not None:
            (dataset_dir / "vector-index.json").write_text(json.dumps(manifest))
        monkeypatch.setattr(lab_module, "build_store", lambda *_args: PopulatedStore())
        with (
            tiny_client(make_settings(dataset_dir=str(dataset_dir))) as client,
            caplog.at_level(logging.ERROR),
        ):
            payload = await_finished(client, start(client, configurations=["A"]))
        assert payload["status"] == "failed"
        assert payload["error"]["error_code"] == "VECTOR_RETRIEVAL_ERROR"
        assert any("record serialiser" in str(r.exc_info) for r in caplog.records)

    def test_a_failed_lab_build_is_retried_by_the_next_run(self, lab: Lab, tmp_path: Path) -> None:
        attempts: list[int] = []

        def flaky_lab() -> Lab:
            attempts.append(1)
            if len(attempts) == 1:
                raise RuntimeError("index not ready")
            return lab

        service = QueryService(RunStore(tmp_path / "runs.db", retention=50), flaky_lab, GRAPH)
        try:
            first = service.start(request(configurations=["A"]))
            assert wait_finished(service, first).status == "failed"
            wait_until(lambda: not service._active)
            second = service.start(request(configurations=["A"]))
            assert wait_finished(service, second).status == "completed"
            wait_until(lambda: not service._active)
        finally:
            service.store.close()


# -- the end of a run: races with cancel and store failures ------------------


class HookedStore(RunStore):
    """A run store whose writes call test hooks, to force an ordering or a failure."""

    def __init__(self, path: Path) -> None:
        super().__init__(path, retention=50)
        self.before_put_result: Callable[[str], None] = lambda _pipeline: None
        self.on_append: Callable[[dict[str, Any]], None] = lambda _event: None
        self.before_final_update: Callable[[], None] = lambda: None
        self.fail_final_update_once = False

    def put_result(self, run_id: str, pipeline: str, result: dict[str, Any]) -> None:
        self.before_put_result(pipeline)
        super().put_result(run_id, pipeline, result)

    def append_event(self, run_id: str, event: dict[str, Any]) -> int:
        self.on_append(event)
        return super().append_event(run_id, event)

    def update_run(self, run_id: str, /, **changes: Any) -> None:
        if changes.get("status") in FINISHED:
            self.before_final_update()
            if self.fail_final_update_once:
                self.fail_final_update_once = False
                raise sqlite3.OperationalError("disk I/O error")
        super().update_run(run_id, **changes)


class Pause:
    """Blocks the worker at one point until the test releases it."""

    def __init__(self) -> None:
        self.reached = threading.Event()
        self.release = threading.Event()

    def __call__(self) -> None:
        self.reached.set()
        assert self.release.wait(15), "the test never released the worker"

    def wait_reached(self) -> None:
        assert self.reached.wait(15), "the worker never reached the pause"


@pytest.fixture()
def hooked(
    lab: Lab, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> Iterator[tuple[QueryService, HookedStore]]:
    monkeypatch.setattr(runs_module, "wired_pipelines", offline_wiring(scn007_adjacency()))
    hooked_store = HookedStore(tmp_path / "runs.db")
    service = QueryService(hooked_store, lambda: lab, GRAPH)
    yield service, hooked_store
    wait_until(lambda: not service._active)
    hooked_store.close()


def terminal_events(service: QueryService, run_id: str) -> list[str]:
    types = [e["event_type"] for e in service.store.events(run_id)]
    return [t for t in types if t in TERMINAL_EVENT_TYPES]


def test_a_store_failure_at_the_finish_retires_the_run_and_wakes_waiters(
    hooked: tuple[QueryService, HookedStore], caplog: pytest.LogCaptureFixture
) -> None:
    service, hooked_store = hooked
    pause = Pause()
    hooked_store.before_final_update = pause
    hooked_store.fail_final_update_once = True
    run_id = service.start(request(configurations=["A"]))
    pause.wait_reached()
    blocked = threading.Event()

    class SignallingCondition(threading.Condition):
        """Signals once the waiter is inside ``wait``: the worker can only
        notify after the waiter has released the lock there."""

        def wait(self, timeout: float | None = None) -> bool:
            blocked.set()
            return super().wait(timeout)

    service._active[run_id]._condition = SignallingCondition()
    woke: list[tuple[bool, float]] = []

    def waiter() -> None:
        began = time.monotonic()
        woke.append((service.wait_for(run_id, 10_000, 30), time.monotonic() - began))

    thread = threading.Thread(target=waiter)
    with caplog.at_level(logging.ERROR):
        thread.start()
        assert blocked.wait(DEADLINE_S)
        pause.release.set()
        thread.join(10)
        wait_until(lambda: not service._active)
    assert woke and woke[0][0] is True and woke[0][1] < 5
    assert terminal_events(service, run_id) == ["run.completed"]
    # The row is left for mark_interrupted at the next start-up.
    assert row(service, run_id).status == "running"
    assert service.cancel(run_id) is False
    (logged,) = [r for r in caplog.records if "could not be stored" in r.getMessage()]
    assert logged.context["run_id"] == run_id  # type: ignore[attr-defined]
    assert logged.error_code == "RUN_ERROR"  # type: ignore[attr-defined]


def test_a_cancel_after_the_finish_is_claimed_is_refused(
    hooked: tuple[QueryService, HookedStore],
) -> None:
    service, hooked_store = hooked
    pause = Pause()
    hooked_store.before_final_update = pause
    run_id = service.start(request(configurations=["A"]))
    pause.wait_reached()
    assert service.cancel(run_id) is False
    pause.release.set()
    assert wait_finished(service, run_id).status == "completed"
    assert terminal_events(service, run_id) == ["run.completed"]


def test_a_cancel_accepted_before_the_claim_ends_the_run_cancelled(
    hooked: tuple[QueryService, HookedStore],
) -> None:
    service, hooked_store = hooked
    pause = Pause()
    hooked_store.before_put_result = lambda _pipeline: pause()
    run_id = service.start(request(configurations=["A"]))
    pause.wait_reached()
    assert service.cancel(run_id) is True
    pause.release.set()
    run = wait_finished(service, run_id)
    assert run.status == "cancelled" and run.pipeline_status == {"A": "completed"}
    assert set(service.store.results(run_id)) == {"A"}
    types = [e["event_type"] for e in service.store.events(run_id)]
    assert types[-2:] == ["pipeline.completed", "run.cancelled"]
    assert "pipeline.cancelled" not in types


def test_a_cancel_between_two_pipelines_skips_the_rest(
    hooked: tuple[QueryService, HookedStore],
) -> None:
    service, hooked_store = hooked
    pause = Pause()

    def after_a(event: dict[str, Any]) -> None:
        if (event["event_type"], event["pipeline"]) == ("pipeline.completed", "A"):
            pause()

    hooked_store.on_append = after_a
    run_id = service.start(request(configurations=["A", "B", "C"]))
    pause.wait_reached()
    assert service.cancel(run_id) is True
    pause.release.set()
    run = wait_finished(service, run_id)
    assert run.status == "cancelled"
    assert run.pipeline_status == {"A": "completed", "B": "skipped", "C": "skipped"}
    assert terminal_events(service, run_id) == ["run.cancelled"]


def test_a_failing_reader_close_never_costs_the_run_its_end(
    lab: Lab, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setattr(
        runs_module, "wired_pipelines", offline_wiring(scn007_adjacency(), _FailingReader())
    )
    service = QueryService(RunStore(tmp_path / "runs.db", retention=50), lambda: lab, GRAPH)
    try:
        with caplog.at_level(logging.ERROR):
            run_id = service.start(request(configurations=["B"]))
            run = wait_finished(service, run_id)
            wait_until(lambda: not service._active)
        assert run.status == "completed" and run.pipeline_status == {"B": "completed"}
        assert terminal_events(service, run_id) == ["run.completed"]
        (logged,) = [r for r in caplog.records if "reader" in r.getMessage()]
        assert "internal-host" in str(logged.exc_info)
    finally:
        service.store.close()


# -- logging ------------------------------------------------------------------


def test_worker_logs_one_pipeline_run_record_without_question_text(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    question = "Which game rules mention prize tiers?"
    with caplog.at_level(logging.INFO):
        run_id = start(client, question=question, configurations=["A"])
        await_finished(client, run_id)
    timed = [r for r in caplog.records if getattr(r, "stage", None) == "pipeline_run"]
    assert len(timed) == 1
    assert timed[0].context == {"run_id": run_id, "pipeline": "A"}  # type: ignore[attr-defined]
    assert timed[0].outcome == "ok"  # type: ignore[attr-defined]
    assert all(question not in json.dumps(vars(r), default=str) for r in caplog.records)


def test_stage_timings_are_logged_from_the_pipeline_events(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.INFO):
        run_id = run_to_completion(client, configurations=["A", "C"])["run_id"]
    stages: dict[str, list[str]] = {}
    for record in caplog.records:
        stage = getattr(record, "stage", None)
        if stage is not None and stage != "pipeline_run":
            context: dict[str, str] = record.context  # type: ignore[attr-defined]
            assert context["run_id"] == run_id
            assert record.duration_ms >= 0 and record.outcome == "ok"  # type: ignore[attr-defined]
            stages.setdefault(context["pipeline"], []).append(stage)
    assert stages == {
        "A": ["embedding", "vector_retrieval", "reranking", "generation"],
        "C": ["graph_traversal", "reranking", "generation"],
    }


# -- the world the graph holds ----------------------------------------------------


class _CountingGraph:
    """Stands in for the Neo4j reader the world check reads label counts from."""

    counts: ClassVar[dict[str, int]] = {}
    reads: ClassVar[int] = 0

    def __init__(self, config: GraphConfig) -> None:
        del config

    def label_counts(self) -> dict[str, int]:
        type(self).reads += 1
        return type(self).counts

    def close(self) -> None:
        pass


@pytest.fixture()
def world_service(
    lab: Lab, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> Iterator[QueryService]:
    """A service over a world whose ingestion statistics say 3 players."""
    world = tmp_path / "world"
    world.mkdir()
    (world / "_graph_stats.json").write_text(json.dumps({"nodes": {"Player": 3}}))
    monkeypatch.setenv("DATASET_DIR", str(world))
    monkeypatch.setattr(runs_module, "GraphReader", _CountingGraph)
    monkeypatch.setattr(runs_module, "wired_pipelines", offline_wiring(scn007_adjacency()))
    _CountingGraph.counts, _CountingGraph.reads = {"Player": 3}, 0
    service = QueryService(
        RunStore(tmp_path / "runs.db", retention=50),
        lambda: lab,
        GRAPH,
        graph_world=GraphWorldCheck(),
    )
    yield service
    wait_until(lambda: all(r.status in FINISHED for r in service.store.list_runs(100, None, None)))
    service.store.close()


@pytest.mark.parametrize("configurations", [["B"], ["C"], ["A", "B", "C"]])
def test_a_graph_run_is_refused_while_the_graph_holds_another_world(
    world_service: QueryService, configurations: list[str]
) -> None:
    _CountingGraph.counts = {"Player": 10_000}
    with pytest.raises(ApiError) as refused:
        world_service.start(request(configurations=configurations))
    assert (refused.value.status, refused.value.code) == (503, "CONFIGURATION_ERROR")
    assert refused.value.message == "the graph holds another world; run make ingest-graph"
    assert world_service.store.list_runs(10, None, None) == []


def test_a_run_of_a_alone_does_not_need_the_graph(world_service: QueryService) -> None:
    _CountingGraph.counts = {"Player": 10_000}
    run_id = world_service.start(request(configurations=["A"]))
    wait_finished(world_service, run_id)
    assert _CountingGraph.reads == 0


def test_a_graph_run_starts_when_the_graph_holds_the_active_world(
    world_service: QueryService,
) -> None:
    run_id = world_service.start(request(configurations=["B"]))
    assert wait_finished(world_service, run_id).status == "completed"


def test_a_world_never_ingested_does_not_refuse_a_graph_run(
    world_service: QueryService, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    bare = tmp_path / "bare"
    bare.mkdir()
    monkeypatch.setenv("DATASET_DIR", str(bare))
    _CountingGraph.counts = {"Player": 10_000}
    run_id = world_service.start(request(configurations=["B"]))
    assert wait_finished(world_service, run_id).status == "completed"


def _event(
    run_id: str, number: int, event_type: str, pipeline: str, **payload: Any
) -> dict[str, Any]:
    return {
        "event_id": f"EV-{number}",
        "timestamp": f"2026-10-20T00:00:{number:02d}+00:00",
        "run_id": run_id,
        "event_type": event_type,
        "pipeline": pipeline,
        "t_ms": 100.0 * number,
        "payload": payload,
    }


FAILURE = {
    "error_code": "MODEL_ERROR",
    "message": "The language model could not produce an answer.",
    "retryable": True,
}
CANCEL = {"error_code": "CANCELLED", "message": "The run was cancelled.", "retryable": True}


@pytest.mark.parametrize(
    ("ended", "status", "error", "pipelines"),
    [
        (("run.completed", {}), "completed", None, {"A": "completed", "B": "completed"}),
        (("run.failed", FAILURE), "failed", FAILURE, {"A": "completed", "B": "failed"}),
        (("run.cancelled", CANCEL), "cancelled", CANCEL, {"A": "completed", "B": "cancelled"}),
    ],
)
def test_start_up_respects_a_terminal_event_already_stored(
    lab: Lab,
    run_database: Path,
    ended: tuple[str, dict[str, Any]],
    status: str,
    error: dict[str, Any] | None,
    pipelines: dict[str, str],
) -> None:
    """The write of the final row failed after the terminal event was stored:
    the row is set from that event, and no event is appended."""
    event_type, payload = ended
    store_ = RunStore(run_database, retention=50)
    store_.create_run(
        RunRow(
            run_id="RUN-HALF",
            kind="live",
            status="running",
            question=QUESTION,
            market_scope=(),
            configurations=("A", "B"),
            benchmark_instance_id=None,
            created_at=datetime.now(UTC).isoformat(),
            finished_at=None,
            pipeline_status={"A": "completed", "B": "running"},
            error=None,
        )
    )
    stored = [
        _event("RUN-HALF", 1, "run.started", "run"),
        _event("RUN-HALF", 2, "pipeline.completed", "A"),
    ]
    if event_type == "run.completed":
        stored.append(_event("RUN-HALF", 3, "pipeline.completed", "B"))
    else:
        end = "pipeline.failed" if event_type == "run.failed" else "pipeline.cancelled"
        stored.append(_event("RUN-HALF", 3, end, "B", **payload))
    stored.append(_event("RUN-HALF", 4, event_type, "run", **payload))
    for event in stored:
        store_.append_event("RUN-HALF", event)
    store_.close()
    with TestClient(create_app(lab_factory=lambda: lab, graph_config=GRAPH)) as test_client:
        run = test_client.get("/api/v1/queries/RUN-HALF").json()
        events = test_client.get("/api/v1/queries/RUN-HALF/events").json()["events"]
    assert run["status"] == status and run["error"] == error
    assert run["pipeline_status"] == pipelines
    assert run["finished_at"] == "2026-10-20T00:00:04+00:00"
    assert [e["event_type"] for e in events] == [e["event_type"] for e in stored]


def test_interruption_events_carry_the_last_stored_t_ms(lab: Lab, run_database: Path) -> None:
    """The restarted process's monotonic clock is unrelated to the stored
    events, so the new events reuse the last stored ``t_ms``."""
    left = RunStore(run_database, retention=50)
    left.create_run(
        RunRow(
            run_id="RUN-T",
            kind="live",
            status="running",
            question=QUESTION,
            market_scope=(),
            configurations=("A",),
            benchmark_instance_id=None,
            created_at=datetime.now(UTC).isoformat(),
            finished_at=None,
            pipeline_status={"A": "running"},
            error=None,
        )
    )
    left.append_event("RUN-T", _event("RUN-T", 1, "run.started", "run"))
    left.append_event("RUN-T", _event("RUN-T", 2, "pipeline.started", "A"))
    left.close()
    with TestClient(create_app(lab_factory=lambda: lab, graph_config=GRAPH)) as test_client:
        events = test_client.get("/api/v1/queries/RUN-T/events").json()["events"]
    assert [e["t_ms"] for e in events] == [100.0, 200.0, 200.0, 200.0]


def test_a_repaired_completed_bank_run_gets_the_interrupted_score_record(
    lab: Lab, run_database: Path
) -> None:
    """A bank run whose final row write failed after its terminal event is
    repaired as completed; start-up then finds it unscored (the server
    stopped before the score) and records that scoring was interrupted."""
    left = RunStore(run_database, retention=50)
    left.create_run(
        RunRow(
            run_id="RUN-BANK",
            kind="live",
            status="running",
            question=QUESTION,
            market_scope=(),
            configurations=("A",),
            benchmark_instance_id="L05-2026-INC_037",
            created_at=datetime.now(UTC).isoformat(),
            finished_at=None,
            pipeline_status={"A": "running"},
            error=None,
        )
    )
    for number, (event_type, pipeline) in enumerate(
        [("run.started", "run"), ("pipeline.completed", "A"), ("run.completed", "run")], start=1
    ):
        left.append_event("RUN-BANK", _event("RUN-BANK", number, event_type, pipeline))
    left.close()
    with TestClient(create_app(lab_factory=lambda: lab, graph_config=GRAPH)) as test_client:
        run = test_client.get("/api/v1/queries/RUN-BANK").json()
    assert run["status"] == "completed" and run["pipeline_status"] == {"A": "completed"}
    assert run["score_status"] == "failed" and run["score_failure"] == "interrupted"
    assert run["score"] is None


def test_a_graph_that_cannot_be_read_does_not_refuse_the_run(
    world_service: QueryService, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The world cannot be compared, so the run is accepted and stored; B
    then fails with a recorded graph error while A keeps its result."""
    from neo4j.exceptions import ServiceUnavailable

    def down(self: _CountingGraph) -> dict[str, int]:
        raise ServiceUnavailable("bolt://internal:7687")

    monkeypatch.setattr(_CountingGraph, "label_counts", down)

    def unreachable(lab: Lab, graph_config: GraphConfig, sink: EventSink | None = None) -> Any:
        raise ServiceUnavailable("bolt://internal:7687")

    monkeypatch.setattr(runs_module, "wired_pipelines", unreachable)
    run_id = world_service.start(request(configurations=["A", "B"]))
    finished = wait_finished(world_service, run_id)
    assert finished.status == "failed"
    assert finished.pipeline_status == {"A": "completed", "B": "failed"}
    assert finished.error is not None and finished.error["error_code"] == "GRAPH_QUERY_ERROR"
    assert "A" in world_service.store.results(run_id)
    failed = [e for e in world_service.store.events(run_id) if e["event_type"] == "pipeline.failed"]
    assert [e["pipeline"] for e in failed] == ["B"]
    assert failed[0]["payload"]["error_code"] == "GRAPH_QUERY_ERROR"
