"""API contract tests for CORS, the demo configuration and the published
benchmark summary (docs/07 section 18), without external services.

The run routes are tested in tests/test_api_runs.py. Truth-ledger
non-exposure is enforced structurally by tests/test_truth_ledger_isolation.py,
which greps the api package together with retrieval/datasets/graph modules.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from app import config as app_config
from app.api import queries
from app.evaluation import report
from app.main import create_app
from fastapi.testclient import TestClient


@pytest.fixture()
def client() -> Iterator[TestClient]:
    with TestClient(create_app()) as test_client:
        yield test_client


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
        assert all("profile" not in question for question in payload)

    def test_benchmarks_latest_404_without_runs(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        monkeypatch.setenv("BENCHMARK_DIR", str(tmp_path))
        app = create_app()
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

    def _latest(self, monkeypatch: pytest.MonkeyPatch, root: Path) -> tuple[int, Any]:
        monkeypatch.setenv("BENCHMARK_DIR", str(root))
        app = create_app()
        with TestClient(app, raise_server_exceptions=False) as client:
            response = client.get("/api/v1/benchmarks/latest")
        return response.status_code, response.json() if response.status_code != 500 else None

    def test_unset_benchmark_dir_reads_the_repository_runs(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        # The default is anchored at the repository root, not the server's
        # working directory: re-anchor the root and the API follows it.
        self._publish(
            tmp_path / "data" / "evaluation" / "runs", "run", "smoke", "2026-10-01T09:00:00+00:00"
        )
        monkeypatch.setattr(app_config, "REPO_ROOT", tmp_path)
        monkeypatch.delenv("BENCHMARK_DIR", raising=False)
        app = create_app()
        with TestClient(app) as client:
            assert client.get("/api/v1/benchmarks/latest").json()["run_id"] == "run"

    def test_a_subset_official_run_is_not_the_official_latest(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        subset = {"strata": ["H1"], "limit": 2}
        self._publish(tmp_path, "full", "official", "2026-10-01T09:00:00+00:00")
        self._publish(tmp_path, "pilot", "official", "2026-10-02T09:00:00+00:00", selection=subset)
        status, body = self._latest(monkeypatch, tmp_path)
        assert (status, body["run_id"]) == (200, "full")

    def test_a_subset_official_run_falls_back_like_other_runs(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        limited = {"strata": None, "limit": 2}
        self._publish(tmp_path, "smoke", "smoke", "2026-10-01T09:00:00+00:00")
        self._publish(tmp_path, "pilot", "official", "2026-10-02T09:00:00+00:00", selection=limited)
        status, body = self._latest(monkeypatch, tmp_path)
        assert (status, body["run_id"], body["label"]) == (200, "pilot", "subset run")

    def test_latest_benchmark_prefers_official_runs(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        self._publish(tmp_path, "official-old", "official", "2026-10-01T09:00:00+00:00")
        self._publish(tmp_path, "official-new", "official", "2026-10-02T09:00:00+00:00")
        self._publish(tmp_path, "smoke-newest", "smoke", "2026-10-03T09:00:00+00:00")
        status, body = self._latest(monkeypatch, tmp_path)
        assert status == 200
        assert body["run_kind"] == "official"
        assert body["run_id"] == "official-new"
        assert body["label"] is None
        assert body["summary"]["headlines"] == ["official-new headline"]

    def test_latest_benchmark_falls_back_to_the_newest_labelled_run(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        self._publish(tmp_path, "b-smoke", "smoke", "2026-10-02T09:00:00+00:00")
        self._publish(tmp_path, "a-sweep", "sweep", "2026-10-01T09:00:00+00:00")
        status, body = self._latest(monkeypatch, tmp_path)
        assert status == 200
        assert (body["run_id"], body["run_kind"]) == ("b-smoke", "smoke")
        assert body["label"] == "scorer smoke test"

    def test_latest_benchmark_orders_by_time_not_text(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        # 10:00 in UTC+02:00 is 08:00 UTC, earlier than 09:00 UTC, though it sorts later as text.
        self._publish(tmp_path, "later", "official", "2026-10-02T09:00:00+00:00")
        self._publish(tmp_path, "earlier", "official", "2026-10-02T10:00:00+02:00")
        status, body = self._latest(monkeypatch, tmp_path)
        assert (status, body["run_id"]) == (200, "later")

    def test_a_malformed_summary_fails_loudly(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        self._publish(tmp_path, "good", "official", "2026-10-02T09:00:00+00:00")
        (tmp_path / "broken").mkdir()
        (tmp_path / "broken" / "summary.json").write_text("{not json", encoding="utf-8")
        status, _ = self._latest(monkeypatch, tmp_path)
        assert status == 500

    def test_latest_benchmark_ignores_summaries_of_another_schema(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        self._publish(tmp_path, "run-v1", "official", "2026-10-09T09:00:00+00:00", schema="1")
        status, _ = self._latest(monkeypatch, tmp_path)
        assert status == 404


def test_the_api_reads_the_summary_schema_the_report_writes() -> None:
    """The API publishes only summaries of its schema version; a bump on
    one side alone would silently hide every run."""
    assert queries.SUMMARY_SCHEMA_VERSION == report.SUMMARY_SCHEMA_VERSION
