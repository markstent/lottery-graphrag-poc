"""Live API tests (opt-in: GRAPH_E2E=1, and VECTOR_E2E=1 and LIVE_WORLD_E2E=1 for the first).

``test_live_run_streams_persists_scores_and_survives_a_restart`` runs the
product API as an operator would, on the presentation world (seed 2026):
Ollama embeds, Qdrant serves the collection, Neo4j holds the graph and the
fake generator answers. It asks a bank question, reads the run over SSE,
waits for the score against the answer key, then restarts the application on
the same run store and checks that the run, its events and readiness
survive. It never writes to Neo4j, so the graph stays at seed 2026. The
world, its collection and its frozen bank must exist
(``make generate-dev-data ingest-graph index-vector ground-bank``).

The second test runs the real QueryService behind TestClient against Neo4j
holding the tiny world, with deterministic embeddings and the fake
generator, asserting the accepted -> completed lifecycle and that all three
pipelines return typed results with recorded events. It wipes the database,
so the module-end fixture in conftest.py (``presentation_graph_restored``)
ingests the presentation world again afterwards.
"""

from __future__ import annotations

import json
import logging
import os
import time
from collections.abc import Callable, Iterator
from contextlib import ExitStack
from pathlib import Path
from typing import Any

import pytest
from app import lab as lab_module
from app.api.runs import start_lab
from app.config import GraphConfig, RetrievalSettings, from_env
from app.datasets.config import GenerationConfig
from app.datasets.parquet import write_world
from app.datasets.schema import TABLE_SCHEMAS
from app.datasets.world import build_world
from app.evaluation.official import PRESENTATION_SEED, world_paths
from app.graph.ingest import ingest
from app.lab import Lab
from app.main import create_app
from app.retrieval.standard.embeddings import HashingEmbedder
from app.retrieval.standard.index import (
    index_corpus,
    load_indexed_corpus,
    write_manifest,
)
from app.retrieval.standard.sparse import HashingSparseEmbedder
from app.retrieval.standard.vector_store import InMemoryVectorStore
from app.scenarios.engine import apply_scenarios
from app.scenarios.ledger import build_ledger, write_ledger
from fastapi.testclient import TestClient

from tests import live
from tests.test_graph_rag import make_settings

presentation_live = live.only_with(live.GRAPH, live.VECTOR, live.WORLD)
READY_DEADLINE_S = 300.0
SCORE_DEADLINE_S = 30.0


def wait_until(condition: Callable[[], bool], deadline_s: float, what: str) -> None:
    end = time.monotonic() + deadline_s
    while not condition():
        assert time.monotonic() < end, f"{what} did not happen within {deadline_s:.0f} s"
        time.sleep(0.25)


def wait_ready(client: TestClient) -> dict[str, Any]:
    """Readiness depends on the lab warm-up finishing, so wait for it; a
    timeout names the checks as the last poll saw them."""
    end = time.monotonic() + READY_DEADLINE_S
    while True:
        last: dict[str, Any] = client.get("/api/v1/health/ready").json()
        if last["ready"]:
            return last
        assert time.monotonic() < end, (
            f"readiness did not happen within {READY_DEADLINE_S:.0f} s: {last}"
        )
        time.sleep(0.25)


def stream_all(client: TestClient, run_id: str) -> list[dict[str, Any]]:
    """Every event of the run read from its SSE stream, until the stream closes."""
    events: list[dict[str, Any]] = []
    with client.stream("GET", f"/api/v1/queries/{run_id}/events/stream") as response:
        assert response.headers["content-type"].startswith("text/event-stream")
        for line in response.iter_lines():
            if line.startswith("data:"):
                events.append(json.loads(line.removeprefix("data:").strip()))
    return events


def first_h1(client: TestClient) -> dict[str, Any]:
    """The first demo question of stratum H1, which is a bank instance."""
    demos: list[dict[str, Any]] = client.get("/api/v1/demo/questions").json()
    return next(demo for demo in demos if demo["stratum"] == "H1")


def start_bank_question(client: TestClient, demo: dict[str, Any]) -> str:
    response = client.post(
        "/api/v1/queries",
        json={"benchmark_instance_id": demo["instance_id"], "configurations": ["A", "B", "C"]},
    )
    assert response.status_code == 202, response.text
    run_id: str = response.json()["run_id"]
    return run_id


def live_lab() -> Lab:
    """The lab ``create_app`` builds by default, from the environment; the
    suite replaces that default with an offline lab."""
    return start_lab(from_env())


@pytest.fixture
def live_app_factory(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> Iterator[Callable[[], TestClient]]:
    """Starts the application on one run store. Calling it again stops the
    previous application first, as a restart does."""
    paths = world_paths(PRESENTATION_SEED)
    live.require_paths(paths.world_dir, paths.bank_path)
    live.require_neo4j()
    monkeypatch.setenv("APP_DB_PATH", str(tmp_path / "app.db"))
    monkeypatch.setenv("DATASET_DIR", live.PRESENTATION_DATASET_DIR)
    running: list[ExitStack] = []

    def factory() -> TestClient:
        while running:
            running.pop().close()
        stack = ExitStack()
        running.append(stack)
        return stack.enter_context(TestClient(create_app(lab_factory=live_lab)))

    yield factory
    while running:
        running.pop().close()


@presentation_live
def test_live_run_streams_persists_scores_and_survives_a_restart(
    live_app_factory: Callable[[], TestClient], caplog: pytest.LogCaptureFixture
) -> None:
    client = live_app_factory()
    wait_ready(client)
    demo = first_h1(client)
    with caplog.at_level(logging.DEBUG):
        run_id = start_bank_question(client, demo)
        events = stream_all(client, run_id)
        wait_until(
            lambda: client.get(f"/api/v1/queries/{run_id}").json()["score_status"] == "scored",
            SCORE_DEADLINE_S,
            "the score",
        )
    logged = "\n".join(f"{record.getMessage()} {record.__dict__}" for record in caplog.records)
    expected = next(
        q["expected_answer"]
        for q in client.get("/api/v1/benchmarks/questions").json()
        if q["instance_id"] == demo["instance_id"]
    )
    assert expected and expected not in logged, "the expected answer reached a log record"
    assert events[-1]["event_type"] == "run.completed"
    assert [event["sequence"] for event in events] == list(range(1, len(events) + 1))
    assert {event["pipeline"] for event in events} == {"run", "A", "B", "C"}

    results = client.get(f"/api/v1/queries/{run_id}").json()
    assert results["status"] == "completed"
    assert results["score"]["label"] == "scored against the answer key"
    assert set(results["score"]["per_pipeline"]) == {"A", "B", "C"}

    restarted = live_app_factory()
    assert restarted.get(f"/api/v1/queries/{run_id}/events").json()["events"] == events
    assert restarted.get(f"/api/v1/queries/{run_id}").json() == results
    assert wait_ready(restarted)["ready"] is True


@pytest.fixture(scope="module")
def tiny_dataset(tmp_path_factory: pytest.TempPathFactory) -> Path:
    world = build_world(GenerationConfig(profile="tiny", world_seed=42))
    dataset_dir = tmp_path_factory.mktemp("tiny-world-api-live")
    write_world(dataset_dir, TABLE_SCHEMAS, world.tables)
    return dataset_dir


@pytest.fixture(scope="module")
def graph_config() -> GraphConfig:
    return GraphConfig(
        uri=os.environ.get("NEO4J_URI", "bolt://localhost:7687"),
        user=os.environ.get("NEO4J_USER", "neo4j"),
        password=os.environ.get("NEO4J_PASSWORD", "devpassword"),
        database=os.environ.get("NEO4J_DATABASE", "neo4j"),
    )


@pytest.fixture(scope="module")
def tiny_ledger(tmp_path_factory: pytest.TempPathFactory) -> Path:
    planted = build_world(GenerationConfig(profile="tiny", world_seed=42))
    ledger_path = tmp_path_factory.mktemp("tiny-ledger-api") / "ledger.json"
    write_ledger(ledger_path, build_ledger(apply_scenarios(planted), planted))
    return ledger_path


@pytest.fixture(scope="module")
def ingested(tiny_dataset: Path, graph_config: GraphConfig) -> Path:
    live.skip_without(live.GRAPH)
    live.require_neo4j(graph_config)
    ingest(tiny_dataset, graph_config, ingestion_version="ing-test-api-live", wipe=True)
    return tiny_dataset


@pytest.fixture()
def client(
    ingested: Path, graph_config: GraphConfig, monkeypatch: pytest.MonkeyPatch
) -> Iterator[TestClient]:
    settings: RetrievalSettings = make_settings(dataset_dir=str(ingested))
    embeddings = HashingEmbedder(dimensions=settings.embedding.dimensions)
    sparse = HashingSparseEmbedder()
    corpus = load_indexed_corpus(ingested)
    store = InMemoryVectorStore()
    index_corpus(store, embeddings, sparse, list(corpus.values()))
    # A pre-built index carries its manifest, as `make index-vector` writes it.
    write_manifest(settings, embeddings, sparse, list(corpus.values()))
    monkeypatch.setattr(lab_module, "build_embedder", lambda _settings: embeddings)
    monkeypatch.setattr(lab_module, "build_store", lambda _vs, _dim, _prov: store)
    app = create_app(lab_factory=lambda: start_lab(settings), graph_config=graph_config)
    with TestClient(app) as test_client:
        yield test_client


def test_full_abc_run_over_http(client: TestClient) -> None:
    response = client.post(
        "/api/v1/queries",
        json={
            "question": (
                "Which platform does GAME_UK_01 run on, and have any incidents "
                "been recorded for it?"
            ),
            "configurations": ["A", "B", "C"],
        },
    )
    assert response.status_code == 202
    run_id = response.json()["run_id"]

    payload: dict[str, Any] = {"status": "queued"}
    for _ in range(600):
        payload = client.get(f"/api/v1/queries/{run_id}").json()
        if payload["status"] not in ("queued", "running"):
            break
        time.sleep(0.1)
    assert payload["status"] == "completed", payload
    assert set(payload["results"]) == {"A", "B", "C"}
    for tag in "ABC":
        assert payload["results"][tag]["answer"]["text"]

    stream = client.get(f"/api/v1/queries/{run_id}/events").json()
    sequences = [event["sequence"] for event in stream["events"]]
    assert sequences == list(range(1, len(sequences) + 1))
    pipelines = {event["pipeline"] for event in stream["events"]}
    assert pipelines == {"run", "A", "B", "C"}
    assert payload["pipeline_status"] == {"A": "completed", "B": "completed", "C": "completed"}
    assert any(event["event_type"] == "graph.relationship.traversed" for event in stream["events"])
