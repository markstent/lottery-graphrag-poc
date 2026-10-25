"""API contract tests for CORS and the demo questions (docs/reference/07 section 18),
without external services.

The run routes are tested in tests/test_api_runs.py and the benchmark routes
in tests/test_api_benchmarks.py. Truth-ledger non-exposure is enforced
structurally by tests/test_truth_ledger_isolation.py.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from app.evaluation import official
from app.main import create_app
from fastapi.testclient import TestClient


@pytest.fixture()
def client() -> Iterator[TestClient]:
    with TestClient(create_app()) as test_client:
        yield test_client


class TestCorsAndDemo:
    def test_cors_allows_the_dev_frontend(self, client: TestClient) -> None:
        response = client.get("/api/v1/health", headers={"Origin": "http://localhost:5173"})
        assert response.headers["access-control-allow-origin"] == "http://localhost:5173"

    def test_cors_rejects_other_origins(self, client: TestClient) -> None:
        response = client.get("/api/v1/health", headers={"Origin": "http://evil.example"})
        assert "access-control-allow-origin" not in response.headers

    def test_demo_questions_need_the_grounded_bank(
        self, client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The v1 fixed list is gone: without a bank there are no demo questions.
        tests/test_api_scoring.py covers the questions drawn from a bank."""
        monkeypatch.setattr(official, "DATA_DIR", tmp_path / "data")
        response = client.get("/api/v1/demo/questions")
        assert response.status_code == 503
        assert response.json()["error"]["error_code"] == "CONFIGURATION_ERROR"
