"""GraphRAG pipeline tests (docs/08 Phase 9) without Neo4j.

The bounded walk runs over a static neighbour provider modelling the planted
SCN-007 neighbourhood from the development world; ranking, limits, ontology
expansion, telemetry and determinism are covered offline. A live-graph test
(`test_graph_rag_live.py`) covers the real adapter under GRAPH_E2E=1.
"""

from __future__ import annotations

import dataclasses

import pytest
from app.config import (
    DEFAULT_RANKING_WEIGHTS,
    DEFAULT_RELATIONSHIP_TYPES,
    ContextSettings,
    EmbeddingSettings,
    GenerationSettings,
    GraphRagSettings,
    RerankSettings,
    RetrievalSettings,
    VectorSettings,
)
from app.events import (
    GRAPH_CANDIDATE_DISCARDED,
    GRAPH_CANDIDATE_SELECTED,
    GRAPH_CONTEXT_ASSEMBLED,
    GRAPH_ENTITY_RESOLUTION_STARTED,
    GRAPH_ENTITY_RESOLVED,
    GRAPH_EVIDENCE_PATH_COMPLETED,
    GRAPH_GENERATION_COMPLETED,
    GRAPH_RELATIONSHIP_TRAVERSED,
    GRAPH_SEED_SELECTED,
    GRAPH_TRAVERSAL_STARTED,
)
from app.retrieval.graph.entities import ResolvedEntity, StaticEntityResolver
from app.retrieval.graph.pipeline import GraphRagPipeline
from app.retrieval.graph.source_lookup import SourceLookup
from app.retrieval.graph.traversal import (
    NeighbourEdge,
    StaticNeighbourProvider,
    bounded_traversal,
    expand_ontology,
    load_static_provider_from_rows,
)
from app.retrieval.standard.corpus import CorpusChunk
from app.retrieval.standard.embeddings import HashingEmbedder
from app.retrieval.standard.generation import FakeAnswerGenerator
from app.retrieval.standard.vector_store import InMemoryVectorStore


def build_corpus() -> dict[str, CorpusChunk]:
    """Corpus chunks for the documents reachable in the modelled graph."""
    chunks = [
        CorpusChunk(
            chunk_id="CHNK_S007_UK_00",
            document_id="DOC_S007_UK",
            chunk_index=0,
            text=(
                "Release note: the United Kingdom deferred the PLV_PAYMENTS_3 update "
                "to the next release window, so UK digital checkout was not exposed "
                "to the payment regression."
            ),
            title="Release Note: APPV_UK_530 (Deferred Update)",
            document_type="RELEASE_NOTE",
            market_id="MKT_UK",
            language_code="en",
            source_system="document_store",
            valid_from="2025-05-18 00:00:00",
            valid_to=None,
        ),
        CorpusChunk(
            chunk_id="CHNK_S007_GR_00",
            document_id="DOC_S007_GR",
            chunk_index=0,
            text=(
                "Incident report: Greek digital checkout failed after the payments "
                "platform update; severity high; recovery took five days."
            ),
            title="Incident Report: INC_S007_GR",
            document_type="INCIDENT_REPORT",
            market_id="MKT_GR",
            language_code="el",
            source_system="document_store",
            valid_from="2025-05-27 00:00:00",
            valid_to=None,
        ),
    ]
    return {chunk.chunk_id: chunk for chunk in chunks}


def make_settings(**overrides: object) -> RetrievalSettings:
    values: dict[str, object] = {
        "dataset_dir": "unused",
        "top_k": 4,
        "embedding": EmbeddingSettings(
            provider="hashing", model="hashing-256", dimensions=256, host=""
        ),
        "vector": VectorSettings(url="", collection="test"),
        "context": ContextSettings(budget_tokens=2000, dedupe_threshold=0.85),
        "rerank": RerankSettings(enabled=False, lexical_weight=0.3),
        "generation": GenerationSettings(
            provider="fake", model="fake-answer-v1", temperature=0.0, api_base=None
        ),
        "graph": GraphRagSettings(
            max_depth=2,
            max_nodes_per_hop=100,
            max_edges_per_node_type=4,
            max_total_nodes=200,
            max_evidence_nodes=8,
            relationship_types=DEFAULT_RELATIONSHIP_TYPES,
            ontology_expansion=True,
            ranking=DEFAULT_RANKING_WEIGHTS,
        ),
    }
    values.update(overrides)
    return RetrievalSettings(**values)  # type: ignore[arg-type]


def scn007_adjacency() -> StaticNeighbourProvider:
    """Planted SCN-007 neighbourhood (mirrors the development world)."""
    edges: list[tuple[str, str, str, str]] = [
        ("INC_S007_GR", "AFFECTS", "GAME_GR_01", "Game"),
        ("INC_S007_GR", "AFFECTS_MARKET", "MKT_GR", "Market"),
        ("INC_S007_GR", "RELATED_TO", "SPC_1", "SupportCase"),
        ("INC_S007_GR", "RELATED_TO", "SPC_2", "SupportCase"),
        ("INC_S007_GR", "MAPS_TO", "CONCEPT_PLATFORM_INCIDENT", "BusinessConcept"),
        ("INC_S007_AT", "MAPS_TO", "CONCEPT_PLATFORM_INCIDENT", "BusinessConcept"),
        ("INC_S007_CZ", "MAPS_TO", "CONCEPT_PLATFORM_INCIDENT", "BusinessConcept"),
        ("INC_006", "MAPS_TO", "CONCEPT_PLATFORM_INCIDENT", "BusinessConcept"),
        # Extra concept bindings: with max_edges_per_node_type=4 the
        # lexicographically-first four are traversed, so the sibling
        # incidents must arrive via the ontology-expansion stage.
        ("INC_002", "MAPS_TO", "CONCEPT_PLATFORM_INCIDENT", "BusinessConcept"),
        ("INC_005", "MAPS_TO", "CONCEPT_PLATFORM_INCIDENT", "BusinessConcept"),
        ("DOC_000", "MAPS_TO", "CONCEPT_PLATFORM_INCIDENT", "Document"),
        ("INC_S007_GR", "RELATED_TO_VERSION", "PLV_PAYMENTS_3", "PlatformVersion"),
        ("INC_S007_AT", "RELATED_TO_VERSION", "PLV_PAYMENTS_3", "PlatformVersion"),
        ("INC_S007_CZ", "RELATED_TO_VERSION", "PLV_PAYMENTS_3", "PlatformVersion"),
        ("INC_006", "RELATED_TO_VERSION", "PLV_PAYMENTS_3", "PlatformVersion"),
        ("PLV_PAYMENTS_3", "VERSION_OF", "PLT_PAYMENTS", "Platform"),
        ("PLV_PAYMENTS_3", "REFERENCES", "DOC_S007_UK", "Document"),
        ("DOC_S007_UK", "HAS_CHUNK", "CHNK_S007_UK_00", "DocumentChunk"),
        ("MKT_GR", "AVAILABLE_IN", "GAME_GR_01", "Game"),
        # Player-heavy edge that must never be traversed (allow-list).
        ("GAME_GR_01", "PLAYS", "PLY_1", "Player"),
    ]
    adjacency: dict[str, list[NeighbourEdge]] = {}
    for from_id, rel_type, to_id, to_label in edges:
        adjacency.setdefault(from_id, []).append(
            NeighbourEdge(from_id=from_id, rel_type=rel_type, to_id=to_id, to_label=to_label)
        )
    return StaticNeighbourProvider(adjacency)


def resolved() -> list[ResolvedEntity]:
    return [
        ResolvedEntity(
            entity_id="INC_S007_GR",
            node_label="Incident",
            matched_text="INC_S007_GR",
            origin="id",
            confidence=1.0,
        )
    ]


def build_pipeline(
    settings: RetrievalSettings | None = None,
    resolver: StaticEntityResolver | None = None,
) -> GraphRagPipeline:
    settings = settings or make_settings()
    embeddings = HashingEmbedder(dimensions=settings.embedding.dimensions)
    corpus = build_corpus()
    store = InMemoryVectorStore()
    store.upsert(
        ids=[chunk.chunk_id for chunk in corpus.values()],
        vectors=embeddings.embed([chunk.text for chunk in corpus.values()]),
        payloads=[chunk.to_payload() for chunk in corpus.values()],
    )
    return GraphRagPipeline(
        resolver=resolver or StaticEntityResolver(resolved()),
        neighbours=scn007_adjacency(),
        embeddings=embeddings,
        store=store,
        corpus=corpus,
        generator=FakeAnswerGenerator(),
        settings=settings,
    )


class TestBoundedTraversal:
    def test_depth_and_limits_respected(self) -> None:
        settings = make_settings(
            graph=GraphRagSettings(
                max_depth=1,
                max_nodes_per_hop=3,
                max_edges_per_node_type=1,
                max_total_nodes=200,
                max_evidence_nodes=8,
                relationship_types=("AFFECTS", "AFFECTS_MARKET", "RELATED_TO"),
                ontology_expansion=True,
                ranking=DEFAULT_RANKING_WEIGHTS,
            )
        )
        traversal = bounded_traversal(scn007_adjacency(), ["INC_S007_GR"], settings.graph)
        assert traversal.depth_reached == 1
        # Per-node-per-type cap: one edge per relationship type from the seed.
        assert len(traversal.edges) == 3
        assert "PLV_PAYMENTS_3" not in traversal.node_ids  # type not in allow-list

    def test_total_node_cap_stops_walk(self) -> None:
        settings = make_settings(
            graph=GraphRagSettings(
                max_depth=2,
                max_nodes_per_hop=25,
                max_edges_per_node_type=4,
                max_total_nodes=5,
                max_evidence_nodes=4,
                relationship_types=DEFAULT_RELATIONSHIP_TYPES,
                ontology_expansion=True,
                ranking=DEFAULT_RANKING_WEIGHTS,
            )
        )
        traversal = bounded_traversal(scn007_adjacency(), ["INC_S007_GR"], settings.graph)
        assert len(traversal.node_ids) <= 5

    def test_ontology_expansion_injects_bound_entities(self) -> None:
        settings = make_settings().graph
        provider = load_static_provider_from_rows(
            [
                # Concept seed with six bound entities; the traversal
                # per-type cap (4) keeps only the lexicographically first
                # four, so E5/E6 must arrive via expansion.
                ("CONCEPT_X", "MAPS_TO", f"E{i}", "Incident")
                for i in range(1, 7)
            ]
        )
        traversal = bounded_traversal(provider, ["CONCEPT_X"], settings)
        assert "E5" not in traversal.node_ids
        assert "E6" not in traversal.node_ids
        expanded, counts, new_edges = expand_ontology(provider, traversal, settings, ["CONCEPT_X"])
        assert counts["CONCEPT_X"] == 2
        assert len(new_edges) == 2
        assert "E5" in expanded.node_ids
        assert "E6" in expanded.node_ids
        assert expanded.hops["E5"] == traversal.hops["CONCEPT_X"] + 1
        assert expanded.relationships["E5"] == "MAPS_TO"
        assert expanded.path_to("E6") == ["CONCEPT_X", "E6"]

    def test_transactional_edges_never_traversed(self) -> None:
        traversal = bounded_traversal(scn007_adjacency(), ["INC_S007_GR"], make_settings().graph)
        assert all(edge.rel_type != "PLAYS" for edge in traversal.edges)
        assert "PLY_1" not in traversal.node_ids

    def test_paths_replay_from_parent_links(self) -> None:
        traversal = bounded_traversal(scn007_adjacency(), ["INC_S007_GR"], make_settings().graph)
        assert traversal.path_to("INC_S007_AT") == [
            "INC_S007_GR",
            "PLV_PAYMENTS_3",
            "INC_S007_AT",
        ]
        assert traversal.path_to("INC_S007_CZ")[-1] == "INC_S007_CZ"


class TestEntitySeeds:
    def test_seed_events_emitted(self) -> None:
        pipeline = build_pipeline()
        pipeline.run("Why did checkout fail in Greece?")
        types = [event.event_type for event in pipeline.events]
        assert types[0] == GRAPH_ENTITY_RESOLUTION_STARTED
        assert GRAPH_ENTITY_RESOLVED in types
        assert GRAPH_SEED_SELECTED in types
        assert GRAPH_TRAVERSAL_STARTED in types

    def test_no_seed_falls_back_to_vector_layer(self) -> None:
        pipeline = build_pipeline(resolver=StaticEntityResolver([]))
        result = pipeline.run("checkout regression in Greece")
        origins = [
            event.payload.get("origin")
            for event in pipeline.events
            if event.event_type == GRAPH_ENTITY_RESOLVED
        ]
        assert "vector_fallback" in origins
        assert result.node_evidence, "fallback seed still produces evidence"


class TestOntologyExpansion:
    def test_concept_expansion_reaches_siblings(self) -> None:
        pipeline = build_pipeline()
        result = pipeline.run("Why did checkout fail in Greece?")
        assert result.ontology_concepts == ["CONCEPT_PLATFORM_INCIDENT"]
        candidate_ids = {evidence.node_id for evidence in result.node_evidence}
        assert "INC_S007_AT" in candidate_ids
        assert "INC_S007_CZ" in candidate_ids

    def test_pipeline_b_excludes_ontology(self) -> None:
        settings = make_settings(graph=make_settings().graph.without_ontology())
        pipeline = build_pipeline(settings)
        result = pipeline.run("Why did checkout fail in Greece?")
        assert result.ontology_concepts == []
        seeds = [
            event.payload["node_id"]
            for event in pipeline.events
            if event.event_type == GRAPH_SEED_SELECTED
        ]
        assert "CONCEPT_PLATFORM_INCIDENT" not in seeds
        rels = {
            event.payload["relationship_type"]
            for event in pipeline.events
            if event.event_type == GRAPH_RELATIONSHIP_TRAVERSED
        }
        assert "MAPS_TO" not in rels


class TestRankingAndEvidence:
    def test_platform_version_and_uk_document_surface(self) -> None:
        pipeline = build_pipeline()
        result = pipeline.run("Why did checkout fail in Greece?")
        node_ids = {evidence.node_id for evidence in result.node_evidence if evidence.selected}
        assert "PLV_PAYMENTS_3" in node_ids
        # Documents do not travel through the graph layer: the UK release
        # note enters the context through the shared vector channel, the
        # same one pipeline A uses.
        chunk_ids = {chunk.chunk_id for chunk in result.document_evidence}
        assert "CHNK_S007_UK_00" in chunk_ids
        assert all(chunk.discovered_via == "vector" for chunk in result.document_evidence)
        # Cross-market siblings are reached through ontology expansion; with
        # authoritative summaries (real runs) they rank into the selected set
        # (asserted in the live test). Offline they are recorded candidates.
        candidate_ids = {evidence.node_id for evidence in result.node_evidence}
        assert "INC_S007_AT" in candidate_ids

    def test_score_components_recorded(self) -> None:
        pipeline = build_pipeline()
        result = pipeline.run("Why did checkout fail in Greece?")
        for evidence in result.node_evidence:
            assert set(evidence.components) == {
                "graph_distance",
                "relationship_type",
                "semantic_relevance",
                "temporal_validity",
            }
        top = result.node_evidence[0]
        weights = DEFAULT_RANKING_WEIGHTS
        expected = (
            weights.graph_distance * top.components["graph_distance"]
            + weights.relationship_type * top.components["relationship_type"]
            + weights.semantic_relevance * top.components["semantic_relevance"]
            + weights.temporal_validity * top.components["temporal_validity"]
        )
        assert abs(top.score - expected) < 0.001

    def test_beyond_limit_nodes_discarded_with_reason(self) -> None:
        settings = make_settings()
        graph_settings = dataclasses.replace(settings.graph, max_evidence_nodes=2)
        settings = dataclasses.replace(settings, graph=graph_settings)
        pipeline = build_pipeline(settings)
        result = pipeline.run("Why did checkout fail in Greece?")
        discarded = [evidence for evidence in result.node_evidence if not evidence.selected]
        assert discarded
        assert all(evidence.discard_reason == "below_score_limit" for evidence in discarded)
        assert sum(
            event.event_type == GRAPH_CANDIDATE_DISCARDED for event in pipeline.events
        ) >= len(discarded)

    def test_document_chunks_reached_through_graph(self) -> None:
        pipeline = build_pipeline()
        result = pipeline.run("Why did checkout fail in Greece?")
        chunk_ids = {chunk.chunk_id for chunk in result.document_evidence}
        assert "CHNK_S007_UK_00" in chunk_ids


class TestSourceLookup:
    def test_authoritative_facts_attached(self, tmp_path) -> None:  # type: ignore[no-untyped-def]
        source_dir = tmp_path / "ds"
        source_dir.mkdir()
        import duckdb

        connection = duckdb.connect()
        incident_path = source_dir / "incidents.parquet"
        connection.execute(
            "COPY ("
            "SELECT * FROM (VALUES"
            " ('INC_S007_GR','MKT_GR','PLT_PAYMENTS','PLV_PAYMENTS_3',NULL,"
            "  'INC_PAYMENTS','HIGH',TIMESTAMP '2025-05-21',TIMESTAMP '2025-05-23',"
            "  'Payment checkout failures','RC_77'))"
            " AS t(incident_id, market_id, platform_id, platform_version_id,"
            " app_version_id, incident_type, severity, started_at, resolved_at,"
            " summary, root_cause_code)"
            f") TO '{incident_path}' (FORMAT PARQUET)"
        )
        connection.close()

        pipeline = build_pipeline(
            settings=make_settings(dataset_dir=str(source_dir)),
        )
        pipeline.source_lookup = SourceLookup(source_dir)
        result = pipeline.run("Why did checkout fail in Greece?")

        incident = next(
            evidence for evidence in result.node_evidence if evidence.node_id == "INC_S007_GR"
        )
        assert incident.authoritative is not None
        assert incident.authoritative["severity"] == "HIGH"
        assert incident.authoritative["source_table"] == "incidents"


class TestTelemetryAndDeterminism:
    def test_generation_and_completion_events_present(self) -> None:
        pipeline = build_pipeline()
        pipeline.run("Why did checkout fail in Greece?")
        types = [event.event_type for event in pipeline.events]
        assert types[-1] == GRAPH_GENERATION_COMPLETED
        assert GRAPH_EVIDENCE_PATH_COMPLETED in types
        assert GRAPH_CONTEXT_ASSEMBLED in types
        assert sum(event.event_type == GRAPH_CANDIDATE_SELECTED for event in pipeline.events) >= 1

    def test_deterministic_across_runs(self) -> None:
        first = build_pipeline().run("Why did checkout fail in Greece?")
        second = build_pipeline().run("Why did checkout fail in Greece?")
        assert [e.node_id for e in first.node_evidence] == [e.node_id for e in second.node_evidence]
        assert first.answer.text == second.answer.text

    def test_empty_question_rejected(self) -> None:
        with pytest.raises(ValueError, match="empty"):
            build_pipeline().run(" ")
