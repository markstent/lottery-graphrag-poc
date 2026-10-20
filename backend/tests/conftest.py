"""Shared fixtures: a stand-in for the lazily imported litellm module, an
offline retrieval lab, the tiny generated world, a per-test run database and
the check that no run worker or benchmark job thread outlives its test."""

from __future__ import annotations

import sys
import threading
import types
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from app.datasets.config import GenerationConfig
from app.datasets.parquet import write_world
from app.datasets.schema import TABLE_SCHEMAS
from app.datasets.taxonomies import local_name_variants
from app.datasets.world import build_world
from app.lab import Lab
from app.ontology.loader import load_ontology
from app.ontology.terms import TermMatcher, build_term_table
from app.retrieval.graph.source_lookup import SourceLookup
from app.retrieval.standard.embeddings import HashingEmbedder
from app.retrieval.standard.generation import FakeAnswerGenerator
from app.retrieval.standard.reranking import build_reranker
from app.retrieval.standard.sparse import HashingSparseEmbedder
from app.retrieval.standard.vector_store import InMemoryVectorStore

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


class StubLiteLLM(types.ModuleType):
    """Replaces ``sys.modules["litellm"]``; records each ``completion`` call."""

    def __init__(self, content: str | None, error: Exception | None = None) -> None:
        super().__init__("litellm")
        self.calls: list[dict[str, Any]] = []
        self._content = content
        self._error = error

    def completion(self, **kwargs: Any) -> dict[str, Any]:
        self.calls.append(kwargs)
        if self._error is not None:
            raise self._error
        return _Response(choices=[{"message": {"content": self._content}}])


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
