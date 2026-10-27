"""The test-wide service guard (tests/conftest.py, fix round T4-R3): no
ungated test reaches the real Neo4j, Qdrant or a model server.

Each test here replaces the connect the guard falls through to with a
recorder that refuses everything, so even a broken guard could not reach the
network: the tests prove the guard refuses first and the recorder never sees
a service port.
"""

from __future__ import annotations

import socket
from pathlib import Path
from typing import Any

import pytest
from app.config import GraphConfig, from_env
from app.evaluation import official
from app.retrieval.graph.neo4j_adapter import GraphReader
from app.retrieval.standard.vector_store import QdrantVectorStore

from tests import conftest, live

GUARD = conftest.SERVICE_GUARD_ERROR


@pytest.fixture
def network(monkeypatch: pytest.MonkeyPatch) -> list[Any]:
    """Every address that got past the guard; none reaches the network."""
    passed: list[Any] = []

    def recorder(_socket: socket.socket, address: Any) -> None:
        passed.append(address)
        raise ConnectionRefusedError(f"the test network is closed: {address}")

    monkeypatch.setattr(conftest, "_real_connect", recorder)
    return passed


@pytest.fixture(autouse=True)
def flags_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    for flag in (live.GRAPH, live.VECTOR, live.WORLD):
        monkeypatch.delenv(flag, raising=False)


def _consume(attempts: list[str], service: str) -> None:
    """Assert the guard refused ``service`` and clear the attempts, so the
    guard's own teardown check passes for this deliberate attempt."""
    assert attempts and all(attempt.startswith(service) for attempt in attempts)
    attempts.clear()


def test_the_real_neo4j_driver_is_refused_before_the_network(
    no_real_services: list[str], network: list[Any]
) -> None:
    reader = GraphReader(GraphConfig.from_env())
    try:
        with pytest.raises(Exception) as error:
            reader.ping()
    finally:
        reader.close()
    chain = repr(error.value) + repr(error.value.__cause__) + repr(error.value.__context__)
    assert GUARD in chain, chain
    assert network == []
    _consume(no_real_services, "Neo4j")


def test_the_ingest_step_is_refused_before_the_network(
    no_real_services: list[str], network: list[Any], tmp_path: Path, tiny_dataset: Path
) -> None:
    paths = official.WorldPaths(
        2026, tiny_dataset, tmp_path / "ledger.json", tmp_path / "bank.json", "unused"
    )
    with pytest.raises(RuntimeError, match="ingesting world seed 2026 failed"):
        official._ingest(paths)
    assert network == []
    _consume(no_real_services, "Neo4j")


def test_the_real_qdrant_client_is_refused_before_the_network(
    no_real_services: list[str], network: list[Any]
) -> None:
    store = QdrantVectorStore(from_env().vector.url, "guard_check", 8)
    with pytest.raises(Exception):  # noqa: B017 - the client wraps the refusal its own way
        store.exists()
    assert network == []
    _consume(no_real_services, "Qdrant")


def test_a_live_flag_lifts_the_guard_for_its_service_only(monkeypatch: pytest.MonkeyPatch) -> None:
    services = set(conftest.guarded_ports().values())
    assert services == {"Neo4j", "Qdrant", "Ollama or a model server"}
    monkeypatch.setenv(live.GRAPH, "1")
    ports = conftest.guarded_ports()
    assert 7687 not in ports and ports[6333] == "Qdrant" and ports[11434].startswith("Ollama")


def test_a_port_named_in_the_environment_is_guarded(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NEO4J_URI", "bolt://db.internal:17687")
    monkeypatch.setenv("QDRANT_URL", "http://vectors:16333")
    ports = conftest.guarded_ports()
    assert (ports[17687], ports[16333]) == ("Neo4j", "Qdrant")
