"""Shared construction of the A/B/C retrieval lab.

One place builds the embedding model, vector store, corpus, source lookup
and the three pipelines so the trace CLI and the benchmark harness run
byte-identical retrieval configurations (docs/retrieval/retrieval-fairness.md).
"""

from __future__ import annotations

import dataclasses
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from app.config import RetrievalSettings
from app.events import ListEventSink
from app.graph.config import GraphConfig
from app.retrieval.graph.entities import EntityResolver
from app.retrieval.graph.neo4j_adapter import GraphReader, build_resolver
from app.retrieval.graph.pipeline import GraphRagPipeline
from app.retrieval.graph.source_lookup import SourceLookup
from app.retrieval.standard.corpus import CorpusChunk
from app.retrieval.standard.embeddings import EmbeddingFunction
from app.retrieval.standard.generation import (
    AnswerGenerator,
    FakeAnswerGenerator,
    LiteLLMAnswerGenerator,
)
from app.retrieval.standard.index import build_embedder, build_store, load_indexed_corpus
from app.retrieval.standard.pipeline import StandardRagPipeline
from app.retrieval.standard.sparse import SparseEmbedder, build_sparse_embedder
from app.retrieval.standard.vector_store import VectorStore

PipelineId = Literal["A", "B", "C"]


@dataclass(frozen=True, slots=True)
class Lab:
    """Shared retrieval components; build once per process."""

    settings: RetrievalSettings
    generator: AnswerGenerator
    # The indexed corpus (document chunks plus record blocks); used to
    # populate an empty store on API cold start.
    corpus: dict[str, CorpusChunk]
    source_lookup: SourceLookup
    embeddings: EmbeddingFunction
    sparse: SparseEmbedder
    store: VectorStore

    def pipeline_a(self, sink: ListEventSink | None = None) -> StandardRagPipeline:
        return StandardRagPipeline(
            embeddings=self.embeddings,
            sparse=self.sparse,
            store=self.store,
            generator=self.generator,
            settings=self.settings,
            pipeline="A",
            sink=sink if sink is not None else ListEventSink(),
        )


def build_generator(name: str, settings: RetrievalSettings) -> AnswerGenerator:
    """Generator factory shared by the trace and benchmark CLIs."""
    if name == "fake":
        return FakeAnswerGenerator()
    if name == "litellm":
        return LiteLLMAnswerGenerator(
            model=settings.generation.model,
            temperature=settings.generation.temperature,
            api_base=settings.generation.api_base,
        )
    raise ValueError(f"Unknown generator: {name!r}")


@dataclass(frozen=True, slots=True)
class WiredGraphPipelines:
    """B and C sharing one Neo4j reader; close the reader when done."""

    reader: GraphReader
    pipelines: list[tuple[PipelineId, GraphRagPipeline]]


def build_lab(settings: RetrievalSettings, generator: AnswerGenerator) -> Lab:
    embeddings = build_embedder(settings.embedding)
    store = build_store(settings.vector, embeddings.dimensions, settings.embedding.provider)
    return Lab(
        settings=settings,
        generator=generator,
        corpus=load_indexed_corpus(Path(settings.dataset_dir)),
        source_lookup=SourceLookup(Path(settings.dataset_dir)),
        embeddings=embeddings,
        sparse=build_sparse_embedder(settings.embedding),
        store=store,
    )


def wired_pipelines(
    lab: Lab,
    graph_config: GraphConfig,
) -> WiredGraphPipelines:
    """Wire B and C for one question against the live graph.

    Fair B/C split: identical limits and relationship allow-list; B is
    exactly C minus the ontology relationships and concept expansion (see
    :func:`bc_graph_settings`).
    """
    reader = GraphReader(graph_config)
    try:
        resolver: EntityResolver = build_resolver(reader)
        settings_b, settings_c = bc_graph_settings(lab.settings)
        pipelines: list[tuple[PipelineId, GraphRagPipeline]] = []
        for tag, tuned in (("B", settings_b), ("C", settings_c)):
            pipelines.append(
                (
                    tag,  # type: ignore[arg-type]
                    GraphRagPipeline(
                        resolver=resolver,
                        neighbours=reader,
                        embeddings=lab.embeddings,
                        sparse=lab.sparse,
                        store=lab.store,
                        generator=lab.generator,
                        settings=tuned,
                        source_lookup=lab.source_lookup,
                        pipeline=tag,
                        sink=ListEventSink(),
                    ),
                )
            )
        return WiredGraphPipelines(reader=reader, pipelines=pipelines)
    except Exception:
        reader.close()
        raise


def bc_graph_settings(
    base: RetrievalSettings,
) -> tuple[RetrievalSettings, RetrievalSettings]:
    """Retrieval settings for pipelines B and C: the fairness contract.

    C is the base configuration. B is derived from it by
    :meth:`GraphRagSettings.without_ontology`, which drops every ontology
    relationship type and concept expansion; limits, budgets and every other
    relationship type are identical.
    """
    graph_c = dataclasses.replace(base.graph, ontology_expansion=True)
    return (
        dataclasses.replace(base, graph=graph_c.without_ontology()),
        dataclasses.replace(base, graph=graph_c),
    )
