"""Dense embeddings: Ollama vectors are unit length and of the configured
dimension, and the lab refuses a collection of another size
(spec 6.3, docs/reference/retrieval/embeddings.md)."""

from __future__ import annotations

import dataclasses
import math
from typing import Any

import app.lab as lab_module
import httpx
import pytest
from app.config import RetrievalSettings
from app.lab import build_lab
from app.retrieval.standard.embeddings import EmbeddingError, OllamaEmbedder
from app.retrieval.standard.generation import FakeAnswerGenerator
from app.retrieval.standard.sparse import SparseVector
from app.retrieval.standard.vector_store import InMemoryVectorStore, VectorStoreError

from tests.test_standard_rag import make_settings

RAW = [[3.0, 4.0, 0.0, 12.0], [1.0, -2.0, 2.0, 0.5]]


class StubOllama:
    """Replaces ``httpx.post``; answers every embed call with ``vectors``."""

    def __init__(self, vectors: list[list[float]]) -> None:
        self.vectors = vectors
        self.calls: list[dict[str, Any]] = []

    def __call__(self, url: str, json: dict[str, Any], timeout: float) -> httpx.Response:
        self.calls.append({"url": url, **json})
        request = httpx.Request("POST", url)
        return httpx.Response(200, json={"embeddings": self.vectors}, request=request)


@pytest.fixture
def stub_ollama(monkeypatch: pytest.MonkeyPatch) -> StubOllama:
    stub = StubOllama(RAW)
    monkeypatch.setattr(httpx, "post", stub)
    return stub


@pytest.fixture
def stub_ollama_returning_512(monkeypatch: pytest.MonkeyPatch) -> StubOllama:
    stub = StubOllama([[0.5] * 512])
    monkeypatch.setattr(httpx, "post", stub)
    return stub


def ollama(dimensions: int = 4) -> OllamaEmbedder:
    return OllamaEmbedder(model="bge-m3", dimensions=dimensions, host="http://ollama.test")


def cosine(left: list[float], right: list[float]) -> float:
    dot = math.fsum(a * b for a, b in zip(left, right, strict=True))
    norms = math.sqrt(math.fsum(a * a for a in left)) * math.sqrt(math.fsum(b * b for b in right))
    return dot / norms


def test_ollama_vectors_are_unit_length(stub_ollama: StubOllama) -> None:
    vectors = ollama().embed(["x", "y"])
    assert len(vectors) == 2
    for vector in vectors:
        assert math.isclose(math.fsum(v * v for v in vector), 1.0, rel_tol=1e-9)


def test_normalising_keeps_the_direction(stub_ollama: StubOllama) -> None:
    (vector, _other) = ollama().embed(["x", "y"])
    assert vector == pytest.approx([3 / 13, 4 / 13, 0.0, 12 / 13], rel=1e-12)


def test_normalising_leaves_cosine_rankings_unchanged(stub_ollama: StubOllama) -> None:
    """A collection indexed from raw Ollama vectors needs no rebuild: Qdrant
    ranks by cosine, which is invariant to scaling either vector."""
    normalised = ollama().embed(["x", "y"])
    assert math.isclose(
        cosine(normalised[0], normalised[1]), cosine(RAW[0], RAW[1]), rel_tol=0, abs_tol=1e-12
    )
    # On unit vectors the cosine is the plain dot product.
    dot = math.fsum(a * b for a, b in zip(normalised[0], normalised[1], strict=True))
    assert math.isclose(dot, cosine(RAW[0], RAW[1]), rel_tol=0, abs_tol=1e-12)


def test_a_wrong_dimension_is_refused(stub_ollama_returning_512: StubOllama) -> None:
    with pytest.raises(EmbeddingError, match=r"1024.*512|512.*1024"):
        ollama(dimensions=1024).embed(["x"])


# -- the collection size at lab build --------------------------------------


def store_of_size(dimensions: int) -> InMemoryVectorStore:
    store = InMemoryVectorStore()
    store.upsert(
        ids=["CHNK_A"],
        dense=[[1.0] + [0.0] * (dimensions - 1)],
        sparse=[SparseVector(indices=(1,), values=(1.0,))],
        payloads=[{"chunk_id": "CHNK_A", "kind": "chunk"}],
    )
    return store


@pytest.fixture
def in_memory_store_of_size_8(monkeypatch: pytest.MonkeyPatch) -> InMemoryVectorStore:
    store = store_of_size(8)
    monkeypatch.setattr(lab_module, "build_store", lambda *_args: store)
    return store


def settings_with_dimensions(dimensions: int) -> RetrievalSettings:
    base = make_settings()
    return dataclasses.replace(
        base,
        embedding=dataclasses.replace(
            base.embedding, model=f"hashing-{dimensions}", dimensions=dimensions
        ),
    )


def test_the_in_memory_store_reports_its_vector_size() -> None:
    assert InMemoryVectorStore().dimensions is None
    store = store_of_size(8)
    assert store.dimensions == 8
    assert store.collection_info()["dimensions"] == 8


def test_a_collection_of_another_size_is_refused_at_build(
    in_memory_store_of_size_8: InMemoryVectorStore,
) -> None:
    with pytest.raises(VectorStoreError, match=r"8.*16|16.*8"):
        build_lab(settings_with_dimensions(16), FakeAnswerGenerator())
