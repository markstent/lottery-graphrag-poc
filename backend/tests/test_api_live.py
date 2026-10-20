"""Live API test (opt-in: GRAPH_E2E=1): full A/B/C execution over HTTP.

Runs the real QueryService behind TestClient against Neo4j holding the tiny
world, with deterministic embeddings and the fake generator, asserting the
accepted -> completed lifecycle and that all three pipelines return typed
results with recorded events.
"""

from __future__ import annotations

import os
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from app import lab as lab_module
from app.api.runs import QueryService
from app.config import GraphConfig, RetrievalSettings
from app.datasets.config import GenerationConfig
from app.datasets.parquet import write_world
from app.datasets.schema import TABLE_SCHEMAS
from app.datasets.world import build_world
from app.graph.ingest import ingest
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

from tests.test_graph_rag import make_settings
from tests.test_graph_rag_live import _neo4j_available


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
    if os.environ.get("GRAPH_E2E") != "1":
        pytest.skip("set GRAPH_E2E=1 to run live-graph tests (they wipe the database)")
    if not _neo4j_available(graph_config):
        pytest.skip("Neo4j is not reachable; start it with `make services-up`")
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
    service = QueryService(
        settings=settings,
        graph_config=graph_config,
        generator_name="fake",
    )
    with TestClient(create_app(service_factory=lambda: service)) as test_client:
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

    payload: dict[str, Any] = {"status": "running"}
    for _ in range(600):
        payload = client.get(f"/api/v1/queries/{run_id}").json()
        if payload["status"] != "running":
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
    assert pipelines == {"A", "B", "C"}
    assert any(event["event_type"] == "graph.relationship.traversed" for event in stream["events"])
