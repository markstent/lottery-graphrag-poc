"""Failure-mode tests (docs/08 Phase 12): pipelines surface real errors.

A failing gateway, embedder or vector store must raise out of ``run()``
instead of producing a fabricated success. The benchmark runner additionally
contains gateway failures per question as ``generation_failure`` results
(covered live in ``test_benchmark_live.py``).
"""

from __future__ import annotations

from collections.abc import Sequence

import pytest
from app.evidence import EvidenceChunk
from app.retrieval.graph.entities import StaticEntityResolver
from app.retrieval.graph.pipeline import GraphRagPipeline
from app.retrieval.standard.corpus import CorpusChunk
from app.retrieval.standard.embeddings import EmbeddingFunction, HashingEmbedder
from app.retrieval.standard.generation import AnswerGenerator, GenerationError
from app.retrieval.standard.pipeline import StandardRagPipeline
from app.retrieval.standard.sparse import HashingSparseEmbedder, SparseVector
from app.retrieval.standard.vector_store import (
    InMemoryVectorStore,
    SearchHit,
    VectorStore,
)

from tests.test_graph_rag import build_corpus as build_graph_corpus
from tests.test_graph_rag import make_settings, resolved, scn007_adjacency
from tests.test_standard_rag import make_corpus
from tests.test_standard_rag import make_settings as make_rag_settings


class FailingGenerator:
    """Gateway stub that always fails, like an unreachable provider."""

    model_name = "failing-gateway-v1"

    def generate(
        self,
        question: str,
        contexts: list[EvidenceChunk],
        extra_blocks: list[str] | None = None,
    ) -> tuple[str, float]:
        raise GenerationError("Model gateway call failed: provider unreachable")


class FailingEmbedder:
    """Embedder stub that always fails, like a dead embedding host."""

    model_name = "failing-embedder-v1"

    def embed(self, texts: list[str]) -> list[list[float]]:
        raise RuntimeError("embedding host refused connection")


class FailingStore(InMemoryVectorStore):
    """Vector store stub whose search always fails."""

    def search(
        self,
        dense: list[float],
        sparse: SparseVector,
        limit: int,
        markets: Sequence[str] | None = None,
        kinds: Sequence[str] | None = None,
    ) -> list[SearchHit]:
        raise RuntimeError("vector store connection reset")


def fill_store(
    store: VectorStore, corpus: list[CorpusChunk] | dict[str, CorpusChunk], dimensions: int
) -> None:
    """Index corpus with fixed vectors so retrieval reaches the store."""
    chunks = list(corpus) if isinstance(corpus, list) else list(corpus.values())
    store.upsert(
        ids=[chunk.chunk_id for chunk in chunks],
        dense=[[0.1] * dimensions for _ in chunks],
        sparse=HashingSparseEmbedder().embed_documents([chunk.text for chunk in chunks]),
        payloads=[chunk.to_payload() for chunk in chunks],
    )


def build_standard(
    generator: AnswerGenerator, embeddings: EmbeddingFunction, store: VectorStore
) -> StandardRagPipeline:
    settings = make_rag_settings()
    fill_store(store, make_corpus(), settings.embedding.dimensions)
    return StandardRagPipeline(
        embeddings=embeddings,
        sparse=HashingSparseEmbedder(),
        store=store,
        generator=generator,
        settings=settings,
    )


def build_graph(
    generator: AnswerGenerator, embeddings: EmbeddingFunction, store: VectorStore
) -> GraphRagPipeline:
    settings = make_settings()
    corpus = build_graph_corpus()
    fill_store(store, corpus, settings.embedding.dimensions)
    return GraphRagPipeline(
        resolver=StaticEntityResolver(resolved()),
        neighbours=scn007_adjacency(),
        embeddings=embeddings,
        sparse=HashingSparseEmbedder(),
        store=store,
        generator=generator,
        settings=settings,
    )


class TestGatewayFailure:
    def test_standard_pipeline_surfaces_gateway_failure(self) -> None:
        settings = make_rag_settings()
        pipeline = build_standard(
            FailingGenerator(),
            HashingEmbedder(dimensions=settings.embedding.dimensions),
            InMemoryVectorStore(),
        )
        with pytest.raises(GenerationError, match="provider unreachable"):
            pipeline.run("Why did Greek digital checkout fail?")

    def test_graph_pipeline_surfaces_gateway_failure(self) -> None:
        settings = make_settings()
        pipeline = build_graph(
            FailingGenerator(),
            HashingEmbedder(dimensions=settings.embedding.dimensions),
            InMemoryVectorStore(),
        )
        with pytest.raises(GenerationError, match="provider unreachable"):
            pipeline.run("What happened to INC_S007_GR?")


class TestEmbeddingFailure:
    def test_standard_pipeline_surfaces_embedding_failure(self) -> None:
        pipeline = build_standard(FailingGenerator(), FailingEmbedder(), InMemoryVectorStore())
        with pytest.raises(RuntimeError, match="embedding host"):
            pipeline.run("Why did Greek digital checkout fail?")

    def test_graph_pipeline_surfaces_embedding_failure(self) -> None:
        pipeline = build_graph(FailingGenerator(), FailingEmbedder(), InMemoryVectorStore())
        with pytest.raises(RuntimeError, match="embedding host"):
            pipeline.run("What happened to INC_S007_GR?")


class TestVectorStoreFailure:
    def test_standard_pipeline_surfaces_store_failure(self) -> None:
        settings = make_rag_settings()
        pipeline = build_standard(
            FailingGenerator(),
            HashingEmbedder(dimensions=settings.embedding.dimensions),
            FailingStore(),
        )
        with pytest.raises(RuntimeError, match="connection reset"):
            pipeline.run("Why did Greek digital checkout fail?")

    def test_graph_pipeline_surfaces_store_failure(self) -> None:
        settings = make_settings()
        pipeline = build_graph(
            FailingGenerator(),
            HashingEmbedder(dimensions=settings.embedding.dimensions),
            FailingStore(),
        )
        with pytest.raises(RuntimeError, match="connection reset"):
            pipeline.run("What happened to INC_S007_GR?")
