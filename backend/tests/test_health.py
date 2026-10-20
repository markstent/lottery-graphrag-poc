"""Liveness and readiness (spec 6.1): ``/health`` says the process is up;
``/health/ready`` reports the lab, the index, Neo4j and the model provider
separately, never raises, never builds the lab and never leaks service text."""

from __future__ import annotations

import dataclasses
import json
import logging
import threading
from collections.abc import Iterator
from pathlib import Path

import app.api.readiness as readiness_module
import pytest
from app.api.readiness import (
    MODEL_CACHE_TTL_S,
    ModelReachability,
    Probe,
    index_check,
    run_checks,
)
from app.api.schemas import Check
from app.config import GenerationSettings, GraphConfig, RetrievalSettings
from app.lab import Lab
from app.main import app, create_app
from app.retrieval.standard.index import MANIFEST_NAME, index_corpus
from app.retrieval.standard.records import RECORD_SERIALISER_VERSION
from app.retrieval.standard.sparse import SparseVector
from app.retrieval.standard.vector_store import InMemoryVectorStore
from fastapi.testclient import TestClient

from tests.conftest import StubLiteLLM, build_lab_offline
from tests.test_api_runs import DEADLINE_S, run_to_completion, start, wait_idle
from tests.test_graph_rag import build_corpus
from tests.test_standard_rag import make_settings

# Nothing listens on port 1: the driver is refused at once.
GRAPH_DOWN = GraphConfig(
    uri="bolt://127.0.0.1:1", user="neo4j", password="unused", database="neo4j", timeout_s=2.0
)
CHECKS = {"lab", "index", "graph", "model"}


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
    """The offline lab, already built by one completed run; Neo4j unreachable."""
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
    assert body["checks"]["graph"] == {"ok": False, "detail": "Neo4j did not answer."}
    assert body["checks"]["lab"] == {"ok": True, "detail": "built"}
    assert body["checks"]["index"]["ok"] is True
    assert body["checks"]["model"] == {"ok": True, "detail": "fake generator (offline)"}
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


def test_readiness_never_builds_the_lab(monkeypatch: pytest.MonkeyPatch) -> None:
    builds: list[int] = []

    def factory() -> Lab:
        builds.append(1)
        raise AssertionError("readiness must not build the lab")

    monkeypatch.setattr(readiness_module, "GraphReader", _AnsweringReader)
    with TestClient(create_app(lab_factory=factory, graph_config=GRAPH_DOWN)) as client:
        response = client.get("/api/v1/health/ready")
    assert response.status_code == 503
    assert response.json()["checks"]["lab"] == {"ok": False, "detail": "not started"}
    assert builds == []


def test_readiness_reports_a_lab_build_in_progress_without_waiting_for_it(
    indexed_lab: Lab,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    building, release = threading.Event(), threading.Event()

    def slow_factory() -> Lab:
        building.set()
        assert release.wait(DEADLINE_S), "the test never released the lab build"
        return indexed_lab

    monkeypatch.setattr(readiness_module, "GraphReader", _AnsweringReader)
    with TestClient(create_app(lab_factory=slow_factory, graph_config=GRAPH_DOWN)) as client:
        start(client, configurations=["A"])
        assert building.wait(DEADLINE_S)
        try:
            lab_check = client.get("/api/v1/health/ready").json()["checks"]["lab"]
        finally:
            release.set()
        wait_idle(client)
    assert lab_check == {"ok": False, "detail": "building"}


def test_readiness_reports_a_failed_lab_build(monkeypatch: pytest.MonkeyPatch) -> None:
    def failing_factory() -> Lab:
        raise RuntimeError("Qdrant at http://internal-qdrant:6333 refused")

    monkeypatch.setattr(readiness_module, "GraphReader", _AnsweringReader)
    with TestClient(create_app(lab_factory=failing_factory, graph_config=GRAPH_DOWN)) as client:
        run_to_completion(client, configurations=["A"])
        body = client.get("/api/v1/health/ready").json()
    assert body["checks"]["lab"] == {
        "ok": False,
        "detail": "the last build failed; the next run retries it",
    }
    assert "internal-qdrant" not in json.dumps(body)


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


def litellm_settings(timeout_s: float = 120.0) -> GenerationSettings:
    return GenerationSettings(
        provider="litellm",
        model="ollama/qwen3.6:latest",
        temperature=0.0,
        api_base="http://internal-gateway:11434",
        timeout_s=timeout_s,
    )


def test_the_fake_generator_is_always_reachable() -> None:
    check = ModelReachability().check(make_settings().generation)
    assert check == Check(ok=True, detail="fake generator (offline)")


def test_the_model_check_is_one_cheap_gateway_call(stub_litellm: StubLiteLLM) -> None:
    check = ModelReachability().check(litellm_settings(timeout_s=120.0))
    assert check == Check(ok=True, detail="the model answered")
    (call,) = stub_litellm.calls
    assert call["max_tokens"] == 1 and call["timeout"] == 5.0
    assert call["model"] == "ollama/qwen3.6:latest"
    assert call["base_url"] == "http://internal-gateway:11434"


def test_the_model_check_never_waits_longer_than_the_generation_timeout(
    stub_litellm: StubLiteLLM,
) -> None:
    ModelReachability().check(litellm_settings(timeout_s=2.0))
    assert stub_litellm.calls[0]["timeout"] == 2.0


def test_an_empty_one_token_answer_still_proves_the_provider_answered(
    stub_litellm_empty: StubLiteLLM,
) -> None:
    """A thinking model can spend its single token on hidden reasoning."""
    assert ModelReachability().check(litellm_settings()).ok is True


def test_an_unreachable_provider_is_curated(
    stub_litellm_raises: StubLiteLLM, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.WARNING):
        check = ModelReachability().check(litellm_settings())
    assert check == Check(ok=False, detail="The model provider did not answer.")
    assert any("provider down" in str(r.exc_info) for r in caplog.records if r.exc_info)


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
    reachability.check(dataclasses.replace(litellm_settings(), model="ollama/gemma4:31b"))
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


def test_each_check_has_its_own_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[dict[str, Probe]] = []

    def record(probes: dict[str, Probe]) -> dict[str, Check]:
        calls.append(probes)
        return {name: Check(ok=True, detail="recorded") for name in probes}

    def never_built() -> Lab:
        raise AssertionError("readiness must not build the lab")

    monkeypatch.setenv("GENERATION_TIMEOUT_S", "120")
    monkeypatch.setattr(readiness_module, "run_checks", record)
    with TestClient(create_app(lab_factory=never_built, graph_config=GRAPH_DOWN)) as client:
        assert client.get("/api/v1/health/ready").status_code == 200
    (probes,) = calls
    assert set(probes) == CHECKS
    assert probes["graph"].timeout_s == GRAPH_DOWN.timeout_s
    assert probes["index"].timeout_s == 5.0
    assert probes["model"].timeout_s == 5.0


def test_an_invalid_configuration_is_reported_not_raised(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RAG_TOP_K", "many")
    monkeypatch.setattr(readiness_module, "GraphReader", _AnsweringReader)

    def never_built() -> Lab:
        raise AssertionError("readiness must not build the lab")

    with TestClient(create_app(lab_factory=never_built, graph_config=GRAPH_DOWN)) as client:
        response = client.get("/api/v1/health/ready")
    checks = response.json()["checks"]
    assert response.status_code == 503
    invalid = {"ok": False, "detail": "the configuration is invalid"}
    assert checks["index"] == checks["model"] == invalid
    assert checks["graph"]["ok"] is True
