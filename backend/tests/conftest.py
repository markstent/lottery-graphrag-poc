"""Shared fixtures: a stand-in for the lazily imported litellm module, an
offline retrieval lab, the tiny generated world, a per-test run database and
the check that no run worker or benchmark job thread outlives its test."""

from __future__ import annotations

import _socket
import json
import os
import socket
import sys
import threading
import types
from collections.abc import Buffer, Iterator
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import pytest
from app.datasets.config import GenerationConfig
from app.datasets.parquet import write_world
from app.datasets.schema import TABLE_SCHEMAS
from app.datasets.taxonomies import local_name_variants
from app.datasets.world import build_world
from app.evaluation import addendum
from app.evaluation.bank import BANK_VERSION
from app.evaluation.checks import SCORER_VERSION
from app.evaluation.grounding import FrozenBank, instance_from_payload
from app.lab import Lab
from app.ontology.loader import load_ontology
from app.ontology.terms import TermMatcher, build_term_table
from app.retrieval.graph.source_lookup import SourceLookup
from app.retrieval.standard.embeddings import HashingEmbedder
from app.retrieval.standard.generation import FakeAnswerGenerator
from app.retrieval.standard.reranking import build_reranker
from app.retrieval.standard.sparse import HashingSparseEmbedder
from app.retrieval.standard.vector_store import InMemoryVectorStore
from app.scenarios.engine import apply_scenarios
from app.scenarios.ledger import build_ledger, write_ledger

from tests import live
from tests.test_graph_rag import make_settings

# Thread names of a live run's worker (QueryService) and of a benchmark job
# (BenchmarkJobs): a test that starts one must wait for it to end.
WORKER_PREFIXES = ("query-", "benchmark-")
# A worker that a test waited for exits within microseconds of its last
# write; one still alive after this grace was left running by its test.
LEAK_GRACE_S = 1.0
# How long a leaked worker may keep running, inside its test's teardown (so
# its output is still captured), before the session gives up on it.
LEAK_DRAIN_S = 15.0
_leaks: list[str] = []


def _workers(prefixes: tuple[str, ...] = WORKER_PREFIXES) -> list[threading.Thread]:
    return [t for t in threading.enumerate() if t.name.startswith(prefixes)]


def _drain(test: str, prefixes: tuple[str, ...] = WORKER_PREFIXES) -> None:
    """Note each worker still running after ``test``, then let it finish."""
    for thread in _workers(prefixes):
        thread.join(LEAK_GRACE_S)
        if thread.is_alive():
            _leaks.append(f"{thread.name} (left running by {test})")
            thread.join(LEAK_DRAIN_S)


# pytest releases its output capture between a test's phases to report
# them, and the JSON log handler writes to whatever sys.stderr is then, so a
# run worker running across a phase boundary prints its stage timings to the
# terminal. Each phase is therefore checked, inside its capture, as it ends.
# Setup and call check run workers only: a benchmark job a test holds behind
# a gate logs nothing while it waits, and its fixture releases it.
RUN_WORKER = ("query-",)


@pytest.hookimpl(wrapper=True, trylast=True)
def pytest_runtest_setup(item: pytest.Item) -> Iterator[None]:
    result = yield
    _drain(f"{item.nodeid} (setup)", RUN_WORKER)
    return result


@pytest.hookimpl(wrapper=True, trylast=True)
def pytest_runtest_call(item: pytest.Item) -> Iterator[None]:
    result = yield
    _drain(f"{item.nodeid} (call)", RUN_WORKER)
    return result


@pytest.hookimpl(wrapper=True, trylast=True)
def pytest_runtest_teardown(item: pytest.Item) -> Iterator[None]:
    result = yield
    _drain(f"{item.nodeid} (teardown)")
    return result


@pytest.fixture(scope="session", autouse=True)
def no_worker_outlives_its_test() -> Iterator[None]:
    """Fail the session if any test left a run worker or a job thread
    running. The last test's teardown runs this before the hook above, so
    it drains that test itself."""
    yield
    _drain("the last test of the session")
    alive = [t.name for t in _workers()]
    if _leaks or alive:
        pytest.fail(f"worker threads outlived their tests: {_leaks + alive}")


@pytest.fixture(scope="module", autouse=True)
def presentation_graph_restored() -> Iterator[None]:
    """After each module, Neo4j holds the presentation world again: a live
    test module that wipes the graph must not leave the next one, or the
    developer's presentation, on another world."""
    yield from live.graph_restored_after()


class StubLiteLLM(types.ModuleType):
    """Replaces ``sys.modules["litellm"]``; records each ``completion`` call."""

    def __init__(self, content: str | None, error: Exception | None = None) -> None:
        super().__init__("litellm")
        self.calls: list[dict[str, Any]] = []
        self._content = content
        self._error = error
        # The choice's stop reason; None leaves it out, as a provider may.
        self.finish_reason: str | None = None

    def completion(self, **kwargs: Any) -> dict[str, Any]:
        self.calls.append(kwargs)
        if self._error is not None:
            raise self._error
        choice: dict[str, Any] = {"message": {"content": self._content}}
        if self.finish_reason is not None:
            choice["finish_reason"] = self.finish_reason
        return _Response(choices=[choice])


class _Response(dict[str, Any]):
    """Subscriptable choices and an attribute usage, like a litellm ModelResponse."""

    usage = types.SimpleNamespace(prompt_tokens=3, completion_tokens=1, total_tokens=4)


@pytest.fixture(autouse=True)
def run_database(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Every test's API writes its runs to its own database, never data/app.db."""
    path = tmp_path / "app.db"
    monkeypatch.setenv("APP_DB_PATH", str(path))
    return path


@pytest.fixture(autouse=True)
def no_ingested_world(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """The active dataset defaults to an empty directory: the repository's
    generated world, which exists on a developer machine only, would make
    the API consult a live Neo4j. A test that needs a world sets DATASET_DIR."""
    path = tmp_path / "no-world"
    monkeypatch.setenv("DATASET_DIR", str(path))
    return path


@pytest.fixture(autouse=True)
def not_public(monkeypatch: pytest.MonkeyPatch) -> None:
    """The API runs as the local lab, whatever the shell holds; a test of the
    public read-only site (D-117) sets PUBLIC_MODE itself."""
    monkeypatch.delenv("PUBLIC_MODE", raising=False)


@pytest.fixture(autouse=True)
def litellm_offline(monkeypatch: pytest.MonkeyPatch) -> None:
    """A test that loads the real LiteLLM (the API does at start-up when
    GENERATION_PROVIDER=litellm) reads its bundled cost map, never the network."""
    monkeypatch.setenv("LITELLM_LOCAL_MODEL_COST_MAP", "True")


# The services an ungated test must never reach, each with the flag that
# opts a live test in (tests/live.py) and its ports: the defaults, and any
# port the environment names for it (read at collection and on each connect).
SERVICE_DEFAULT_PORTS = {
    "Neo4j": (live.GRAPH, {7474, 7473, 7687}),
    "Qdrant": (live.VECTOR, {6333, 6334}),
    "Ollama or a model server": (live.WORLD, {11434}),
}
SERVICE_URL_VARIABLES = {
    "Neo4j": ("NEO4J_URI",),
    "Qdrant": ("QDRANT_URL",),
    "Ollama or a model server": ("OLLAMA_HOST", "GENERATION_API_BASE", "JUDGE_API_BASE"),
}
# The port a URL without one uses.
SCHEME_PORTS = {"http": 80, "https": 443, "bolt": 7687, "neo4j": 7687}
SERVICE_GUARD_ERROR = "tests must not reach real services"


def _url_ports(variables: tuple[str, ...]) -> set[int]:
    ports = set()
    for name in variables:
        value = os.environ.get(name)
        if not value:
            continue
        # A URL that does not parse, or whose port is not a number, guards nothing.
        try:
            url = urlsplit(value if "://" in value else f"//{value}")
            port = url.port
        except ValueError:
            continue
        # "bolt+s" and "neo4j+ssc" use their base scheme's port.
        port = port or SCHEME_PORTS.get(url.scheme.split("+")[0])
        if port is not None:
            ports.add(port)
    return ports


_COLLECTION_PORTS = {name: _url_ports(names) for name, names in SERVICE_URL_VARIABLES.items()}


def guarded_ports() -> dict[int, str]:
    """Port to service, for every service whose live flag is unset now."""
    ports: dict[int, str] = {}
    for service, (flag, defaults) in SERVICE_DEFAULT_PORTS.items():
        if live.enabled(flag):
            continue
        named = _COLLECTION_PORTS[service] | _url_ports(SERVICE_URL_VARIABLES[service])
        for port in defaults | named:
            ports[port] = service
    return ports


# The connects the guard falls through to for any other address; module
# attributes, looked up on each call, so the guard's own test can replace
# them with recorders.
# The address a socket connects to, as the standard library types it.
_Address = tuple[Any, ...] | str | Buffer
_real_connect = socket.socket.connect
_real_connect_ex = socket.socket.connect_ex
# Every refused attempt not yet charged to a test; ``no_real_services`` fails
# the test it happened in, and the session check any left outside a test.
_attempts: list[str] = []


def _refuse(address: Any) -> None:
    """Refuse a connect to a guarded service, with the flags as they are now."""
    if not (isinstance(address, tuple) and len(address) >= 2):
        return
    service = guarded_ports().get(address[1])
    if service is not None:
        attempt = f"{service} at {address[0]}:{address[1]}"
        _attempts.append(attempt)
        raise ConnectionRefusedError(f"{SERVICE_GUARD_ERROR}: a test tried to reach {attempt}")


def _guarded_connect(self: _socket.socket, address: _Address) -> None:
    _refuse(address)
    _real_connect(self, address)


def _guarded_connect_ex(self: _socket.socket, address: _Address) -> int:
    _refuse(address)
    return int(_real_connect_ex(self, address))


def pytest_configure(config: pytest.Config) -> None:
    """Install the service guard (fix round T4-R3) once, before any fixture
    of any scope or any test module's import-time code runs: an ungated
    test never opens a socket to Neo4j, Qdrant, Ollama or a model server.
    A live flag lifts the guard for its own service only."""
    socket.socket.connect = _guarded_connect  # type: ignore[method-assign]
    socket.socket.connect_ex = _guarded_connect_ex  # type: ignore[method-assign]


def pytest_unconfigure(config: pytest.Config) -> None:
    socket.socket.connect = _real_connect  # type: ignore[method-assign]
    socket.socket.connect_ex = _real_connect_ex  # type: ignore[method-assign]


@pytest.fixture(scope="session", autouse=True)
def no_service_attempt_outside_a_test() -> Iterator[None]:
    """Fail the session when a module or session fixture's teardown tried
    to reach a real service after the last test that could be charged."""
    yield
    assert not _attempts, f"a fixture tried to reach real services: {_attempts}"


@pytest.fixture(autouse=True)
def no_real_services() -> Iterator[list[str]]:
    """Fail the test in whose setup, call or teardown a connect to a real
    service was refused, even where the code under test swallows the error
    (a benchmark job thread, a readiness probe). Attempts made by a module or
    session fixture set up for this test are charged to it too. Yields the
    attempts, so the guard's own test can consume them."""
    yield _attempts
    found = list(_attempts)
    _attempts.clear()
    assert not found, f"an ungated test tried to reach real services: {found}"


@pytest.fixture(autouse=True)
def offline_models(monkeypatch: pytest.MonkeyPatch) -> None:
    """Tests embed with the deterministic hashing embedder and generate and
    judge with the fake providers, whatever the shell or ``.env`` holds, so
    the readiness checks and the lab never need a running Ollama. A live
    test that needs the real model calls ``live.use_the_real_world``; a test
    of litellm configuration sets it itself."""
    monkeypatch.setenv("EMBEDDING_PROVIDER", "hashing")
    monkeypatch.setenv("GENERATION_PROVIDER", "fake")
    monkeypatch.setenv("JUDGE_PROVIDER", "fake")


@pytest.fixture(autouse=True)
def offline_default_lab(monkeypatch: pytest.MonkeyPatch) -> None:
    """The API builds its lab at start-up: an app started without a lab
    factory, the import-time ``app.main.app`` included (the default is
    looked up at start-up), gets the offline lab, never the live services."""
    import app.main

    monkeypatch.setattr(app.main, "default_lab", build_lab_offline)


@pytest.fixture(scope="session")
def tiny_dataset(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """The tiny generated world (seed 42) as Parquet, built once per session."""
    world = build_world(GenerationConfig(profile="tiny", world_seed=42))
    dataset_dir = tmp_path_factory.mktemp("tiny-world-api")
    write_world(dataset_dir, TABLE_SCHEMAS, world.tables)
    return dataset_dir


@pytest.fixture(scope="session")
def tiny_planted(tmp_path_factory: pytest.TempPathFactory) -> tuple[Path, Path]:
    """A planted tiny world (seed 42) with its manifest, and the ledger of the
    same planting, built once per session."""
    world = build_world(GenerationConfig(profile="tiny", world_seed=42))
    outcomes = apply_scenarios(world)
    root = tmp_path_factory.mktemp("tiny-world-grounding")
    dataset_dir = root / "tiny-seed42"
    write_world(dataset_dir, TABLE_SCHEMAS, world.tables)
    manifest = json.dumps(world.manifest, indent=2, sort_keys=True) + "\n"
    (dataset_dir / "_manifest.json").write_text(manifest)
    ledger_path = write_ledger(root / "ledger.json", build_ledger(outcomes, world))
    return dataset_dir, ledger_path


def recorded_banks(payload: dict[str, Any]) -> dict[int, FrozenBank]:
    """Each world's bank as its recorded instances, for a test run with no world on disk."""
    return {
        int(world["world_seed"]): FrozenBank(
            bank_version=BANK_VERSION,
            world_seed=int(world["world_seed"]),
            world_manifest_hash="",
            record_serialiser_version="",
            scorer_version=SCORER_VERSION,
            ledger_hash="",
            instances=tuple(instance_from_payload(entry["instance"]) for entry in world["results"]),
            unavailable=(),
            bank_hash="",
        )
        for world in payload["worlds"]
    }


@pytest.fixture
def banks_as_recorded(monkeypatch: pytest.MonkeyPatch) -> None:
    """Rescoring grounds a run's worlds again (D-095); a test run has no
    world on disk, so each world's bank is its recorded instances as they are."""
    monkeypatch.setattr(addendum, "current_banks", recorded_banks)


def _install(monkeypatch: pytest.MonkeyPatch, stub: StubLiteLLM) -> StubLiteLLM:
    monkeypatch.setitem(sys.modules, "litellm", stub)
    return stub


@pytest.fixture
def stub_litellm(monkeypatch: pytest.MonkeyPatch) -> StubLiteLLM:
    return _install(monkeypatch, StubLiteLLM("ok"))


@pytest.fixture
def stub_litellm_empty(monkeypatch: pytest.MonkeyPatch) -> StubLiteLLM:
    return _install(monkeypatch, StubLiteLLM("  "))


@pytest.fixture
def stub_litellm_raises(monkeypatch: pytest.MonkeyPatch) -> StubLiteLLM:
    return _install(monkeypatch, StubLiteLLM(None, RuntimeError("provider down")))


def build_lab_offline() -> Lab:
    """A lab on the hashing embedders, an empty in-memory store and the fake generator."""
    settings = make_settings()
    ontology = load_ontology()
    return Lab(
        settings=settings,
        generator=FakeAnswerGenerator(),
        corpus={},
        source_lookup=SourceLookup(Path("unused"), {}),
        embeddings=HashingEmbedder(dimensions=settings.embedding.dimensions),
        sparse=HashingSparseEmbedder(),
        store=InMemoryVectorStore(),
        reranker=build_reranker(settings),
        ontology=ontology,
        term_matcher=TermMatcher(build_term_table(ontology, local_name_variants())),
    )
