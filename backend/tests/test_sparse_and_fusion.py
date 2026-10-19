"""Sparse embeddings and reciprocal rank fusion (docs/retrieval/hybrid-search.md)."""

from __future__ import annotations

import os

import pytest
from app.config import EmbeddingSettings
from app.retrieval.standard.fusion import RRF_K, reciprocal_rank_fusion
from app.retrieval.standard.sparse import (
    FastembedBm25Embedder,
    HashingSparseEmbedder,
    build_sparse_embedder,
    resolve_sparse_provider,
)


def test_hashing_sparse_is_deterministic_and_term_weighted() -> None:
    e = HashingSparseEmbedder()
    a, b = e.embed_documents(["draw draw game", "draw game"])
    assert a == e.embed_documents(["draw draw game"])[0]
    assert max(a.values) > max(b.values)


def test_greek_query_matches_greek_document_sparsely() -> None:
    e = HashingSparseEmbedder()
    q = e.embed_query("Στιγμιαίο Λαχείο")
    d = e.embed_documents(["Το Στιγμιαίο Λαχείο πωλείται στα πρακτορεία."])[0]
    assert set(q.indices) & set(d.indices)


def test_hashing_query_weights_each_distinct_token_once() -> None:
    q = HashingSparseEmbedder().embed_query("draw draw game")
    assert len(q.indices) == 2
    assert q.values == (1.0, 1.0)


def test_rrf_prefers_items_high_in_both_rankings() -> None:
    fused = reciprocal_rank_fusion([["a", "b", "c"], ["b", "a", "d"]])
    assert {i for i, _ in fused[:2]} == {"a", "b"}
    assert fused[0][1] > fused[-1][1]
    assert {i for i, _ in fused} == {"a", "b", "c", "d"}


def test_rrf_scores_and_tie_break() -> None:
    fused = reciprocal_rank_fusion([["x"], ["y"]], k=10)
    assert fused == [("x", 1 / 11), ("y", 1 / 11)]


def test_rrf_default_k_is_the_published_constant() -> None:
    assert RRF_K == 60
    assert reciprocal_rank_fusion([["a"]]) == [("a", 1 / 61)]


def test_rrf_ties_break_on_dense_rank_then_id() -> None:
    # "z" (dense rank 1) and "a" (sparse rank 1 only) tie on score; the
    # dense rank decides, not the id.
    assert [item for item, _ in reciprocal_rank_fusion([["z", "m"], ["a", "m"]])] == [
        "m",
        "z",
        "a",
    ]
    # Absent from the dense channel sorts last; then the id decides.
    fused = reciprocal_rank_fusion([["x"], ["b"], ["a"]])
    assert [item for item, _ in fused] == ["x", "a", "b"]
    assert len({score for _, score in fused}) == 1


def _settings(provider: str, sparse_provider: str) -> EmbeddingSettings:
    return EmbeddingSettings(
        provider=provider,
        model="m",
        dimensions=8,
        host="h",
        sparse_provider=sparse_provider,
    )


def test_build_sparse_embedder_hashing() -> None:
    assert isinstance(build_sparse_embedder(_settings("hashing", "hashing")), HashingSparseEmbedder)


def test_build_sparse_embedder_rejects_unknown_provider() -> None:
    with pytest.raises(ValueError, match="sparse provider"):
        build_sparse_embedder(_settings("hashing", "nope"))


def test_from_env_sparse_defaults_follow_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.config import from_env

    monkeypatch.delenv("SPARSE_PROVIDER", raising=False)
    monkeypatch.setenv("EMBEDDING_PROVIDER", "hashing")
    assert from_env().embedding.sparse_provider is None
    assert resolve_sparse_provider(from_env().embedding) == "hashing"
    monkeypatch.setenv("EMBEDDING_PROVIDER", "ollama")
    assert resolve_sparse_provider(from_env().embedding) == "fastembed"
    assert from_env().embedding.sparse_model == "Qdrant/bm25"
    monkeypatch.setenv("SPARSE_PROVIDER", "hashing")
    assert resolve_sparse_provider(from_env().embedding) == "hashing"


@pytest.mark.skipif(os.environ.get("SPARSE_E2E") != "1", reason="downloads a model")
def test_fastembed_bm25_end_to_end() -> None:
    e = FastembedBm25Embedder()
    d = e.embed_documents(["The instant lottery is sold at retailers."])[0]
    q = e.embed_query("instant lottery")
    assert set(q.indices) & set(d.indices)
