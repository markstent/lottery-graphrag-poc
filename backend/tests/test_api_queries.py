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
from typing import Any

import pytest
from app.api import queries
from app.api.runs import QueryService
from app.config import RetrievalSettings
from app.datasets.config import GenerationConfig
from app.datasets.parquet import write_world
from app.datasets.schema import TABLE_SCHEMAS
from app.datasets.world import build_world
from app.graph.config import REPO_ROOT
from app.graph.config import from_env as from_graph_env
from app.main import create_app
from app.retrieval.standard.generation import GenerationError, GenerationOutput
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
    ) -> GenerationOutput:
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
        # The scoped market, plus shared (market-less) evidence.
        assert {chunk["market_id"] for chunk in evidence} <= {"MKT_GR", ""}
        assert any(chunk["market_id"] == "MKT_GR" for chunk in evidence)


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
        assert result["answer"]["verdict"]
        assert result["answer"]["cited_blocks"] == [1]
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

    def test_recorded_events_carry_ids_and_timestamps(self, client: TestClient) -> None:
        run_id = client.post(
            "/api/v1/queries",
            json={"question": "What is the price of GAME_UK_01?", "configurations": ["A"]},
        ).json()["run_id"]
        _await_completion(client, run_id)
        events = client.get(f"/api/v1/queries/{run_id}/events").json()["events"]
        assert events
        assert all(e["event_id"] and e["timestamp"].endswith("+00:00") for e in events)
        assert len({e["event_id"] for e in events}) == len(events)

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
        assert error_events[0]["event_id"] and error_events[0]["timestamp"].endswith("+00:00")

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

    @pytest.mark.parametrize("manifest", [None, {"record_serialiser_version": "2.0.0"}])
    def test_index_built_by_another_serialiser_maps_to_vector_error(
        self,
        tiny_dataset: Path,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
        manifest: dict[str, str] | None,
    ) -> None:
        import shutil

        import app.retrieval.graph.lab as lab_module

        class PopulatedStore(InMemoryVectorStore):
            def count(self) -> int:
                return 1

        dataset_dir = tmp_path / "world"
        shutil.copytree(tiny_dataset, dataset_dir)
        (dataset_dir / "vector-index.json").unlink(missing_ok=True)
        if manifest is not None:
            (dataset_dir / "vector-index.json").write_text(json.dumps(manifest))
        monkeypatch.setattr(lab_module, "build_store", lambda *_args: PopulatedStore())
        settings: RetrievalSettings = make_settings(dataset_dir=str(dataset_dir))
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
        assert "record serialiser" in payload["error"]["message"]

    @staticmethod
    def _cold_start(settings: RetrievalSettings) -> None:
        service = QueryService(
            settings=settings, graph_config=from_graph_env(), generator_name="fake"
        )
        with TestClient(create_app(service_factory=lambda: service)) as client:
            run_id = client.post(
                "/api/v1/queries",
                json={"question": "Anything at all.", "configurations": ["A"]},
            ).json()["run_id"]
            assert _await_completion(client, run_id)["status"] == "completed"

    def test_in_memory_cold_start_never_writes_a_manifest(
        self, tiny_dataset: Path, tmp_path: Path
    ) -> None:
        """An in-memory index dies with the process: it must not overwrite the
        manifest of the persistent index built for the same world."""
        import shutil

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
        import dataclasses
        import shutil

        import app.retrieval.graph.lab as lab_module
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

    @staticmethod
    def _publish(
        root: Path,
        name: str,
        kind: str,
        started_at: str,
        schema: str = "2",
        selection: dict[str, Any] | None = None,
    ) -> None:
        run_dir = root / name
        run_dir.mkdir(parents=True)
        summary = {
            "schema_version": schema,
            "run_kind": kind,
            "label": "scorer smoke test" if kind == "smoke" else None,
            "headlines": [f"{name} headline"],
            "selection": selection or {"strata": None, "limit": None},
            "reproducibility": {"run": {"started_at": started_at}, "worlds": []},
        }
        if selection is not None:
            summary["label"] = "subset run"
        (run_dir / "summary.json").write_text(json.dumps(summary), encoding="utf-8")

    def _latest(
        self, tiny_dataset: Path, monkeypatch: pytest.MonkeyPatch, root: Path
    ) -> tuple[int, Any]:
        monkeypatch.setenv("BENCHMARK_DIR", str(root))
        app = create_app(
            service_factory=lambda: QueryService(
                settings=make_settings(dataset_dir=str(tiny_dataset)),
                graph_config=from_graph_env(),
            )
        )
        with TestClient(app, raise_server_exceptions=False) as client:
            response = client.get("/api/v1/benchmarks/latest")
        return response.status_code, response.json() if response.status_code != 500 else None

    def test_unset_benchmark_dir_reads_the_repository_runs(
        self, tiny_dataset: Path, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        # The default must not depend on the server's working directory.
        assert queries.DEFAULT_BENCHMARK_DIR == REPO_ROOT / "data" / "evaluation" / "runs"
        self._publish(tmp_path, "run", "smoke", "2026-10-01T09:00:00+00:00")
        monkeypatch.setattr(queries, "DEFAULT_BENCHMARK_DIR", tmp_path)
        monkeypatch.delenv("BENCHMARK_DIR", raising=False)
        app = create_app(
            service_factory=lambda: QueryService(
                settings=make_settings(dataset_dir=str(tiny_dataset)),
                graph_config=from_graph_env(),
            )
        )
        with TestClient(app) as client:
            assert client.get("/api/v1/benchmarks/latest").json()["run_id"] == "run"

    def test_a_subset_official_run_is_not_the_official_latest(
        self, tiny_dataset: Path, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        subset = {"strata": ["H1"], "limit": 2}
        self._publish(tmp_path, "full", "official", "2026-10-01T09:00:00+00:00")
        self._publish(tmp_path, "pilot", "official", "2026-10-02T09:00:00+00:00", selection=subset)
        status, body = self._latest(tiny_dataset, monkeypatch, tmp_path)
        assert (status, body["run_id"]) == (200, "full")

    def test_a_subset_official_run_falls_back_like_other_runs(
        self, tiny_dataset: Path, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        limited = {"strata": None, "limit": 2}
        self._publish(tmp_path, "smoke", "smoke", "2026-10-01T09:00:00+00:00")
        self._publish(tmp_path, "pilot", "official", "2026-10-02T09:00:00+00:00", selection=limited)
        status, body = self._latest(tiny_dataset, monkeypatch, tmp_path)
        assert (status, body["run_id"], body["label"]) == (200, "pilot", "subset run")

    def test_latest_benchmark_prefers_official_runs(
        self, tiny_dataset: Path, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        self._publish(tmp_path, "official-old", "official", "2026-10-01T09:00:00+00:00")
        self._publish(tmp_path, "official-new", "official", "2026-10-02T09:00:00+00:00")
        self._publish(tmp_path, "smoke-newest", "smoke", "2026-10-03T09:00:00+00:00")
        status, body = self._latest(tiny_dataset, monkeypatch, tmp_path)
        assert status == 200
        assert body["run_kind"] == "official"
        assert body["run_id"] == "official-new"
        assert body["label"] is None
        assert body["summary"]["headlines"] == ["official-new headline"]

    def test_latest_benchmark_falls_back_to_the_newest_labelled_run(
        self, tiny_dataset: Path, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        self._publish(tmp_path, "b-smoke", "smoke", "2026-10-02T09:00:00+00:00")
        self._publish(tmp_path, "a-sweep", "sweep", "2026-10-01T09:00:00+00:00")
        status, body = self._latest(tiny_dataset, monkeypatch, tmp_path)
        assert status == 200
        assert (body["run_id"], body["run_kind"]) == ("b-smoke", "smoke")
        assert body["label"] == "scorer smoke test"

    def test_latest_benchmark_orders_by_time_not_text(
        self, tiny_dataset: Path, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        # 10:00 in UTC+02:00 is 08:00 UTC, earlier than 09:00 UTC, though it sorts later as text.
        self._publish(tmp_path, "later", "official", "2026-10-02T09:00:00+00:00")
        self._publish(tmp_path, "earlier", "official", "2026-10-02T10:00:00+02:00")
        status, body = self._latest(tiny_dataset, monkeypatch, tmp_path)
        assert (status, body["run_id"]) == (200, "later")

    def test_a_malformed_summary_fails_loudly(
        self, tiny_dataset: Path, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        self._publish(tmp_path, "good", "official", "2026-10-02T09:00:00+00:00")
        (tmp_path / "broken").mkdir()
        (tmp_path / "broken" / "summary.json").write_text("{not json", encoding="utf-8")
        status, _ = self._latest(tiny_dataset, monkeypatch, tmp_path)
        assert status == 500

    def test_latest_benchmark_ignores_summaries_of_another_schema(
        self, tiny_dataset: Path, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        self._publish(tmp_path, "run-v1", "official", "2026-10-09T09:00:00+00:00", schema="1")
        status, _ = self._latest(tiny_dataset, monkeypatch, tmp_path)
        assert status == 404
