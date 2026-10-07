"""Health endpoint contract."""

from app.main import app
from fastapi.testclient import TestClient


def test_health_returns_ok() -> None:
    client = TestClient(app)
    response = client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": "0.1.0"}
