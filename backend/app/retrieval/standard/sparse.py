"""Sparse (BM25) embeddings for hybrid retrieval.

Two adapters:

- FastembedBm25Embedder: the real BM25 model via fastembed (Qdrant/bm25).
- HashingSparseEmbedder: a deterministic, dependency-free fake for CI.
"""

from __future__ import annotations

import hashlib
import os
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from app.config import EmbeddingSettings
from app.retrieval.standard.embeddings import _tokenise

DEFAULT_SPARSE_MODEL = "Qdrant/bm25"
_BM25_K1 = 1.2
_BM25_B = 0.75
# Fixed average document length (tokens) for the fake; real BM25 learns it.
_FAKE_AVG_DOC_LEN = 20


@dataclass(frozen=True, slots=True)
class SparseVector:
    """Parallel index/value arrays of a sparse vector."""

    indices: tuple[int, ...]
    values: tuple[float, ...]


class SparseEmbedder(Protocol):
    """Embeds texts into sparse term-weight vectors."""

    model_name: str

    def embed_documents(self, texts: list[str]) -> list[SparseVector]: ...

    def embed_query(self, text: str) -> SparseVector: ...


class FastembedBm25Embedder:
    """BM25 sparse embeddings from fastembed."""

    def __init__(self, model: str = DEFAULT_SPARSE_MODEL) -> None:
        from fastembed import SparseTextEmbedding

        self.model_name = model
        cache_dir = Path(os.environ.get("FASTEMBED_CACHE", "~/.cache/fastembed")).expanduser()
        self._model = SparseTextEmbedding(model_name=model, cache_dir=str(cache_dir))

    def embed_documents(self, texts: list[str]) -> list[SparseVector]:
        return [_to_vector(e) for e in self._model.embed(texts)]

    def embed_query(self, text: str) -> SparseVector:
        return _to_vector(next(iter(self._model.query_embed(text))))


def _to_vector(embedding: object) -> SparseVector:
    indices = getattr(embedding, "indices")  # noqa: B009 - fastembed ships no types
    values = getattr(embedding, "values")  # noqa: B009
    return SparseVector(
        indices=tuple(int(i) for i in indices), values=tuple(float(v) for v in values)
    )


class HashingSparseEmbedder:
    """Deterministic BM25-style fake (CI/test).

    Documents get BM25 term-frequency weights with IDF fixed at 1.0 and a fixed
    average document length, so weights are monotone in term frequency. Queries
    weight each distinct token 1.0. Not a quality model.
    """

    def __init__(self, dimensions: int = 2**20) -> None:
        self.model_name = f"hashing-sparse-{dimensions}"
        self._dimensions = dimensions

    def _index(self, token: str) -> int:
        digest = hashlib.blake2b(token.encode("utf-8"), digest_size=8).digest()
        return int.from_bytes(digest, "big") % self._dimensions

    def _collapse(self, weights: dict[str, float]) -> SparseVector:
        by_index: dict[int, float] = {}
        for token, weight in weights.items():
            index = self._index(token)
            by_index[index] = by_index.get(index, 0.0) + weight
        ordered = sorted(by_index.items())
        return SparseVector(tuple(i for i, _ in ordered), tuple(w for _, w in ordered))

    def embed_documents(self, texts: list[str]) -> list[SparseVector]:
        return [self._embed_document(text) for text in texts]

    def _embed_document(self, text: str) -> SparseVector:
        tokens = _tokenise(text)
        norm = _BM25_K1 * (1 - _BM25_B + _BM25_B * len(tokens) / _FAKE_AVG_DOC_LEN)
        return self._collapse(
            {t: tf * (_BM25_K1 + 1) / (tf + norm) for t, tf in Counter(tokens).items()}
        )

    def embed_query(self, text: str) -> SparseVector:
        return self._collapse(dict.fromkeys(_tokenise(text), 1.0))


def build_sparse_embedder(settings: EmbeddingSettings) -> SparseEmbedder:
    """Construct the sparse embedder named by settings."""
    if settings.sparse_provider == "fastembed":
        return FastembedBm25Embedder(settings.sparse_model)
    if settings.sparse_provider == "hashing":
        return HashingSparseEmbedder()
    raise ValueError(f"Unknown sparse provider: {settings.sparse_provider!r}")
