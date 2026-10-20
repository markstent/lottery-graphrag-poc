"""One error model: classification, the HTTP envelope, graph failures and timeouts."""

from __future__ import annotations

import logging
from collections.abc import Iterator
from typing import Any, cast

import neo4j.exceptions
import pytest
from app.api.errors import RUN_ERROR_MESSAGES, UNEXPECTED_MESSAGE, classify, run_error_body
from app.config import GraphConfig, from_env
from app.lab import Lab
from app.main import create_app
from app.models.gateway import GatewayError
from app.retrieval.graph.neo4j_adapter import GraphReader
from app.retrieval.standard.embeddings import EmbeddingError
from app.retrieval.standard.generation import GenerationError
from app.retrieval.standard.reranking import RerankError
from app.retrieval.standard.sparse import SparseEmbeddingError
from app.retrieval.standard.vector_store import VectorStoreError
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests.test_api_runs import GRAPH, await_finished, lab, start  # noqa: F401
from tests.test_standard_rag import make_settings


@pytest.mark.parametrize(
    ("exc", "code", "retryable"),
    [
        (neo4j.exceptions.ServiceUnavailable("down"), "GRAPH_QUERY_ERROR", True),
        (neo4j.exceptions.SessionExpired("gone"), "GRAPH_QUERY_ERROR", True),
        (neo4j.exceptions.TransientError("tx timed out"), "GRAPH_QUERY_ERROR", True),
        (neo4j.exceptions.ConnectionAcquisitionTimeoutError("pool"), "GRAPH_QUERY_ERROR", True),
        (neo4j.exceptions.ClientError("bad"), "GRAPH_QUERY_ERROR", False),
        (neo4j.exceptions.CypherSyntaxError("bad"), "GRAPH_QUERY_ERROR", False),
        (GenerationError("x"), "MODEL_ERROR", True),
        (GatewayError("x"), "MODEL_ERROR", True),
        (EmbeddingError("x"), "EMBEDDING_ERROR", True),
        (SparseEmbeddingError("x"), "EMBEDDING_ERROR", True),
        (VectorStoreError("x"), "VECTOR_RETRIEVAL_ERROR", True),
        (RerankError("x"), "CONTEXT_BUILD_ERROR", False),
        (ValueError("x"), "RUN_ERROR", False),
    ],
)
def test_classify(exc: BaseException, code: str, retryable: bool) -> None:
    assert classify(exc) == (code, retryable)


@pytest.fixture()
def client() -> Iterator[TestClient]:
    with TestClient(create_app()) as test_client:
        yield test_client


def _error(response: Any) -> dict[str, Any]:
    body: dict[str, Any] = response.json()
    assert list(body) == ["error"]
    error: dict[str, Any] = body["error"]
    assert set(error) == {"error_code", "message", "retryable"}
    return error


def test_not_found_uses_the_envelope(client: TestClient) -> None:
    response = client.get("/api/v1/queries/RUN-nope")
    assert response.status_code == 404
    assert response.json() == {
        "error": {"error_code": "NOT_FOUND", "message": "unknown run_id", "retryable": False}
    }


def test_an_unknown_route_uses_the_envelope(client: TestClient) -> None:
    response = client.get("/api/v1/nowhere")
    assert response.status_code == 404
    assert _error(response)["error_code"] == "NOT_FOUND"


def test_validation_errors_use_the_envelope(client: TestClient) -> None:
    response = client.post("/api/v1/queries", json={"question": ""})
    assert response.status_code == 422
    error = _error(response)
    assert error["error_code"] == "VALIDATION_ERROR" and error["retryable"] is False
    assert "question" in error["message"]


def test_an_unhandled_error_is_generic_in_the_body_and_detailed_in_the_log(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    app = cast(FastAPI, client.app)

    def boom() -> None:
        raise RuntimeError("secret detail: /srv/internal/path")

    app.add_api_route("/boom", boom)
    with caplog.at_level(logging.ERROR):
        response = TestClient(app, raise_server_exceptions=False).get(
            "/boom", headers={"Origin": "http://localhost:5173"}
        )
    assert response.status_code == 500
    assert _error(response) == {
        "error_code": "RUN_ERROR",
        "message": UNEXPECTED_MESSAGE,
        "retryable": False,
    }
    assert "secret detail" not in response.text
    # The browser can read the envelope: the 500 carries the CORS headers too.
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert response.headers["x-request-id"]
    logged = caplog.records[-1]
    assert logged.exc_info is not None and "secret detail" in str(logged.exc_info[1])
    assert logged.context["request_id"] == response.headers["x-request-id"]  # type: ignore[attr-defined]


@pytest.mark.parametrize(
    ("exc", "message"),
    [
        (GenerationError("http://gw:4000 said: {body}"), RUN_ERROR_MESSAGES["MODEL_ERROR"]),
        (EmbeddingError("ollama at http://host:11434 down"), RUN_ERROR_MESSAGES["EMBEDDING_ERROR"]),
        (
            VectorStoreError("qdrant http://q:6333 404"),
            RUN_ERROR_MESSAGES["VECTOR_RETRIEVAL_ERROR"],
        ),
        (RerankError("Cross-encoder failed: /models/x"), RUN_ERROR_MESSAGES["CONTEXT_BUILD_ERROR"]),
        (neo4j.exceptions.ServiceUnavailable("bolt://h"), RUN_ERROR_MESSAGES["GRAPH_QUERY_ERROR"]),
        (ValueError("/srv/internal"), UNEXPECTED_MESSAGE),
    ],
)
def test_run_error_bodies_use_the_curated_message_of_their_code(
    exc: Exception, message: str
) -> None:
    body = run_error_body(exc)
    assert body.message == message and str(exc) not in body.message
    assert (body.error_code, body.retryable) == classify(exc)


def test_a_neo4j_outage_surfaces_as_graph_query_error(
    lab: Lab,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    import app.api.runs as runs_module

    def unreachable(*_args: object, **_kwargs: object) -> None:
        raise neo4j.exceptions.ServiceUnavailable("bolt://internal-host:7687 refused")

    monkeypatch.setattr(runs_module, "wired_pipelines", unreachable)
    with (
        TestClient(create_app(lab_factory=lambda: lab, graph_config=GRAPH)) as client,
        caplog.at_level(logging.ERROR),
    ):
        run_id = start(client, configurations=["B"])
        run = await_finished(client, run_id)
        events = client.get(f"/api/v1/queries/{run_id}/events").json()["events"]
    assert run["status"] == "failed" and run["pipeline_status"] == {"B": "failed"}
    assert run["error"]["error_code"] == "GRAPH_QUERY_ERROR" and run["error"]["retryable"] is True
    assert "internal-host" not in run["error"]["message"]
    failed = [event for event in events if event["event_type"] == "run.failed"]
    assert failed[0]["payload"]["error_code"] == "GRAPH_QUERY_ERROR"
    assert failed[0]["payload"]["retryable"] is True
    assert not any(event["event_type"] == "run.error" for event in events)
    assert any("internal-host" in str(r.exc_info) for r in caplog.records if r.exc_info)


def test_timeouts_come_from_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    assert GraphConfig.from_env().timeout_s == 10.0
    assert from_env().generation.timeout_s == 120.0
    monkeypatch.setenv("NEO4J_TIMEOUT_S", "2.5")
    monkeypatch.setenv("GENERATION_TIMEOUT_S", "45")
    assert GraphConfig.from_env().timeout_s == 2.5
    assert from_env().generation.timeout_s == 45.0


def test_graph_reader_passes_the_timeout_to_the_driver_and_each_query(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import neo4j

    captured: dict[str, Any] = {}

    class FakeDriver:
        def execute_query(self, query: Any, params: Any, **kwargs: Any) -> Any:
            captured["query_timeout"] = query.timeout
            return type("Result", (), {"records": []})()

    def fake_driver(uri: str, **kwargs: Any) -> FakeDriver:
        captured["connection_timeout"] = kwargs["connection_timeout"]
        return FakeDriver()

    monkeypatch.setattr(neo4j.GraphDatabase, "driver", staticmethod(fake_driver))
    config = GraphConfig("bolt://x", "u", "p", "d", timeout_s=3.5)
    assert GraphReader(config).markets() == {}
    assert captured == {"connection_timeout": 3.5, "query_timeout": 3.5}


def test_generator_receives_the_generation_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    import dataclasses

    from app.lab import build_generator

    settings = make_settings()
    settings = dataclasses.replace(
        settings, generation=dataclasses.replace(settings.generation, timeout_s=7.0)
    )
    generator = build_generator("litellm", settings)
    assert generator._timeout_s == 7.0  # type: ignore[attr-defined]
