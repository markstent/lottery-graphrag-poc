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
from app.retrieval.standard.corpus import CorpusChunk, load_corpus
from app.retrieval.standard.embeddings import EmbeddingFunction
from app.retrieval.standard.generation import (
    AnswerGenerator,
    FakeAnswerGenerator,
    LiteLLMAnswerGenerator,
)
from app.retrieval.standard.index import build_embedder, build_store
from app.retrieval.standard.pipeline import StandardRagPipeline
from app.retrieval.standard.vector_store import VectorStore

PipelineId = Literal["A", "B", "C"]

# Player-instrument/device edges for fraud-topology questions; excluded from
# the operational allow-list because they fan out to thousands of neighbours.
FRAUD_RELATIONSHIP_TYPES: tuple[str, ...] = ("USES_PAYMENT", "USES")


@dataclass(frozen=True, slots=True)
class Lab:
    """Shared retrieval components; build once per process."""

    settings: RetrievalSettings
    generator: AnswerGenerator
    corpus: dict[str, CorpusChunk]
    source_lookup: SourceLookup
    embeddings: EmbeddingFunction
    store: VectorStore

    def pipeline_a(self, sink: ListEventSink | None = None) -> StandardRagPipeline:
        return StandardRagPipeline(
            embeddings=self.embeddings,
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
        corpus={chunk.chunk_id: chunk for chunk in load_corpus(Path(settings.dataset_dir))},
        source_lookup=SourceLookup(Path(settings.dataset_dir)),
        embeddings=embeddings,
        store=store,
    )


def wired_pipelines(
    lab: Lab,
    graph_config: GraphConfig,
    profile: str | None,
) -> WiredGraphPipelines:
    """Wire B and C for one question against the live graph.

    Fair B/C split: identical limits and relationship allow-list; B is
    exactly C minus the ontology relationships (MAPS_TO) and concept
    expansion. ``profile="fraud"`` adds the player-instrument/device edges
    to both.
    """
    reader = GraphReader(graph_config)
    try:
        resolver: EntityResolver = build_resolver(reader)
        relationships = graph_relationships(lab.settings, profile)
        pipeline_b_graph = dataclasses.replace(
            lab.settings.graph,
            relationship_types=tuple(rel for rel in relationships if rel != "MAPS_TO"),
            ontology_expansion=False,
        )
        pipeline_c_graph = dataclasses.replace(
            lab.settings.graph,
            relationship_types=relationships,
            ontology_expansion=True,
        )
        pipelines: list[tuple[PipelineId, GraphRagPipeline]] = []
        for tag, graph_settings in (("B", pipeline_b_graph), ("C", pipeline_c_graph)):
            tuned = dataclasses.replace(lab.settings, graph=graph_settings)
            pipelines.append(
                (
                    tag,  # type: ignore[arg-type]
                    GraphRagPipeline(
                        resolver=resolver,
                        neighbours=reader,
                        embeddings=lab.embeddings,
                        store=lab.store,
                        corpus=lab.corpus,
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


def graph_relationships(base: RetrievalSettings, profile: str | None) -> tuple[str, ...]:
    if profile == "fraud":
        return base.graph.relationship_types + FRAUD_RELATIONSHIP_TYPES
    return base.graph.relationship_types
