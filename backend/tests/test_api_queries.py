"""API contract tests for CORS and the demo configuration (docs/07 section
18), without external services.

The run routes are tested in tests/test_api_runs.py and the benchmark routes
in tests/test_api_benchmarks.py. Truth-ledger non-exposure is enforced
structurally by tests/test_truth_ledger_isolation.py.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
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
