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
from app.datasets.taxonomies import local_name_variants
from app.events import ListEventSink
from app.graph.config import GraphConfig
from app.ontology.loader import load_ontology
from app.ontology.model import Ontology
from app.ontology.terms import TermMatcher, build_term_table
from app.retrieval.graph.neo4j_adapter import GraphReader, build_resolvers
from app.retrieval.graph.pipeline import GraphRagPipeline
from app.retrieval.graph.resolution import EntityResolver, QueryExpansion
from app.retrieval.graph.source_lookup import SourceLookup, record_blocks_of
from app.retrieval.graph.traversal import NeighbourProvider
from app.retrieval.standard.corpus import CorpusChunk
from app.retrieval.standard.embeddings import EmbeddingFunction
from app.retrieval.standard.generation import (
    AnswerGenerator,
    FakeAnswerGenerator,
    LiteLLMAnswerGenerator,
)
from app.retrieval.standard.index import build_embedder, build_store, load_indexed_corpus
from app.retrieval.standard.pipeline import StandardRagPipeline
from app.retrieval.standard.reranking import Reranker, build_reranker
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
    reranker: Reranker
    ontology: Ontology
    term_matcher: TermMatcher

    def pipeline_a(self, sink: ListEventSink | None = None) -> StandardRagPipeline:
        return StandardRagPipeline(
            embeddings=self.embeddings,
            sparse=self.sparse,
            store=self.store,
            generator=self.generator,
            settings=self.settings,
            reranker=self.reranker,
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
            max_tokens=settings.generation.max_tokens,
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
    ontology = load_ontology()
    corpus = load_indexed_corpus(Path(settings.dataset_dir))
    return Lab(
        settings=settings,
        generator=generator,
        corpus=corpus,
        # Nodes are judged and shown on the record blocks A indexes, byte for byte.
        source_lookup=SourceLookup(Path(settings.dataset_dir), record_blocks_of(corpus.values())),
        embeddings=embeddings,
        sparse=build_sparse_embedder(settings.embedding),
        store=store,
        reranker=build_reranker(settings),
        ontology=ontology,
        term_matcher=TermMatcher(build_term_table(ontology, local_name_variants())),
    )


def wired_pipelines(
    lab: Lab,
    graph_config: GraphConfig,
) -> WiredGraphPipelines:
    """Wire B and C for one question against the live graph.

    Fair B/C split: identical limits and relationship allow-list; B is
    exactly C minus the ontology layer: the ontology relationships and
    concept expansion (see :func:`bc_graph_settings`), the ontology term
    resolution and the query expansion. Both resolve ids and market names
    with the same id resolver.
    """
    reader = GraphReader(graph_config)
    try:
        id_resolver, term_resolver = build_resolvers(reader, lab.ontology, lab.term_matcher)
        return WiredGraphPipelines(
            reader=reader,
            pipelines=graph_pipelines(lab, reader, id_resolver, term_resolver),
        )
    except Exception:
        reader.close()
        raise


def graph_pipelines(
    lab: Lab,
    neighbours: NeighbourProvider,
    id_resolver: EntityResolver,
    term_resolver: EntityResolver,
) -> list[tuple[PipelineId, GraphRagPipeline]]:
    """Construct B and C from the lab's shared components (no I/O)."""
    settings_b, settings_c = bc_graph_settings(lab.settings)
    variants: tuple[
        tuple[
            PipelineId, RetrievalSettings, EntityResolver, QueryExpansion | None, Ontology | None
        ],
        ...,
    ] = (
        ("B", settings_b, id_resolver, None, None),
        ("C", settings_c, term_resolver, QueryExpansion(lab.ontology), lab.ontology),
    )
    return [
        (
            tag,
            GraphRagPipeline(
                resolver=resolver,
                neighbours=neighbours,
                embeddings=lab.embeddings,
                sparse=lab.sparse,
                store=lab.store,
                generator=lab.generator,
                settings=tuned,
                reranker=lab.reranker,
                source_lookup=lab.source_lookup,
                pipeline=tag,
                sink=ListEventSink(),
                expansion=expansion,
                ontology=ontology,
            ),
        )
        for tag, tuned, resolver, expansion, ontology in variants
    ]


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
