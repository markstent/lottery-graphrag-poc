"""Live-graph GraphRAG tests (opt-in: GRAPH_E2E=1, or `make test-graph`).

Runs the full graph pipeline against a real Neo4j holding the tiny
development world: real centralised statements, real resolver dictionaries,
real bounded traversal. Embeddings and generation stay deterministic
(HashingEmbedder, FakeAnswerGenerator) so the only live dependency is the
graph itself. The database is wiped and re-ingested, mirroring
test_graph_ingestion.py.
"""

from __future__ import annotations

import dataclasses
import os
from collections.abc import Iterator
from pathlib import Path

import pytest
from app.config import GraphConfig, RetrievalSettings
from app.datasets.config import GenerationConfig
from app.datasets.parquet import write_world
from app.datasets.schema import TABLE_SCHEMAS
from app.datasets.taxonomies import local_name_variants
from app.datasets.world import build_world
from app.graph.ingest import ingest
from app.ontology.loader import load_ontology
from app.ontology.terms import TermMatcher, build_term_table
from app.retrieval.graph.neo4j_adapter import GraphReader, build_resolvers
from app.retrieval.graph.pipeline import GraphRagPipeline
from app.retrieval.graph.resolution import IdEntityResolver, QueryExpansion, TermEntityResolver
from app.retrieval.graph.source_lookup import SourceLookup, record_blocks_of
from app.retrieval.standard.embeddings import HashingEmbedder
from app.retrieval.standard.generation import FakeAnswerGenerator
from app.retrieval.standard.index import index_corpus, load_indexed_corpus
from app.retrieval.standard.reranking import build_reranker
from app.retrieval.standard.sparse import HashingSparseEmbedder
from app.retrieval.standard.vector_store import InMemoryVectorStore
from neo4j import GraphDatabase

from tests import live
from tests.test_graph_rag import event_trace, make_settings


def resolvers_for(reader: GraphReader) -> tuple[IdEntityResolver, TermEntityResolver]:
    ontology = load_ontology()
    matcher = TermMatcher(build_term_table(ontology, local_name_variants()))
    return build_resolvers(reader, ontology, matcher)


CONNECT_TIMEOUT_SECONDS = 15.0


@pytest.fixture(scope="module")
def graph_config() -> GraphConfig:
    return GraphConfig(
        uri=os.environ.get("NEO4J_URI", "bolt://localhost:7687"),
        user=os.environ.get("NEO4J_USER", "neo4j"),
        password=os.environ.get("NEO4J_PASSWORD", "devpassword"),
        database=os.environ.get("NEO4J_DATABASE", "neo4j"),
    )


@pytest.fixture(scope="module")
def tiny_dataset(tmp_path_factory: pytest.TempPathFactory) -> Path:
    world = build_world(GenerationConfig(profile="tiny", world_seed=42))
    dataset_dir = tmp_path_factory.mktemp("tiny-world-graphrag")
    write_world(dataset_dir, TABLE_SCHEMAS, world.tables)
    return dataset_dir


@pytest.fixture(scope="module")
def ingested(graph_config: GraphConfig, tiny_dataset: Path) -> Path:
    live.skip_without(live.GRAPH)
    live.require_neo4j(graph_config)
    driver = GraphDatabase.driver(graph_config.uri, auth=(graph_config.user, graph_config.password))
    try:
        with driver.session(database=graph_config.database) as session:
            session.run("MATCH (n) DETACH DELETE n").consume()
    finally:
        driver.close()
    ingest(tiny_dataset, graph_config, ingestion_version="ing-test", wipe=True)
    return tiny_dataset


@pytest.fixture(scope="module")
def pipeline(ingested: Path, graph_config: GraphConfig) -> Iterator[GraphRagPipeline]:
    settings: RetrievalSettings = make_settings(dataset_dir=str(ingested))
    embeddings = HashingEmbedder(dimensions=settings.embedding.dimensions)
    sparse = HashingSparseEmbedder()
    corpus = load_indexed_corpus(ingested)
    store = InMemoryVectorStore()
    index_corpus(store, embeddings, sparse, list(corpus.values()))
    with GraphReader(graph_config) as reader:
        ontology = load_ontology()
        _ids, terms = resolvers_for(reader)
        yield GraphRagPipeline(
            resolver=terms,
            neighbours=reader,
            embeddings=embeddings,
            sparse=sparse,
            store=store,
            generator=FakeAnswerGenerator(),
            settings=settings,
            reranker=build_reranker(settings),
            source_lookup=SourceLookup(ingested, record_blocks_of(corpus.values())),
            pipeline="C",
            expansion=QueryExpansion(ontology),
            ontology=ontology,
        )


def _first_market_name(dataset_dir: Path) -> str:
    import duckdb

    rows = (
        duckdb.connect()
        .execute(
            f"SELECT market_name FROM read_parquet('{dataset_dir / 'markets.parquet'}') LIMIT 1"
        )
        .fetchall()
    )
    return str(rows[0][0])


def test_resolver_and_traversal_on_live_graph(pipeline: GraphRagPipeline) -> None:
    question = "What happened around digital checkout recently?"
    result = pipeline.run(question)

    assert result.answer.text.startswith("[fake-model]")
    assert result.node_evidence, "live traversal must produce candidates"
    selected = [evidence for evidence in result.node_evidence if evidence.selected]
    assert selected
    seeds = [
        event.payload["node_id"]
        for event in pipeline.events
        if event.event_type == "graph.seed.selected"
    ]
    assert seeds, "resolver must produce at least one seed"
    traversed = [
        event for event in pipeline.events if event.event_type == "graph.relationship.traversed"
    ]
    assert traversed
    # Structured nodes carry authoritative facts from the Parquet layer.
    authoritative = [evidence for evidence in selected if evidence.authoritative is not None]
    assert authoritative, "selected structured nodes must carry source facts"


def test_market_name_resolves_to_market_node(pipeline: GraphRagPipeline) -> None:
    market = _first_market_name(Path(pipeline.settings.dataset_dir))
    result = pipeline.run(f"What happened in {market} recently?")
    seeds = [
        event.payload["node_id"]
        for event in pipeline.events
        if event.event_type == "graph.seed.selected"
    ]
    assert any(isinstance(seed, str) and seed.startswith("MKT_") for seed in seeds)
    assert result.node_evidence


def test_pipeline_deterministic_on_live_graph(pipeline: GraphRagPipeline) -> None:
    question = "What happened around digital checkout recently?"
    runs = []
    for _ in range(2):
        pipeline.events.clear()
        result = pipeline.run(question)
        runs.append(
            (
                event_trace(pipeline.events),
                [(e.node_id, e.selected, e.discard_reason) for e in result.node_evidence],
                [(c.chunk_id, c.selected, c.discard_reason) for c in result.document_evidence],
                result.answer.raw_text,
            )
        )
    assert runs[0] == runs[1]


def test_ontology_edges_absent_in_pipeline_b(ingested: Path, graph_config: GraphConfig) -> None:
    graph_settings = make_settings(dataset_dir=str(ingested)).graph.without_ontology()
    full_settings = make_settings(dataset_dir=str(ingested))
    embeddings = HashingEmbedder(dimensions=full_settings.embedding.dimensions)
    sparse = HashingSparseEmbedder()
    corpus = load_indexed_corpus(ingested)
    store = InMemoryVectorStore()
    index_corpus(store, embeddings, sparse, list(corpus.values()))
    with GraphReader(graph_config) as reader:
        ids, _terms = resolvers_for(reader)
        pipeline = GraphRagPipeline(
            resolver=ids,
            neighbours=reader,
            embeddings=embeddings,
            sparse=sparse,
            store=store,
            generator=FakeAnswerGenerator(),
            settings=dataclasses.replace(full_settings, graph=graph_settings),
            reranker=build_reranker(full_settings),
            source_lookup=SourceLookup(ingested, record_blocks_of(corpus.values())),
            pipeline="B",
        )
        result = pipeline.run("What happened around digital checkout recently?")
    assert result.ontology_concepts == []
    traversed = {
        event.payload["relationship_type"]
        for event in pipeline.events
        if event.event_type == "graph.relationship.traversed"
    }
    assert "MAPS_TO" not in traversed
