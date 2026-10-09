"""Benchmark harness smoke test on the live tiny graph (opt-in: GRAPH_E2E=1).

Runs the real BenchmarkRunner end to end: grounding, pipeline A/B/C
execution against a real Neo4j holding the tiny world, deterministic
scoring, and payload assembly. Embeddings and generation stay deterministic
(HashingEmbedder, FakeAnswerGenerator); the lab module is patched to use
them instead of Ollama/Qdrant.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from pathlib import Path

import pytest
from app.config import RetrievalSettings
from app.datasets.config import GenerationConfig
from app.datasets.parquet import write_world
from app.datasets.world import TABLE_SCHEMAS, build_world
from app.evaluation.runner import BenchmarkRunner
from app.graph.config import GraphConfig
from app.graph.ingest import ingest
from app.retrieval.graph import lab as lab_module
from app.retrieval.standard.corpus import load_corpus
from app.retrieval.standard.embeddings import HashingEmbedder
from app.retrieval.standard.generation import FakeAnswerGenerator
from app.retrieval.standard.index import InMemoryVectorStore

from tests.test_graph_rag import make_settings
from tests.test_graph_rag_live import _neo4j_available


@pytest.fixture(scope="module")
def tiny_dataset(tmp_path_factory: pytest.TempPathFactory) -> Path:
    world = build_world(GenerationConfig(profile="tiny", world_seed=42))
    dataset_dir = tmp_path_factory.mktemp("tiny-world-benchmark")
    write_world(dataset_dir, TABLE_SCHEMAS, world.tables)
    return dataset_dir


@pytest.fixture(scope="module")
def ingested(tiny_dataset: Path, graph_config: GraphConfig) -> Path:
    if os.environ.get("GRAPH_E2E") != "1":
        pytest.skip("set GRAPH_E2E=1 to run live-graph tests (they wipe the database)")
    if not _neo4j_available(graph_config):
        pytest.skip("Neo4j is not reachable; start it with `make services-up`")
    ingest(tiny_dataset, graph_config, ingestion_version="ing-test-benchmark", wipe=True)
    return tiny_dataset


@pytest.fixture(scope="module")
def graph_config() -> GraphConfig:
    return GraphConfig(
        uri=os.environ.get("NEO4J_URI", "bolt://localhost:7687"),
        user=os.environ.get("NEO4J_USER", "neo4j"),
        password=os.environ.get("NEO4J_PASSWORD", "devpassword"),
        database=os.environ.get("NEO4J_DATABASE", "neo4j"),
    )


@pytest.fixture()
def runner(
    ingested: Path, graph_config: GraphConfig, monkeypatch: pytest.MonkeyPatch
) -> Iterator[BenchmarkRunner]:
    settings: RetrievalSettings = make_settings(dataset_dir=str(ingested))
    embeddings = HashingEmbedder(dimensions=settings.embedding.dimensions)
    corpus = {chunk.chunk_id: chunk for chunk in load_corpus(ingested)}
    store = InMemoryVectorStore()
    if corpus:
        store.upsert(
            ids=list(corpus),
            vectors=embeddings.embed([chunk.text for chunk in corpus.values()]),
            payloads=[chunk.to_payload() for chunk in corpus.values()],
        )
    monkeypatch.setattr(lab_module, "build_embedder", lambda _settings: embeddings)
    monkeypatch.setattr(lab_module, "build_store", lambda _vs, _dim, _prov: store)
    instance = BenchmarkRunner(
        settings=settings,
        graph_config=graph_config,
        generator=FakeAnswerGenerator(),
        world_dir=ingested,
    )
    yield instance
    instance.close()


# Q01 grounds on any world; Q17 maps to an unplanted scenario; Q25's planted
# incidents cannot exist in the scenario-free tiny world.
QUESTIONS = ["Q01", "Q17", "Q25"]


def test_runner_executes_and_scores(runner: BenchmarkRunner) -> None:
    run = runner.run(QUESTIONS)
    statuses = {
        result.grounded.question.question_id: result.grounded.status for result in run.results
    }
    assert statuses == {"Q01": "ok", "Q17": "not_planted", "Q25": "not_grounded"}

    q01 = run.results[0]
    assert set(q01.runs) == {"A", "B", "C"}
    assert set(q01.scores) == {"A", "B", "C"}
    for score in q01.scores.values():
        assert score.answer_score is not None
        assert 0.0 <= score.answer_score <= 1.0
        assert score.evidence_recall is not None
        assert score.evidence_precision is not None


def test_payload_is_complete(runner: BenchmarkRunner) -> None:
    run = runner.run(QUESTIONS)
    payload = run.to_payload()
    record = payload["reproducibility"]
    assert record["git_sha"]
    assert record["question_bank_version"]
    assert record["embedding_model"].startswith("hashing")
    assert record["graph_limits"]["total_nodes"]
    entry = payload["results"][0]
    assert entry["question_id"] == "Q01"
    assert set(entry["runs"]) == {"A", "B", "C"}
    a_run = entry["runs"]["A"]
    assert a_run["context_tokens"] >= 0
    assert a_run["latency_ms"] >= 0.0
    assert entry["scores"]["A"]["answer_score"] is not None


def test_seedless_pipeline_a_records_no_seeds(runner: BenchmarkRunner) -> None:
    run = runner.run(["Q01"])
    a_run = run.results[0].runs["A"]
    assert a_run.seed_ids == ()
    assert a_run.selected_document_ids  # pipeline A retrieves document chunks
