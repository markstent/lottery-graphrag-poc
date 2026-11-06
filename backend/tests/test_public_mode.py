"""The public read-only site (D-117): with ``PUBLIC_MODE=1`` every write
route is refused with one envelope, reads still answer, readiness asks only
for what the read-only screens need and the lab is never built."""

from __future__ import annotations

import re
from collections.abc import Iterator
from pathlib import Path

import app.api.readiness as readiness_module
import pytest
from app.api.errors import PUBLIC_READ_ONLY_MESSAGE
from app.config import GraphConfig, api_from_env
from app.lab import Lab
from app.main import create_app
from fastapi.routing import APIRoute, iter_route_contexts
from fastapi.testclient import TestClient

WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
# The routes the owner named; the enumeration below must find each of them.
NAMED_WRITE_ROUTES = {
    ("POST", "/api/v1/queries"),
    ("POST", "/api/v1/queries/{run_id}/cancel"),
    ("POST", "/api/v1/benchmarks"),
    ("POST", "/api/v1/benchmarks/jobs/{job_id}/cancel"),
}
GRAPH_DOWN = GraphConfig(
    uri="bolt://127.0.0.1:1", user="neo4j", password="unused", database="neo4j", timeout_s=30.0
)
_PARAMETER = re.compile(r"\{[^}]+\}")


def _concrete(path: str) -> str:
    """The route's path with every parameter filled in."""
    return _PARAMETER.sub("unknown-id", path)


def _routes(methods: set[str]) -> list[tuple[str, str]]:
    """Every API route of the app and its methods among ``methods``.

    ``app.routes`` holds each included router whole; ``iter_route_contexts``
    walks into them and gives each route its full, prefixed path.
    """
    app = create_app(lab_factory=_never_built, graph_config=GRAPH_DOWN)
    return sorted(
        (method, context.path)
        for context in iter_route_contexts(app.routes)
        if isinstance(context.original_route, APIRoute) and context.path is not None
        for method in (context.methods or set()) & methods
    )


def _never_built() -> Lab:
    raise AssertionError("the public site must never build the lab")


class _AnsweringReader:
    """Stands in for the Neo4j reader of a healthy graph."""

    def __init__(self, config: GraphConfig) -> None:
        del config

    def ping(self) -> None:
        pass

    def close(self) -> None:
        pass


@pytest.fixture
def public(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("PUBLIC_MODE", "1")
    with TestClient(create_app(lab_factory=_never_built, graph_config=GRAPH_DOWN)) as client:
        yield client


def test_the_enumeration_finds_every_named_write_route() -> None:
    assert NAMED_WRITE_ROUTES.issubset(_routes(WRITE_METHODS))


@pytest.mark.parametrize(("method", "path"), _routes(WRITE_METHODS))
def test_every_write_route_is_refused_on_the_public_site(
    public: TestClient, method: str, path: str
) -> None:
    response = public.request(method, _concrete(path), json={})
    assert response.status_code == 403
    assert response.json() == {
        "error": {
            "error_code": "PUBLIC_READ_ONLY",
            "message": PUBLIC_READ_ONLY_MESSAGE,
            "retryable": False,
        }
    }


@pytest.mark.parametrize("method", sorted(WRITE_METHODS))
def test_a_write_to_a_path_with_no_route_is_refused_too(public: TestClient, method: str) -> None:
    assert public.request(method, "/api/v1/not-a-route-yet").status_code == 403


@pytest.mark.parametrize(("method", "path"), _routes({"GET"}))
def test_every_read_route_still_answers_on_the_public_site(
    public: TestClient, method: str, path: str
) -> None:
    """A read may find nothing in this empty test world (404, 422, 503), but it is never refused."""
    response = public.request(method, _concrete(path))
    assert response.status_code != 403
    if response.status_code >= 400:
        assert response.json().get("error", {}).get("error_code") != "PUBLIC_READ_ONLY"


def test_reads_that_need_no_world_answer_200_on_the_public_site(public: TestClient) -> None:
    for path in ("/api/v1/health", "/api/v1/queries", "/api/v1/benchmarks", "/api/v1/ontology"):
        assert public.get(path).status_code == 200, path


def test_writes_are_not_refused_off_the_public_site(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("PUBLIC_MODE", raising=False)
    with TestClient(create_app(graph_config=GRAPH_DOWN)) as client:
        response = client.post("/api/v1/queries/unknown-id/cancel")
    assert response.status_code == 404


def test_readiness_on_the_public_site_asks_only_for_the_data_and_the_graph(
    public: TestClient, monkeypatch: pytest.MonkeyPatch, no_ingested_world: Path
) -> None:
    monkeypatch.setattr(readiness_module, "GraphReader", _AnsweringReader)
    no_ingested_world.mkdir(parents=True)
    (no_ingested_world / "_manifest.json").write_text("{}", encoding="utf-8")
    response = public.get("/api/v1/health/ready")
    body = response.json()
    assert response.status_code == 200
    assert body["public_mode"] is True and body["ready"] is True
    assert set(body["checks"]) == {"data", "graph"}
    assert body["checks"]["data"]["ok"] is True


def test_readiness_on_the_public_site_is_not_ready_without_the_world(
    public: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(readiness_module, "GraphReader", _AnsweringReader)
    response = public.get("/api/v1/health/ready")
    body = response.json()
    assert response.status_code == 503
    assert body["checks"]["data"] == {
        "ok": False,
        "detail": "the world's files are missing",
        "stand_in": False,
    }


def test_readiness_off_the_public_site_says_so(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("PUBLIC_MODE", raising=False)
    with TestClient(create_app(graph_config=GRAPH_DOWN)) as client:
        body = client.get("/api/v1/health/ready").json()
    assert body["public_mode"] is False
    assert set(body["checks"]) == {"lab", "index", "graph", "model", "embedding"}


def test_models_on_the_public_site_are_not_probed(
    public: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    def no_probe(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("the public site must not probe a model")

    monkeypatch.setattr(readiness_module.ModelReachability, "check", no_probe)
    monkeypatch.setattr(readiness_module.ModelReachability, "check_embedding", no_probe)
    body = public.get("/api/v1/models").json()
    for role in ("generation", "embedding"):
        assert body[role]["reachable"] is None
        assert body[role]["detail"] == "not run on the public read-only site"


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("", False), ("0", False), ("false", False), ("1", True), ("true", True), ("TRUE", True)],
)
def test_public_mode_setting(monkeypatch: pytest.MonkeyPatch, raw: str, expected: bool) -> None:
    monkeypatch.setenv("PUBLIC_MODE", raw)
    assert api_from_env().public_mode is expected


def test_public_mode_refuses_an_unclear_value(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PUBLIC_MODE", "yes please")
    with pytest.raises(ValueError, match="PUBLIC_MODE must be 1 or 0"):
        api_from_env()
