"""Doubles and helpers shared by the API test modules: the offline B and C
wiring, a graph that blocks until released, a failing generator, and the
polling helpers for runs."""

from __future__ import annotations

import threading
import time
from collections.abc import Callable
from typing import Any, cast

import pytest
from app.api.runs import QueryService
from app.api.schemas import QueryRequest
from app.config import GraphConfig
from app.events import EventSink
from app.evidence import EvidenceChunk
from app.lab import Lab, WiredGraphPipelines, graph_pipelines
from app.persistence.store import RunRow, RunStore
from app.retrieval.graph.neo4j_adapter import GraphReader
from app.retrieval.graph.resolution import StaticEntityResolver
from app.retrieval.graph.traversal import NeighbourEdge, NeighbourProvider
from app.retrieval.standard.generation import GenerationError, GenerationOutput
from fastapi.testclient import TestClient

from tests.test_graph_rag import resolved

GRAPH = GraphConfig(uri="bolt://unused", user="unused", password="unused", database="unused")
FINISHED = frozenset({"completed", "failed", "cancelled"})
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
