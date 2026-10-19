"""API contract tests (docs/07 section 18) without external services.

The service runs pipeline A against a generated tiny parquet world with the
deterministic hashing embedder, in-memory vector store and fake generator,
so request validation, run lifecycle, replay ordering and error mapping are
exercised end to end offline. Truth-ledger non-exposure is enforced
structurally by tests/test_truth_ledger_isolation.py, which greps the api
package together with retrieval/datasets/graph modules.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path

import pytest
from app.api.runs import QueryService
from app.config import RetrievalSettings
from app.datasets.config import GenerationConfig
from app.datasets.parquet import write_world
from app.datasets.schema import TABLE_SCHEMAS
from app.datasets.world import build_world
from app.graph.config import from_env as from_graph_env
from app.main import create_app
from app.retrieval.standard.generation import GenerationError
from app.retrieval.standard.vector_store import InMemoryVectorStore
from fastapi.testclient import TestClient

from tests.test_standard_rag import make_settings


class FailingGenerator:
    """Gateway stub whose every call fails, like a downed provider."""

    model_name = "failing-gateway-v1"

    def generate(
        self,
        question: str,
        contexts: list[object],
        extra_blocks: list[str] | None = None,
    ) -> tuple[str, float]:
        raise GenerationError("Model gateway call failed: provider unreachable")


@pytest.fixture(scope="module")
def tiny_dataset(tmp_path_factory: pytest.TempPathFactory) -> Path:
    world = build_world(GenerationConfig(profile="tiny", world_seed=42))
    dataset_dir = tmp_path_factory.mktemp("tiny-world-api")
    write_world(dataset_dir, TABLE_SCHEMAS, world.tables)
    return dataset_dir


@pytest.fixture()
def client(tiny_dataset: Path) -> Iterator[TestClient]:
    settings: RetrievalSettings = make_settings(dataset_dir=str(tiny_dataset))
    service = QueryService(settings=settings, graph_config=from_graph_env(), generator_name="fake")
    app = create_app(service_factory=lambda: service)
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture()
def failing_client(tiny_dataset: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    import app.api.runs as runs_module

    settings: RetrievalSettings = make_settings(dataset_dir=str(tiny_dataset))
    monkeypatch.setattr(runs_module, "build_generator", lambda _name, _settings: FailingGenerator())
    service = QueryService(settings=settings, graph_config=from_graph_env(), generator_name="fake")
    app = create_app(service_factory=lambda: service)
    with TestClient(app) as test_client:
        yield test_client


def _await_completion(client: TestClient, run_id: str, attempts: int = 200) -> dict:
    import time

    for _ in range(attempts):
        payload = client.get(f"/api/v1/queries/{run_id}").json()
        if payload["status"] != "running":
            return payload
        time.sleep(0.05)
    pytest.fail("run did not finish")


class TestRequestValidation:
    def test_empty_question_rejected(self, client: TestClient) -> None:
        response = client.post("/api/v1/queries", json={"question": ""})
        assert response.status_code == 422

    def test_unknown_configuration_rejected(self, client: TestClient) -> None:
        response = client.post(
            "/api/v1/queries", json={"question": "What happened?", "configurations": ["D"]}
        )
        assert response.status_code == 422

    def test_unknown_profile_rejected(self, client: TestClient) -> None:
        response = client.post(
            "/api/v1/queries", json={"question": "What happened?", "profile": "chaos"}
        )
        assert response.status_code == 422

    def test_unknown_market_rejected(self, client: TestClient) -> None:
        response = client.post(
            "/api/v1/queries", json={"question": "What happened?", "market_scope": ["XX"]}
        )
        assert response.status_code == 422

    def test_markets_normalised_to_full_ids(self, client: TestClient) -> None:
        run_id = client.post(
            "/api/v1/queries",
            json={
                "question": "Anything.",
                "configurations": ["A"],
                "market_scope": ["uk", "MKT_GR"],
            },
        ).json()["run_id"]
        payload = _await_completion(client, run_id)
        assert payload["market_scope"] == ["MKT_UK", "MKT_GR"]

    def test_scoped_run_filters_pipeline_a_evidence(self, client: TestClient) -> None:
        run_id = client.post(
            "/api/v1/queries",
            json={
                "question": "What do the game rules say about prize tiers?",
                "configurations": ["A"],
                "market_scope": ["MKT_GR"],
            },
        ).json()["run_id"]
        payload = _await_completion(client, run_id)
        assert payload["status"] == "completed"
        evidence = payload["results"]["A"]["evidence"]
        assert all(chunk["market_id"] == "MKT_GR" for chunk in evidence)


class TestQueryLifecycle:
    def test_submission_returns_run_pointer_immediately(self, client: TestClient) -> None:
        response = client.post(
            "/api/v1/queries", json={"question": "Which game costs 3.50?", "configurations": ["A"]}
        )
        assert response.status_code == 202
        payload = response.json()
        assert payload["status"] == "running"
        assert payload["events_url"].startswith("/api/v1/queries/")
        assert payload["results_url"] == payload["events_url"].removesuffix("/events")

    def test_pipeline_a_completes_with_answer_and_evidence(self, client: TestClient) -> None:
        run_id = client.post(
            "/api/v1/queries",
            json={
                "question": "What do the game rules say about prize tiers?",
                "configurations": ["A"],
            },
        ).json()["run_id"]
        payload = _await_completion(client, run_id)
        assert payload["status"] == "completed"
        assert payload["error"] is None
        result = payload["results"]["A"]
        assert result["answer"]["text"]
        assert result["evidence"], "pipeline A must retrieve document chunks"

    def test_events_are_sequence_ordered_rag_events(self, client: TestClient) -> None:
        run_id = client.post(
            "/api/v1/queries",
            json={"question": "Tell me about incidents.", "configurations": ["A"]},
        ).json()["run_id"]
        _await_completion(client, run_id)
        stream = client.get(f"/api/v1/queries/{run_id}/events").json()
        sequences = [event["sequence"] for event in stream["events"]]
        assert sequences == list(range(1, len(sequences) + 1))
        assert stream["events"][0]["event_type"] == "rag.query.received"
        assert all(event["event_type"].startswith("rag.") for event in stream["events"])
        # Replay returns the identical recorded stream.
        again = client.get(f"/api/v1/queries/{run_id}/events").json()
        assert again == stream

    def test_unknown_run_returns_404(self, client: TestClient) -> None:
        assert client.get("/api/v1/queries/RUN-UNKNOWN").status_code == 404
        assert client.get("/api/v1/queries/RUN-UNKNOWN/events").status_code == 404


class TestErrorMapping:
    def test_gateway_failure_maps_to_model_error(self, failing_client: TestClient) -> None:
        run_id = failing_client.post(
            "/api/v1/queries",
            json={"question": "Anything at all.", "configurations": ["A"]},
        ).json()["run_id"]
        payload = _await_completion(failing_client, run_id)
        assert payload["status"] == "failed"
        assert payload["error"] is not None
        assert payload["error"]["error_code"] == "MODEL_ERROR"
        assert "provider unreachable" in payload["error"]["message"]
        stream = failing_client.get(f"/api/v1/queries/{run_id}/events").json()
        error_events = [event for event in stream["events"] if event["event_type"] == "run.error"]
        assert len(error_events) == 1
        assert error_events[0]["payload"]["error_code"] == "MODEL_ERROR"

    def test_dense_only_collection_maps_to_vector_error(
        self, tiny_dataset: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        import app.retrieval.graph.lab as lab_module

        class DenseOnlyStore(InMemoryVectorStore):
            def count(self) -> int:
                return 1

            def collection_info(self) -> dict[str, object]:
                return {"vectors": [""], "sparse_vectors": [], "points": 1}

        monkeypatch.setattr(lab_module, "build_store", lambda *_args: DenseOnlyStore())
        settings: RetrievalSettings = make_settings(dataset_dir=str(tiny_dataset))
        service = QueryService(
            settings=settings, graph_config=from_graph_env(), generator_name="fake"
        )
        with TestClient(create_app(service_factory=lambda: service)) as client:
            run_id = client.post(
                "/api/v1/queries",
                json={"question": "Anything at all.", "configurations": ["A"]},
            ).json()["run_id"]
            payload = _await_completion(client, run_id)
        assert payload["status"] == "failed"
        assert payload["error"]["error_code"] == "VECTOR_RETRIEVAL_ERROR"
        assert "lacks a sparse vector" in payload["error"]["message"]


class TestDemoAndBenchmarks:
    def test_cors_allows_the_dev_frontend(self, client: TestClient) -> None:
        response = client.get("/api/v1/health", headers={"Origin": "http://localhost:5173"})
        assert response.headers["access-control-allow-origin"] == "http://localhost:5173"

    def test_cors_rejects_other_origins(self, client: TestClient) -> None:
        response = client.get("/api/v1/health", headers={"Origin": "http://evil.example"})
        assert "access-control-allow-origin" not in response.headers

    def test_demo_questions_are_the_fixed_configuration(self, client: TestClient) -> None:
        payload = client.get("/api/v1/demo/questions").json()
        assert [question["id"] for question in payload] == [
            "DEMO-01",
            "DEMO-02",
            "DEMO-03",
            "DEMO-04",
        ]
        assert all(question["question"] for question in payload)

    def test_benchmarks_latest_404_without_runs(
        self, tiny_dataset: Path, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        monkeypatch.setenv("BENCHMARK_DIR", str(tmp_path))
        app = create_app(
            service_factory=lambda: QueryService(
                settings=make_settings(dataset_dir=str(tiny_dataset)),
                graph_config=from_graph_env(),
            )
        )
        with TestClient(app) as client:
            assert client.get("/api/v1/benchmarks/latest").status_code == 404

    def test_benchmarks_latest_serves_published_results(
        self, tiny_dataset: Path, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        run_dir = tmp_path / "run-001"
        run_dir.mkdir(parents=True)
        (run_dir / "results.json").write_text(
            json.dumps(
                {
                    "reproducibility": {"question_bank_version": "1.0.0"},
                    "results": [
                        {
                            "question_id": "Q01",
                            "scores": {
                                "A": {"answer_score": 0.0, "failure_class": None},
                                "C": {"answer_score": 1.0, "failure_class": None},
                            },
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )
        (run_dir / "summary.json").write_text(
            json.dumps({"total": 30, "scored": 22, "pipelines": {}}), encoding="utf-8"
        )
        monkeypatch.setenv("BENCHMARK_DIR", str(tmp_path))
        app = create_app(
            service_factory=lambda: QueryService(
                settings=make_settings(dataset_dir=str(tiny_dataset)),
                graph_config=from_graph_env(),
            )
        )
        with TestClient(app) as client:
            payload = client.get("/api/v1/benchmarks/latest").json()
        assert payload["run_id"] == "run-001"
        assert payload["reproducibility"]["question_bank_version"] == "1.0.0"
        assert payload["questions"][0]["question_id"] == "Q01"
        assert payload["questions"][0]["scores"]["C"]["answer_score"] == 1.0
        assert payload["summary"] is not None
        assert payload["summary"]["scored"] == 22
