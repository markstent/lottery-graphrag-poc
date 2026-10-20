"""Reference routes: ontology tree and members, scenario catalogue with the
active dataset's planted rows, configured models (Phase 4 Task 11)."""

from __future__ import annotations

import json
import threading
from collections.abc import Iterator
from pathlib import Path
from typing import Any, cast

import httpx
import pytest
from app.api.readiness import MODEL_CACHE_TTL_S, ModelReachability
from app.api.schemas import Check
from app.config import EmbeddingSettings, GraphConfig
from app.datasets.config import GenerationConfig
from app.datasets.world import build_world
from app.main import create_app
from app.scenarios.catalogue import ENABLED
from app.scenarios.engine import apply_scenarios
from fastapi.testclient import TestClient

from tests.test_health import FakeClock, litellm_settings

UNREACHABLE_GRAPH = GraphConfig(
    uri="bolt://127.0.0.1:9", user="neo4j", password="unused", database="neo4j", timeout_s=1.0
)
NATIONAL_DRAW = "CONCEPT_NATIONAL_DRAW"


@pytest.fixture(scope="module")
def dataset_root(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """planted (every enabled scenario applied), partial (SCN-001 only), bare (no manifest)."""
    root = tmp_path_factory.mktemp("reference-datasets")
    world = build_world(GenerationConfig(profile="tiny", world_seed=42))
    apply_scenarios(world)
    (root / "planted").mkdir()
    (root / "planted" / "_manifest.json").write_text(json.dumps(world.manifest))
    applied = world.manifest["scenarios"]["applied"]
    partial = {**world.manifest, "scenarios": {"applied": applied[:1]}}
    (root / "partial").mkdir()
    (root / "partial" / "_manifest.json").write_text(json.dumps(partial))
    (root / "bare").mkdir()
    return root


def _client(root: Path, name: str, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("DATASET_DIR", str(root / name))
    with TestClient(create_app(graph_config=UNREACHABLE_GRAPH)) as client:
        yield client


@pytest.fixture()
def client(dataset_root: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    yield from _client(dataset_root, "planted", monkeypatch)


@pytest.fixture()
def partial_client(dataset_root: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    yield from _client(dataset_root, "partial", monkeypatch)


@pytest.fixture()
def bare_client(dataset_root: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    yield from _client(dataset_root, "bare", monkeypatch)


# -- ontology -----------------------------------------------------------------


def _concepts(client: TestClient) -> dict[str, dict[str, Any]]:
    body = client.get("/api/v1/ontology").json()
    assert body["version"] == "2.0.0"
    return {c["concept_id"]: c for c in body["concepts"]}


def test_concepts_carry_four_language_labels(client: TestClient) -> None:
    concept = _concepts(client)[NATIONAL_DRAW]
    assert set(concept["labels"]) >= {"en", "el", "de", "cs"}
    assert concept["parent_id"] == "CONCEPT_DRAW_GAME"
    assert concept["synonyms"]["el"]
    assert concept["relationships"] == ["IS_A", "MAPS_TO"]
    counts = concept["binding_counts"]
    assert sum(counts.values()) > 0
    assert set(counts) <= {"MKT_UK", "MKT_GR", "MKT_AT", "MKT_CZ", "shared"}


def test_a_concept_without_bindings_has_empty_counts(client: TestClient) -> None:
    root = _concepts(client)["CONCEPT_LOTTERY_PRODUCT"]
    assert root["binding_counts"] == {}
    assert root["parent_id"] is None
    assert root["relationships"] == ["IS_A"]


def test_members_are_the_bound_local_codes_with_their_names(client: TestClient) -> None:
    members = client.get(f"/api/v1/ontology/concepts/{NATIONAL_DRAW}/members").json()
    assert members
    assert {m["market_id"] for m in members} <= {"MKT_UK", "MKT_GR", "MKT_AT", "MKT_CZ", None}
    assert all(set(m) == {"kind", "code", "market_id", "name"} for m in members)
    assert any(m["name"] for m in members)


def test_members_filter_by_market(client: TestClient) -> None:
    members = client.get(
        f"/api/v1/ontology/concepts/{NATIONAL_DRAW}/members", params={"market": "MKT_GR"}
    ).json()
    assert members
    assert {m["market_id"] for m in members} == {"MKT_GR"}


def test_members_of_an_unknown_concept_are_404(client: TestClient) -> None:
    response = client.get("/api/v1/ontology/concepts/CONCEPT_NOPE/members")
    assert response.status_code == 404


def test_members_with_an_unknown_market_are_422(client: TestClient) -> None:
    response = client.get(
        f"/api/v1/ontology/concepts/{NATIONAL_DRAW}/members", params={"market": "MKT_XX"}
    )
    assert response.status_code == 422


# -- scenarios ----------------------------------------------------------------


def test_scenarios_report_planted_rows_and_no_truth(client: TestClient) -> None:
    scenarios = client.get("/api/v1/scenarios").json()
    assert [s["scenario_id"] for s in scenarios] == list(ENABLED)
    assert len(scenarios) == 8 and all(s["planted"] for s in scenarios)
    assert all(s["planted_rows"] and s["strength"] is not None for s in scenarios)
    assert all(s["title"] and s["noise_level"] for s in scenarios)
    assert not any(
        key in json.dumps(scenarios) for key in ("required_evidence", "expected_signals", "truth")
    )


def test_a_scenario_the_dataset_did_not_apply_is_not_planted(partial_client: TestClient) -> None:
    scenarios = partial_client.get("/api/v1/scenarios").json()
    assert [s["planted"] for s in scenarios] == [True] + [False] * 7
    unplanted = scenarios[1]
    assert unplanted["planted_rows"] == {}
    assert unplanted["strength"] is None and unplanted["noise_level"] is None


def test_a_dataset_without_a_manifest_plants_nothing(bare_client: TestClient) -> None:
    scenarios = bare_client.get("/api/v1/scenarios").json()
    assert len(scenarios) == 8 and not any(s["planted"] for s in scenarios)


# -- models -------------------------------------------------------------------


def test_models_name_the_configured_providers(client: TestClient) -> None:
    body = client.get("/api/v1/models").json()
    assert body["generation"]["provider"] == "fake" and body["generation"]["reachable"] is True
    assert set(body) == {"embedding", "sparse", "rerank", "generation"}
    assert all(set(m) == {"provider", "model", "reachable", "detail"} for m in body.values())


def test_in_process_models_are_unknown_until_the_lab_loads_them(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    service = cast(Any, client.app).state.query_service
    monkeypatch.setattr(service, "lab_status", lambda: (None, "not started"))
    body = client.get("/api/v1/models").json()
    for name in ("sparse", "rerank"):
        assert body[name]["reachable"] is None and body[name]["detail"] == "runs in process"


def test_loaded_in_process_models_are_reachable(client: TestClient) -> None:
    service = cast(Any, client.app).state.query_service
    service.warm_up()
    for _ in range(200):
        lab, _state = service.lab_status()
        if lab is not None:
            break
        threading.Event().wait(0.05)
    assert lab is not None
    body = client.get("/api/v1/models").json()
    assert body["sparse"]["reachable"] is True and body["rerank"]["reachable"] is True


# -- reachability -------------------------------------------------------------


def _embedding(provider: str = "ollama") -> EmbeddingSettings:
    return EmbeddingSettings(
        provider=provider, model="bge-m3", dimensions=1024, host="http://localhost:11434"
    )


def test_an_ollama_embedding_model_is_checked_by_its_listing() -> None:
    calls: list[str] = []

    def tags(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        return httpx.Response(200, json={"models": [{"name": "bge-m3:latest"}]})

    reachability = ModelReachability(transport=httpx.MockTransport(tags))
    assert reachability.check_embedding(_embedding()) == Check(ok=True, detail="available")
    assert reachability.check_embedding(_embedding()).ok
    assert calls == ["http://localhost:11434/api/tags"]


def test_the_hashing_embedder_is_always_reachable() -> None:
    assert ModelReachability().check_embedding(_embedding("hashing")).ok


def test_embedding_and_generation_checks_are_cached_separately() -> None:
    clock = FakeClock()
    calls: list[str] = []

    def tags(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        return httpx.Response(200, json={"models": [{"name": "bge-m3"}, {"name": "qwen3.6"}]})

    reachability = ModelReachability(clock=clock, transport=httpx.MockTransport(tags))
    settings = litellm_settings("ollama/qwen3.6")
    reachability.check_embedding(_embedding())
    reachability.check(settings, "http://localhost:11434")
    reachability.check_embedding(_embedding())
    reachability.check(settings, "http://localhost:11434")
    assert len(calls) == 2
    clock.now += MODEL_CACHE_TTL_S
    reachability.check_embedding(_embedding())
    assert len(calls) == 3


class Interrupt(BaseException):
    """Stands in for KeyboardInterrupt, which pytest would act on."""


def test_an_interrupted_probe_leaves_no_stale_in_flight_entry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    reachability = ModelReachability()
    settings = litellm_settings()
    attempts: list[int] = []

    def probe(*_args: object) -> object:
        attempts.append(1)
        if len(attempts) == 1:
            raise Interrupt
        return type("Reached", (), {"ok": True, "detail": "the model answered"})()

    monkeypatch.setattr("app.models.gateway.probe", probe)
    with pytest.raises(Interrupt):
        reachability.check(settings)
    assert reachability._in_flight == {}
    assert reachability.check(settings) == Check(ok=True, detail="the model answered")
    assert len(attempts) == 2
