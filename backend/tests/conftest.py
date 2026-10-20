"""Shared fixtures: a stand-in for the lazily imported litellm module, an
offline retrieval lab, the tiny generated world and a per-test run database."""

from __future__ import annotations

import sys
import types
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
