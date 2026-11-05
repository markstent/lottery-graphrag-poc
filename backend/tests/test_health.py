"""Liveness and readiness (spec 6.1): ``/health`` says the process is up;
``/health/ready`` reports the lab, the index, Neo4j and the model provider
separately, never raises, never builds or waits for the lab (start-up
builds it in the background) and never leaks service text."""

from __future__ import annotations

import dataclasses
import json
import logging
import threading
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import app.api.readiness as readiness_module
import httpx
import pytest
from app.api.graph_world import GraphLease, GraphWorldCheck
from app.api.readiness import (
    MODEL_CACHE_TTL_S,
    ModelReachability,
    Probe,
    ReadinessChecks,
    graph_check,
    index_check,
    run_checks,
)
from app.api.runs import QueryService
from app.api.schemas import Check
from app.config import EmbeddingSettings, GenerationSettings, GraphConfig, RetrievalSettings
from app.graph.ingest import GRAPH_STATS_FILE
from app.lab import Lab
from app.main import app, create_app
from app.persistence.store import RunStore
from app.retrieval.standard.index import MANIFEST_NAME, index_corpus
from app.retrieval.standard.records import RECORD_SERIALISER_VERSION
from app.retrieval.standard.sparse import SparseVector
from app.retrieval.standard.vector_store import InMemoryVectorStore, VectorStoreError
from fastapi.testclient import TestClient

from tests.conftest import StubLiteLLM, build_lab_offline
from tests.helpers import (
    DEADLINE_S,
    await_finished,
    run_to_completion,
    start,
    wait_until,
)
from tests.test_graph_rag import build_corpus
from tests.test_standard_rag import make_settings

# Nothing listens on port 1: the driver is refused at once, so the generous
# timeout only bounds a broken environment and never paces the test.
GRAPH_DOWN = GraphConfig(
    uri="bolt://127.0.0.1:1", user="neo4j", password="unused", database="neo4j", timeout_s=30.0
)
CHECKS = {"lab", "index", "graph", "model", "embedding"}


class _AnsweringReader:
    """Stands in for the Neo4j reader of a healthy graph."""

    def __init__(self, config: GraphConfig) -> None:
        del config

    def ping(self) -> None:
        pass

    def close(self) -> None:
        pass


def test_health_returns_ok() -> None:
    client = TestClient(app)
    response = client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": "0.1.0"}


@pytest.fixture
def indexed_lab() -> Lab:
    """The offline lab with the SCN-007 corpus in its in-memory index."""
    lab = build_lab_offline()
    index_corpus(lab.store, lab.embeddings, lab.sparse, list(build_corpus().values()))
    return lab


@pytest.fixture
def client_with_graph_down(indexed_lab: Lab) -> Iterator[TestClient]:
    """The offline lab, already built by one completed run; Neo4j unreachable.
    The driver is imported here, so its first import is not timed by the check."""
    import neo4j  # noqa: F401

    with TestClient(create_app(lab_factory=lambda: indexed_lab, graph_config=GRAPH_DOWN)) as client:
        assert run_to_completion(client, configurations=["A"])["results"]["status"] == "completed"
        yield client


def test_ready_reports_each_check_and_503_when_the_graph_is_down(
    client_with_graph_down: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.WARNING):
        response = client_with_graph_down.get("/api/v1/health/ready")
    body = response.json()
    assert response.status_code == 503
    assert body["ready"] is False and set(body["checks"]) == CHECKS
    assert body["checks"]["graph"] == {
        "ok": False,
        "detail": "Neo4j did not answer.",
        "stand_in": False,
    }
    assert body["checks"]["lab"] == {"ok": True, "detail": "built", "stand_in": False}
    assert body["checks"]["index"]["ok"] is True
    assert body["checks"]["model"] == {
        "ok": True,
        "detail": "fake generator (offline)",
        "stand_in": True,
    }
    assert body["checks"]["embedding"] == {
        "ok": True,
        "detail": "hashing embedder (offline)",
        "stand_in": True,
    }
    # The driver's own text, which names the address, is logged and never served.
    assert "127.0.0.1" not in json.dumps(body)
    assert any(r.exc_info for r in caplog.records if r.getMessage() == "readiness check failed")


def test_ready_is_200_when_every_check_passes(
    indexed_lab: Lab,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(readiness_module, "GraphReader", _AnsweringReader)
    with TestClient(create_app(lab_factory=lambda: indexed_lab, graph_config=GRAPH_DOWN)) as client:
        run_to_completion(client, configurations=["A"])
        response = client.get("/api/v1/health/ready")
    assert response.status_code == 200
    assert response.json()["ready"] is True
    assert all(check["ok"] for check in response.json()["checks"].values())


@pytest.mark.parametrize(
    ("players", "stats", "expected"),
    [
        (200, True, Check(ok=True, detail="Neo4j answered")),
        (10_000, True, Check(ok=False, detail="the graph holds another world")),
        (10_000, False, Check(ok=True, detail="Neo4j answered")),
    ],
)
def test_graph_check_reports_a_graph_holding_another_world(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, players: int, stats: bool, expected: Check
) -> None:
    """The world check compares live label counts with the active dataset's
    ingestion statistics; without statistics the world is unknown and the
    check rests on the ping."""

    class Counting(_AnsweringReader):
        def label_counts(self) -> dict[str, int]:
            return {"Player": players}

    if stats:
        (tmp_path / GRAPH_STATS_FILE).write_text(json.dumps({"nodes": {"Player": 200}}))
    monkeypatch.setattr(readiness_module, "GraphReader", Counting)
    assert graph_check(GRAPH_DOWN, tmp_path, GraphWorldCheck()) == expected


def test_graph_check_is_not_ready_while_a_benchmark_holds_the_graph(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A match cached before the job is not served while it runs, nor after it."""
    calls: list[int] = []

    class Counting(_AnsweringReader):
        def label_counts(self) -> dict[str, int]:
            calls.append(1)
            return {"Player": 200}

    (tmp_path / GRAPH_STATS_FILE).write_text(json.dumps({"nodes": {"Player": 200}}))
    monkeypatch.setattr(readiness_module, "GraphReader", Counting)
    lease = GraphLease()
    world = GraphWorldCheck(lease=lease)
    assert graph_check(GRAPH_DOWN, tmp_path, world).ok
    hold = lease.take_benchmark()
    busy = graph_check(GRAPH_DOWN, tmp_path, world)
    hold.release()
    assert busy == Check(ok=False, detail="a benchmark run is using the graph")
    assert graph_check(GRAPH_DOWN, tmp_path, world).ok
    # Checked once before the job and once after: the cache did not survive it.
    assert len(calls) == 2


def test_readiness_never_builds_the_lab(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Without the start-up warm-up, reading readiness leaves the lab unbuilt."""
    builds: list[int] = []

    def factory() -> Lab:
        builds.append(1)
        raise AssertionError("readiness must not build the lab")

    monkeypatch.setattr(readiness_module, "GraphReader", _AnsweringReader)
    service = QueryService(RunStore(tmp_path / "runs.db", retention=50), factory, GRAPH_DOWN)
    try:
        readiness = ReadinessChecks(service, GRAPH_DOWN, settings=make_settings).run()
    finally:
        service.store.close()
    assert readiness.checks["lab"] == Check(ok=False, detail="not started")
    assert builds == []


def test_start_up_builds_the_lab_once_and_readiness_reports_building(
    indexed_lab: Lab,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    building, release = threading.Event(), threading.Event()
    builds: list[int] = []

    def gated_factory() -> Lab:
        builds.append(1)
        building.set()
        assert release.wait(DEADLINE_S), "the test never released the lab build"
        return indexed_lab

    monkeypatch.setattr(readiness_module, "GraphReader", _AnsweringReader)
    with TestClient(create_app(lab_factory=gated_factory, graph_config=GRAPH_DOWN)) as client:
        assert building.wait(DEADLINE_S), "start-up did not start the lab build"
        try:
            during = client.get("/api/v1/health/ready")
            # A run started meanwhile waits on the build instead of starting another.
            run_id = start(client, configurations=["A"])
        finally:
            release.set()
        assert await_finished(client, run_id)["status"] == "completed"
        after = client.get("/api/v1/health/ready")
    assert during.status_code == 503
    assert during.json()["checks"]["lab"] == {"ok": False, "detail": "building", "stand_in": False}
    assert after.json()["checks"]["lab"] == {"ok": True, "detail": "built", "stand_in": False}
    assert builds == [1]


def test_readiness_reports_a_failed_lab_build(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    def failing_factory() -> Lab:
        raise RuntimeError("Qdrant at http://internal-qdrant:6333 refused")

    monkeypatch.setattr(readiness_module, "GraphReader", _AnsweringReader)
    body: dict[str, Any] = {}

    def settled() -> bool:
        body.update(client.get("/api/v1/health/ready").json())
        return bool(body["checks"]["lab"]["detail"] != "building")

    with (
        caplog.at_level(logging.ERROR),
        TestClient(create_app(lab_factory=failing_factory, graph_config=GRAPH_DOWN)) as client,
    ):
        wait_until(settled)
    assert body["checks"]["lab"] == {
        "ok": False,
        "detail": "the last build failed; the next run retries it",
        "stand_in": False,
    }
    assert "internal-qdrant" not in json.dumps(body)
    assert any(r.getMessage() == "lab warm-up failed" for r in caplog.records)


# -- the check runner ---------------------------------------------------------


def test_a_check_that_hangs_times_out_and_the_others_still_report() -> None:
    release = threading.Event()

    def hangs() -> Check:
        release.wait(DEADLINE_S)
        return Check(ok=True, detail="late")

    try:
        checks = run_checks(
            {
                "slow": Probe(hangs, timeout_s=0.05, failure="unused"),
                "quick": Probe(lambda: Check(ok=True, detail="fine"), timeout_s=DEADLINE_S),
            }
        )
    finally:
        release.set()
    assert checks == {
        "slow": Check(ok=False, detail="timed out after 0.05 s"),
        "quick": Check(ok=True, detail="fine"),
    }


def test_checks_run_concurrently() -> None:
    """Each check waits for the other to start: run one after another, both time out."""
    first, second = threading.Event(), threading.Event()

    def meet(mine: threading.Event, other: threading.Event) -> Check:
        mine.set()
        return Check(ok=other.wait(DEADLINE_S), detail="met")

    checks = run_checks(
        {
            "a": Probe(lambda: meet(first, second), timeout_s=DEADLINE_S),
            "b": Probe(lambda: meet(second, first), timeout_s=DEADLINE_S),
        }
    )
    assert checks == {"a": Check(ok=True, detail="met"), "b": Check(ok=True, detail="met")}


def test_a_failing_check_reports_its_curated_detail_and_logs_the_raw_one(
    caplog: pytest.LogCaptureFixture,
) -> None:
    def fails() -> Check:
        raise ConnectionError("http://internal-host:9999 reset")

    with caplog.at_level(logging.WARNING):
        checks = run_checks({"x": Probe(fails, timeout_s=DEADLINE_S, failure="X did not answer.")})
    assert checks == {"x": Check(ok=False, detail="X did not answer.")}
    assert any("internal-host" in str(r.exc_info) for r in caplog.records if r.exc_info)


# -- the model check ----------------------------------------------------------


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def litellm_settings(model: str = "openai/gpt-test") -> GenerationSettings:
    """A non-Ollama provider: probed with a 1-token completion."""
    return GenerationSettings(
        provider="litellm",
        model=model,
        temperature=0.0,
        api_base="http://internal-gateway:4000",
    )


def test_the_fake_generator_is_always_reachable() -> None:
    check = ModelReachability().check(make_settings().generation)
    assert check == Check(ok=True, detail="fake generator (offline)", stand_in=True)


def test_the_model_check_is_the_gateway_probe(stub_litellm: StubLiteLLM) -> None:
    assert ModelReachability().check(litellm_settings()) == Check(
        ok=True, detail="the model answered"
    )
    assert stub_litellm.calls[0]["max_tokens"] == 1


def test_an_ollama_model_is_checked_by_its_listing() -> None:
    def tags(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"models": [{"name": "qwen3.6:latest"}]})

    reachability = ModelReachability(transport=httpx.MockTransport(tags))
    settings = dataclasses.replace(litellm_settings("ollama/qwen3.6:latest"), api_base=None)
    assert reachability.check(settings) == Check(ok=True, detail="available")


def test_the_model_check_is_cached_for_thirty_seconds(stub_litellm: StubLiteLLM) -> None:
    clock = FakeClock()
    reachability = ModelReachability(clock=clock)
    settings = litellm_settings()
    reachability.check(settings)
    clock.now += MODEL_CACHE_TTL_S - 0.001
    reachability.check(settings)
    assert len(stub_litellm.calls) == 1
    clock.now += 0.001
    reachability.check(settings)
    assert len(stub_litellm.calls) == 2
    assert MODEL_CACHE_TTL_S == 30.0


def test_the_cache_is_per_configuration(stub_litellm: StubLiteLLM) -> None:
    reachability = ModelReachability(clock=FakeClock())
    reachability.check(litellm_settings())
    reachability.check(litellm_settings("openai/gpt-other"))
    assert len(stub_litellm.calls) == 2


# -- the index check ----------------------------------------------------------


def persistent_settings(dataset_dir: Path) -> RetrievalSettings:
    base = make_settings(dataset_dir=str(dataset_dir))
    return dataclasses.replace(
        base, embedding=dataclasses.replace(base.embedding, provider="ollama")
    )


def populated_store() -> InMemoryVectorStore:
    store = InMemoryVectorStore()
    store.upsert(
        ids=["CHNK_A", "CHNK_B"],
        dense=[[1.0, 0.0], [0.0, 1.0]],
        sparse=[SparseVector((1,), (1.0,)), SparseVector((2,), (1.0,))],
        payloads=[{"kind": "chunk"}, {"kind": "chunk"}],
    )
    return store


def write_manifest(dataset_dir: Path, version: str) -> None:
    (dataset_dir / MANIFEST_NAME).write_text(json.dumps({"record_serialiser_version": version}))


def test_a_populated_index_of_this_serialiser_is_ready(tmp_path: Path) -> None:
    write_manifest(tmp_path, RECORD_SERIALISER_VERSION)
    check = index_check(persistent_settings(tmp_path), populated_store())
    assert check == Check(ok=True, detail="2 points")


def test_an_empty_index_is_not_ready(tmp_path: Path) -> None:
    write_manifest(tmp_path, RECORD_SERIALISER_VERSION)
    check = index_check(persistent_settings(tmp_path), InMemoryVectorStore())
    assert check == Check(ok=False, detail="the collection holds no points")


@pytest.mark.parametrize("version", [None, "0.0.1"])
def test_an_index_of_another_serialiser_is_not_ready(tmp_path: Path, version: str | None) -> None:
    if version is not None:
        write_manifest(tmp_path, version)
    check = index_check(persistent_settings(tmp_path), populated_store())
    assert check == Check(
        ok=False, detail="the index was built by another record serialiser; rebuild it"
    )


def test_an_in_memory_index_is_built_with_the_lab() -> None:
    check = index_check(make_settings(), None)
    assert check == Check(ok=False, detail="not built: the in-memory index is built with the lab")
    assert index_check(make_settings(), populated_store()) == Check(ok=True, detail="2 points")


def test_the_embedding_check_is_the_model_reachability_check(
    indexed_lab: Lab, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Readiness reports the embedding model through ModelReachability, so
    a down embedding server makes the API not ready."""
    asked: list[EmbeddingSettings] = []

    def check_embedding(self: ModelReachability, settings: EmbeddingSettings) -> Check:
        asked.append(settings)
        return Check(ok=False, detail="not pulled")

    monkeypatch.setattr(ModelReachability, "check_embedding", check_embedding)
    monkeypatch.setattr(readiness_module, "GraphReader", _AnsweringReader)
    with TestClient(create_app(lab_factory=lambda: indexed_lab, graph_config=GRAPH_DOWN)) as client:
        run_to_completion(client, configurations=["A"])
        response = client.get("/api/v1/health/ready")
    assert response.status_code == 503
    assert response.json()["checks"]["embedding"] == {
        "ok": False,
        "detail": "not pulled",
        "stand_in": False,
    }
    assert asked == [indexed_lab.settings.embedding]


def test_each_check_has_its_own_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[dict[str, Probe]] = []

    def record(probes: dict[str, Probe]) -> dict[str, Check]:
        calls.append(probes)
        return {name: Check(ok=True, detail="recorded") for name in probes}

    def unbuildable() -> Lab:
        raise RuntimeError("no lab in this test")

    monkeypatch.setenv("GENERATION_TIMEOUT_S", "120")
    monkeypatch.setenv("GENERATION_PROVIDER", "litellm")
    monkeypatch.setattr(readiness_module, "run_checks", record)
    with TestClient(create_app(lab_factory=unbuildable, graph_config=GRAPH_DOWN)) as client:
        monkeypatch.setenv("GENERATION_MODEL", "ollama/qwen3.6:latest")
        assert client.get("/api/v1/health/ready").status_code == 200
        monkeypatch.setenv("GENERATION_MODEL", "openai/gpt-test")
        client.get("/api/v1/health/ready")
    ollama, other = calls
    assert set(ollama) == CHECKS
    assert ollama["graph"].timeout_s == GRAPH_DOWN.timeout_s
    assert ollama["index"].timeout_s == 5.0
    assert ollama["model"].timeout_s == 5.0
    assert ollama["embedding"].timeout_s == 5.0
    assert other["model"].timeout_s == 30.0


def test_an_invalid_configuration_is_reported_not_raised(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RAG_TOP_K", "many")
    monkeypatch.setattr(readiness_module, "GraphReader", _AnsweringReader)

    def unbuildable() -> Lab:
        raise RuntimeError("no lab in this test")

    with TestClient(create_app(lab_factory=unbuildable, graph_config=GRAPH_DOWN)) as client:
        response = client.get("/api/v1/health/ready")
    checks = response.json()["checks"]
    assert response.status_code == 503
    invalid = {"ok": False, "detail": "the configuration is invalid", "stand_in": False}
    assert checks["index"] == checks["model"] == checks["embedding"] == invalid
    assert checks["graph"]["ok"] is True


def test_concurrent_model_checks_share_one_probe() -> None:
    """The second check reads the clock under the lock while the first probe
    is blocked, so it can only wait for that probe or start its own."""
    entered, release = threading.Event(), threading.Event()
    calls: list[str] = []

    def tags(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        entered.set()
        assert release.wait(DEADLINE_S), "the test never released the probe"
        return httpx.Response(200, json={"models": [{"name": "qwen3.6:latest"}]})

    reads: list[float] = []
    second_inside = threading.Event()

    def clock() -> float:
        reads.append(1000.0)
        if len(reads) == 2:
            second_inside.set()
        return 1000.0

    reachability = ModelReachability(clock=clock, transport=httpx.MockTransport(tags))
    settings = dataclasses.replace(litellm_settings("ollama/qwen3.6:latest"), api_base=None)
    results: list[Check] = []
    first = threading.Thread(target=lambda: results.append(reachability.check(settings)))
    second = threading.Thread(target=lambda: results.append(reachability.check(settings)))
    first.start()
    assert entered.wait(DEADLINE_S)
    second.start()
    assert second_inside.wait(DEADLINE_S)
    release.set()
    first.join(DEADLINE_S)
    second.join(DEADLINE_S)
    assert calls == ["http://localhost:11434/api/tags"]
    assert results == [Check(ok=True, detail="available")] * 2


def test_the_index_check_closes_the_collection_view_it_opens(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    closed: list[bool] = []

    class View(InMemoryVectorStore):
        def __init__(self, url: str, collection: str, dimensions: int) -> None:
            super().__init__()

        def collection_info(self) -> dict[str, Any]:
            raise VectorStoreError("Qdrant collection info failed: http://internal-qdrant refused")

        def close(self) -> None:
            closed.append(True)

    monkeypatch.setattr(readiness_module, "QdrantVectorStore", View)
    with pytest.raises(VectorStoreError):
        index_check(persistent_settings(tmp_path), None)
    assert closed == [True]
