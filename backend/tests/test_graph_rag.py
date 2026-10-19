"""GraphRAG pipeline tests (docs/08 Phase 9) without Neo4j.

The bounded walk runs over a static neighbour provider modelling the planted
SCN-007 neighbourhood from the development world; ranking, limits, ontology
expansion, telemetry and determinism are covered offline. A live-graph test
(`test_graph_rag_live.py`) covers the real adapter under GRAPH_E2E=1.
"""

from __future__ import annotations

import dataclasses
from datetime import date
from pathlib import Path
from typing import ClassVar

import pytest
from app.config import (
    DEFAULT_RANKING_WEIGHTS,
    DEFAULT_REFERENCE_DATE,
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
    GRAPH_CANDIDATE_RERANKED,
    GRAPH_CANDIDATE_SELECTED,
    GRAPH_CONTEXT_ASSEMBLED,
    GRAPH_ENTITY_RESOLUTION_STARTED,
    GRAPH_ENTITY_RESOLVED,
    GRAPH_EVIDENCE_PATH_COMPLETED,
    GRAPH_GENERATION_COMPLETED,
    GRAPH_NODE_DISCOVERED,
    GRAPH_QUERY_EXPANDED,
    GRAPH_RELATIONSHIP_TRAVERSED,
    GRAPH_SEED_SELECTED,
    GRAPH_TRAVERSAL_STARTED,
)
from app.evidence import EvidenceChunk
from app.ontology.loader import load_ontology
from app.retrieval.graph.pipeline import GraphRagPipeline
from app.retrieval.graph.ranking import score_nodes, temporal_validity
from app.retrieval.graph.resolution import (
    QueryExpansion,
    ResolvedEntity,
    StaticEntityResolver,
    concept_text,
)
from app.retrieval.graph.source_lookup import (
    RECORD_LABELS,
    AuthoritativeFacts,
    SourceLookup,
    label_for_table,
)
from app.retrieval.graph.traversal import (
    NeighbourEdge,
    StaticNeighbourProvider,
    bounded_traversal,
    expand_ontology,
    load_static_provider_from_rows,
)
from app.retrieval.standard.context import SELECTION_EXCLUDED_LABEL, SELECTION_SUPERSEDED
from app.retrieval.standard.corpus import CorpusChunk
from app.retrieval.standard.embeddings import HashingEmbedder
from app.retrieval.standard.generation import (
    FakeAnswerGenerator,
    GenerationOutput,
    context_block,
)
from app.retrieval.standard.index import index_corpus
from app.retrieval.standard.reranking import LexicalReranker, build_reranker
from app.retrieval.standard.sparse import HashingSparseEmbedder, SparseVector
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
        "rerank": RerankSettings(provider="lexical", model="unused", lexical_weight=0.3),
        "generation": GenerationSettings(
            provider="fake", model="fake-answer-v1", temperature=0.0, api_base=None
        ),
        "graph": GraphRagSettings(
            max_depth=2,
            max_nodes_per_hop=100,
            max_edges_per_node_type=4,
            max_total_nodes=200,
            relationship_types=DEFAULT_RELATIONSHIP_TYPES,
            ontology_expansion=True,
            ranking=DEFAULT_RANKING_WEIGHTS,
            reference_date=DEFAULT_REFERENCE_DATE,
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
    expansion: QueryExpansion | None = None,
) -> GraphRagPipeline:
    settings = settings or make_settings()
    embeddings = HashingEmbedder(dimensions=settings.embedding.dimensions)
    corpus = build_corpus()
    store = InMemoryVectorStore()
    sparse = HashingSparseEmbedder()
    index_corpus(store, embeddings, sparse, list(corpus.values()))
    return GraphRagPipeline(
        resolver=resolver or StaticEntityResolver(resolved()),
        neighbours=scn007_adjacency(),
        embeddings=embeddings,
        sparse=sparse,
        store=store,
        generator=FakeAnswerGenerator(),
        settings=settings,
        reranker=build_reranker(settings),
        expansion=expansion,
    )


class RecordingSparseEmbedder(HashingSparseEmbedder):
    """Hashing sparse embedder that records every query text it embeds."""

    def __init__(self) -> None:
        super().__init__()
        self.queries: list[str] = []

    def embed_query(self, text: str) -> SparseVector:
        self.queries.append(text)
        return super().embed_query(text)


class TestBoundedTraversal:
    def test_depth_and_limits_respected(self) -> None:
        settings = make_settings(
            graph=GraphRagSettings(
                max_depth=1,
                max_nodes_per_hop=3,
                max_edges_per_node_type=1,
                max_total_nodes=200,
                relationship_types=("AFFECTS", "AFFECTS_MARKET", "RELATED_TO"),
                ontology_expansion=True,
                ranking=DEFAULT_RANKING_WEIGHTS,
                reference_date=DEFAULT_REFERENCE_DATE,
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
                relationship_types=DEFAULT_RELATIONSHIP_TYPES,
                ontology_expansion=True,
                ranking=DEFAULT_RANKING_WEIGHTS,
                reference_date=DEFAULT_REFERENCE_DATE,
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
        expanded, counts, new_edges = expand_ontology(
            provider, traversal, settings, ["CONCEPT_X"], lambda c: [0.0] * len(c)
        )
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


class TestQueryExpansionInPipeline:
    QUESTION = "Why did checkout fail in Greece?"

    @staticmethod
    def _concept_entities() -> list[ResolvedEntity]:
        return [
            *resolved(),
            ResolvedEntity(
                entity_id="CONCEPT_PLATFORM_INCIDENT",
                node_label="BusinessConcept",
                matched_text="platform incident",
                origin="term",
                confidence=0.8,
            ),
        ]

    def _run(self, expansion: QueryExpansion | None) -> tuple[GraphRagPipeline, list[str]]:
        sparse = RecordingSparseEmbedder()
        pipeline = build_pipeline(
            resolver=StaticEntityResolver(self._concept_entities()), expansion=expansion
        )
        pipeline.sparse = sparse
        pipeline.run(self.QUESTION)
        return pipeline, sparse.queries

    def test_pipeline_c_searches_with_the_expanded_question(self) -> None:
        expansion = QueryExpansion(load_ontology())
        expanded = expansion.expand(self.QUESTION, self._concept_entities())
        pipeline, queries = self._run(expansion)
        assert expanded.added_terms
        assert expanded.text.startswith(f"{self.QUESTION}\n")
        assert queries == [expanded.text]
        event = next(e for e in pipeline.events if e.event_type == GRAPH_QUERY_EXPANDED)
        assert event.payload == {
            "added_terms": len(expanded.added_terms),
            "expanded_length": len(expanded.text),
        }

    def test_pipelines_without_expansion_search_with_the_raw_question(self) -> None:
        pipeline, queries = self._run(None)
        assert queries == [self.QUESTION]
        assert all(e.event_type != GRAPH_QUERY_EXPANDED for e in pipeline.events)

    def test_resolved_events_carry_via_concept(self) -> None:
        binding = ResolvedEntity(
            entity_id="INC_S007_GR",
            node_label="Incident",
            matched_text="platform incident",
            origin="concept_binding",
            confidence=0.7,
            via_concept="CONCEPT_PLATFORM_INCIDENT",
        )
        pipeline = build_pipeline(resolver=StaticEntityResolver([binding]))
        pipeline.run(self.QUESTION)
        event = next(e for e in pipeline.events if e.event_type == GRAPH_ENTITY_RESOLVED)
        assert event.payload["via_concept"] == "CONCEPT_PLATFORM_INCIDENT"

    def test_injected_nodes_carry_via_concept(self) -> None:
        concept = ResolvedEntity(
            entity_id="CONCEPT_X",
            node_label="BusinessConcept",
            matched_text="x",
            origin="term",
            confidence=0.8,
        )
        pipeline = build_pipeline(resolver=StaticEntityResolver([concept]))
        pipeline.neighbours = load_static_provider_from_rows(
            [("CONCEPT_X", "MAPS_TO", f"E{i}", "Incident") for i in range(1, 7)]
        )
        pipeline.run(self.QUESTION)
        discovered = {
            str(e.payload["node_id"]): e.payload
            for e in pipeline.events
            if e.event_type == GRAPH_NODE_DISCOVERED
        }
        # Traversal takes E1-E4 (per-type cap 4); expansion injects E5 and E6.
        assert "via_concept" not in discovered["E1"]
        assert discovered["E5"]["via_concept"] == "CONCEPT_X"
        assert discovered["E6"]["via_concept"] == "CONCEPT_X"


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

    def test_hit_absent_from_corpus_still_becomes_evidence(self) -> None:
        pipeline = build_pipeline()
        extra = dataclasses.replace(
            build_corpus()["CHNK_S007_UK_00"], chunk_id="CHNK_EXTRA_00", document_id="DOC_EXTRA"
        )
        index_corpus(pipeline.store, pipeline.embeddings, pipeline.sparse, [extra])
        result = pipeline.run("Why did checkout fail in Greece?")
        evidence = {chunk.chunk_id: chunk for chunk in result.document_evidence}
        assert "CHNK_EXTRA_00" in evidence
        assert evidence["CHNK_EXTRA_00"].dense_rank is not None
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

    def test_beyond_slot_nodes_discarded_with_reason(self) -> None:
        settings = make_settings()
        context = dataclasses.replace(settings.context, evidence_slots=2)
        settings = dataclasses.replace(settings, context=context)
        pipeline = build_pipeline(settings)
        result = pipeline.run("Why did checkout fail in Greece?")
        discarded = [evidence for evidence in result.node_evidence if not evidence.selected]
        assert discarded
        assert all(evidence.discard_reason == "slot_limit" for evidence in discarded)
        selected_documents = [chunk for chunk in result.document_evidence if chunk.selected]
        assert sum(e.selected for e in result.node_evidence) + len(selected_documents) == 2
        assert sum(
            event.event_type == GRAPH_CANDIDATE_DISCARDED for event in pipeline.events
        ) >= len(discarded)

    def test_document_chunks_reached_through_graph(self) -> None:
        pipeline = build_pipeline()
        result = pipeline.run("Why did checkout fail in Greece?")
        chunk_ids = {chunk.chunk_id for chunk in result.document_evidence}
        assert "CHNK_S007_UK_00" in chunk_ids


def test_superseded_record_ranks_lower_than_current() -> None:
    reference = date(2026, 1, 1)
    assert temporal_validity(date(2025, 6, 1), reference) == 0.3
    assert temporal_validity(None, reference) == 1.0
    assert temporal_validity(date(2026, 1, 1), reference) == 1.0


def test_score_nodes_ranks_superseded_below_current_when_otherwise_equal() -> None:
    settings = make_settings(
        graph=GraphRagSettings(
            max_depth=1,
            max_nodes_per_hop=100,
            max_edges_per_node_type=4,
            max_total_nodes=200,
            relationship_types=("AFFECTS", "AFFECTS_MARKET"),
            ontology_expansion=True,
            ranking=DEFAULT_RANKING_WEIGHTS,
            reference_date=DEFAULT_REFERENCE_DATE,
        )
    )
    traversal = bounded_traversal(scn007_adjacency(), ["INC_S007_GR"], settings.graph)
    labels = {"GAME_GR_01": "Game", "MKT_GR": "Market", "INC_S007_GR": "Incident"}
    scored = score_nodes(
        traversal,
        labels,
        {},
        DEFAULT_RANKING_WEIGHTS,
        validity={"GAME_GR_01": date(2025, 3, 1)},
        reference=date(2026, 1, 1),
    )
    by_id = {node.node_id: node for node in scored}
    assert by_id["GAME_GR_01"].components["temporal_validity"] == 0.3
    assert by_id["MKT_GR"].components["temporal_validity"] == 1.0
    assert by_id["GAME_GR_01"].score < by_id["MKT_GR"].score


def _facts(table: str, **columns: str) -> AuthoritativeFacts:
    return AuthoritativeFacts("X", "Game", table, "X", columns)


def test_authoritative_facts_valid_to_parses_date_and_timestamp() -> None:
    assert _facts("games", retirement_date="2025-03-01").valid_to == date(2025, 3, 1)
    assert _facts("experiments", end_at="2025-07-04 12:30:00").valid_to == date(2025, 7, 4)
    assert _facts("games", retirement_date="-").valid_to is None
    assert _facts("incidents", resolved_at="2025-05-23 00:00:00").valid_to is None


class TestSourceLookup:
    def test_retired_game_reports_superseded_validity(self, tmp_path) -> None:  # type: ignore[no-untyped-def]
        import duckdb

        connection = duckdb.connect()
        connection.execute(
            "COPY (SELECT * FROM (VALUES"
            " ('GAME_GR_01','Xysimo','MKT_GR','FAM_GR_1',2.0,'EUR',DATE '2025-03-01'))"
            " AS t(game_id, game_name, market_id, game_family_id, ticket_price,"
            " currency_code, retirement_date)"
            f") TO '{tmp_path / 'games.parquet'}' (FORMAT PARQUET)"
        )
        connection.close()
        pipeline = build_pipeline(settings=make_settings(dataset_dir=str(tmp_path)))
        pipeline.source_lookup = SourceLookup(tmp_path, {})
        result = pipeline.run("Why did checkout fail in Greece?")
        components = {e.node_id: e.components["temporal_validity"] for e in result.node_evidence}
        assert components["GAME_GR_01"] == 0.3
        assert components["INC_S007_GR"] == 1.0

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
        pipeline.source_lookup = SourceLookup(source_dir, {})
        result = pipeline.run("Why did checkout fail in Greece?")

        incident = next(
            evidence for evidence in result.node_evidence if evidence.node_id == "INC_S007_GR"
        )
        assert incident.authoritative is not None
        assert incident.authoritative["severity"] == "HIGH"
        assert incident.authoritative["source_table"] == "incidents"


class TestMarketScope:
    @staticmethod
    def _incidents_dir(tmp_path) -> Path:  # type: ignore[no-untyped-def]
        source_dir = tmp_path / "ds-scope"
        source_dir.mkdir()
        import duckdb

        connection = duckdb.connect()
        incident_path = source_dir / "incidents.parquet"
        connection.execute(
            "COPY ("
            "SELECT * FROM (VALUES"
            " ('INC_S007_GR','MKT_GR','PLT_PAYMENTS','PLV_PAYMENTS_3',NULL,"
            "  'INC_PAYMENTS','HIGH',TIMESTAMP '2025-05-21',TIMESTAMP '2025-05-23',"
            "  'Payment checkout failures','RC_77'),"
            " ('INC_S007_AT','MKT_AT','PLT_PAYMENTS','PLV_PAYMENTS_3',NULL,"
            "  'INC_PAYMENTS','MEDIUM',TIMESTAMP '2025-05-22',TIMESTAMP '2025-05-23',"
            "  'Payment checkout failures','RC_77'))"
            " AS t(incident_id, market_id, platform_id, platform_version_id,"
            " app_version_id, incident_type, severity, started_at, resolved_at,"
            " summary, root_cause_code)"
            f") TO '{incident_path}' (FORMAT PARQUET)"
        )
        connection.close()
        return source_dir

    @classmethod
    def _scope_pipeline(cls, tmp_path) -> GraphRagPipeline:  # type: ignore[no-untyped-def]
        """GR seed whose out-of-scope sibling INC_S007_AT (MKT_AT facts)
        is one RELATED_TO hop away (labelled, like the real adapter)."""
        source_dir = cls._incidents_dir(tmp_path)
        provider = load_static_provider_from_rows(
            [("INC_S007_GR", "RELATED_TO", "INC_S007_AT", "Incident")]
        )
        pipeline = build_pipeline(
            settings=make_settings(dataset_dir=str(source_dir)),
            resolver=StaticEntityResolver(resolved()),
        )
        pipeline.neighbours = provider
        pipeline.source_lookup = SourceLookup(source_dir, {})
        return pipeline

    def test_document_channel_is_scoped(self) -> None:
        pipeline = build_pipeline()
        result = pipeline.run("Why did checkout fail in Greece?", markets=["MKT_GR"])

        chunk_ids = {chunk.chunk_id for chunk in result.document_evidence}
        assert "CHNK_S007_GR_00" in chunk_ids
        assert "CHNK_S007_UK_00" not in chunk_ids

    def test_out_of_scope_structured_nodes_are_discarded(self, tmp_path) -> None:  # type: ignore[no-untyped-def]
        pipeline = self._scope_pipeline(tmp_path)
        result = pipeline.run("Why did checkout fail in Greece?", markets=["MKT_GR"])

        selected = {evidence.node_id for evidence in result.node_evidence if evidence.selected}
        assert "INC_S007_GR" in selected
        assert "INC_S007_AT" not in selected
        discards = [
            event
            for event in pipeline.events
            if event.event_type == GRAPH_CANDIDATE_DISCARDED
            and event.payload.get("node_id") == "INC_S007_AT"
        ]
        assert discards, "the out-of-scope sibling must be recorded as discarded"
        assert discards[0].payload["reason"] == "out_of_scope_market"

    def test_unscoped_run_keeps_the_cross_market_sibling(self, tmp_path) -> None:  # type: ignore[no-untyped-def]
        pipeline = self._scope_pipeline(tmp_path)
        result = pipeline.run("Why did checkout fail in Greece?")

        selected = {evidence.node_id for evidence in result.node_evidence if evidence.selected}
        assert {"INC_S007_GR", "INC_S007_AT"} <= selected

    def test_scope_is_recorded_on_the_resolution_event(self, tmp_path) -> None:  # type: ignore[no-untyped-def]
        pipeline = self._scope_pipeline(tmp_path)
        pipeline.run("Why did checkout fail in Greece?", markets=["MKT_GR"])

        assert pipeline.events[0].event_type == GRAPH_ENTITY_RESOLUTION_STARTED
        assert pipeline.events[0].payload["markets"] == "MKT_GR"


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


def test_every_structured_label_resolves_to_a_real_source_table() -> None:
    from app.datasets.schema import TABLE_SCHEMAS, split_columns
    from app.retrieval.graph.ranking import STRUCTURED_LABELS
    from app.retrieval.graph.source_lookup import LINK_COLUMNS, NODE_SOURCES, SNIPPET_COLUMNS

    assert set(NODE_SOURCES) == STRUCTURED_LABELS
    for label in STRUCTURED_LABELS:
        table, id_column = NODE_SOURCES[label]
        assert table in TABLE_SCHEMAS, label
        columns = {name for name, _ in split_columns(TABLE_SCHEMAS[table])}
        assert id_column in columns, label
        # PaymentMethod resolves through its player link table, rendered by LINK_COLUMNS.
        snippet = LINK_COLUMNS if label == "PaymentMethod" else SNIPPET_COLUMNS[table]
        assert snippet, label
        assert set(snippet) <= columns, label


class RecordingReranker(LexicalReranker):
    """The lexical reranker, recording every (question, candidates) call."""

    def __init__(self) -> None:
        super().__init__(lexical_weight=0.3)
        self.calls: list[tuple[str, list[EvidenceChunk]]] = []

    def rerank(self, question: str, candidates: list[EvidenceChunk]) -> list[EvidenceChunk]:
        self.calls.append((question, list(candidates)))
        return super().rerank(question, candidates)


class PromptCapture(FakeAnswerGenerator):
    """The fake generator, keeping the structured blocks it was shown."""

    def __init__(self) -> None:
        super().__init__()
        self.extra_blocks: list[str] = []

    def generate(
        self,
        question: str,
        contexts: list[EvidenceChunk],
        extra_blocks: list[str] | None = None,
    ) -> GenerationOutput:
        self.extra_blocks = list(extra_blocks or [])
        return super().generate(question, contexts, extra_blocks)


def record_corpus_chunk(table: str, record_id: str, text: str) -> CorpusChunk:
    return CorpusChunk(
        chunk_id=f"REC_{table}_{record_id}",
        document_id=record_id,
        chunk_index=0,
        text=text,
        title=f"{table}: {record_id}",
        document_type=table.upper(),
        market_id="MKT_GR",
        language_code="en",
        source_system="warehouse",
        valid_from=None,
        valid_to=None,
        kind="record",
        record_table=table,
    )


QUESTION = "Why did checkout fail in Greece?"


class TestOneJudgeSelection:
    def test_one_rerank_call_judges_nodes_and_documents_on_the_raw_question(self) -> None:
        concept = ResolvedEntity(
            "CONCEPT_PLATFORM_INCIDENT", "BusinessConcept", "platform incident", "term", 0.8
        )
        pipeline = build_pipeline(
            resolver=StaticEntityResolver([*resolved(), concept]),
            expansion=QueryExpansion(load_ontology()),
        )
        reranker = RecordingReranker()
        pipeline.reranker = reranker
        pipeline.run(QUESTION)
        assert len(reranker.calls) == 1
        question, candidates = reranker.calls[0]
        assert question == QUESTION  # expansion feeds retrieval, never the judge
        assert {candidate.kind for candidate in candidates} == {"node", "chunk"}

    def test_reranked_events_cover_every_judged_candidate(self) -> None:
        pipeline = build_pipeline()
        reranker = RecordingReranker()
        pipeline.reranker = reranker
        pipeline.run(QUESTION)
        events = [e for e in pipeline.events if e.event_type == GRAPH_CANDIDATE_RERANKED]
        judged = reranker.calls[0][1]
        assert len(events) == len(judged)
        assert {str(e.payload["kind"]) for e in events} == {"node", "chunk"}
        assert all(
            set(e.payload) == {"candidate_id", "kind", "rerank_score", "rank"} for e in events
        )
        assert [e.payload["rank"] for e in events] == list(range(1, len(judged) + 1))
        outcomes = [
            e
            for e in pipeline.events
            if e.event_type in (GRAPH_CANDIDATE_SELECTED, GRAPH_CANDIDATE_DISCARDED)
        ]
        assert outcomes and all("rerank_score" in e.payload for e in outcomes)

    def test_every_traversal_node_reaches_the_judge(self) -> None:
        pipeline = build_pipeline()
        reranker = RecordingReranker()
        pipeline.reranker = reranker
        result = pipeline.run(QUESTION)
        judged_nodes = [c.chunk_id for c in reranker.calls[0][1] if c.kind == "node"]
        assert judged_nodes == [e.node_id for e in result.node_evidence]
        assert all(e.rerank_score is not None for e in result.node_evidence)

    def test_a_resolved_document_seeds_traversal_but_is_never_a_candidate(self) -> None:
        document = ResolvedEntity("DOC_9", "Document", "DOC_9", "id", 1.0)
        pipeline = build_pipeline(resolver=StaticEntityResolver([document]))
        pipeline.neighbours = load_static_provider_from_rows(
            [("DOC_9", "FROM_MARKET", "MKT_GR", "Market")]
        )
        reranker = RecordingReranker()
        pipeline.reranker = reranker
        result = pipeline.run(QUESTION)
        seeds = [
            e.payload["node_id"] for e in pipeline.events if e.event_type == GRAPH_SEED_SELECTED
        ]
        assert seeds == ["DOC_9"]
        judged = {c.chunk_id for c in reranker.calls[0][1] if c.kind == "node"}
        assert judged == {"MKT_GR"}
        outcome = {e.node_id: e.discard_reason for e in result.node_evidence}
        assert outcome["DOC_9"] == SELECTION_EXCLUDED_LABEL
        discards = [
            e
            for e in pipeline.events
            if e.event_type == GRAPH_CANDIDATE_DISCARDED and e.payload.get("node_id") == "DOC_9"
        ]
        assert [e.payload["reason"] for e in discards] == [SELECTION_EXCLUDED_LABEL]
        assert discards[0].payload["rerank_score"] is None
        # The document's text still reaches the judge through the document channel.
        assert any(c.kind == "chunk" for c in reranker.calls[0][1])


class TestFallbackSeed:
    def test_fallback_seeds_the_graph_node_of_the_best_record(self) -> None:
        pipeline = build_pipeline(resolver=StaticEntityResolver([]))
        record = record_corpus_chunk(
            "incidents", "INC_S007_GR", "Incident INC_S007_GR in Greece: checkout failed."
        )
        index_corpus(pipeline.store, pipeline.embeddings, pipeline.sparse, [record])
        result = pipeline.run("checkout regression in Greece")
        seeds = [
            e.payload["node_id"] for e in pipeline.events if e.event_type == GRAPH_SEED_SELECTED
        ]
        assert seeds == ["INC_S007_GR"]
        fallback = next(e for e in pipeline.events if e.event_type == GRAPH_ENTITY_RESOLVED)
        assert fallback.payload["origin"] == "vector_fallback"
        assert fallback.payload["node_label"] == "Incident"
        seed = next(e for e in result.node_evidence if e.node_id == "INC_S007_GR")
        assert seed.node_label == "Incident" and seed.hops == 0
        assert any(e.hops > 0 for e in result.node_evidence), "the seed is traversable"

    def test_no_record_hit_means_no_seed(self) -> None:
        pipeline = build_pipeline(resolver=StaticEntityResolver([]))
        result = pipeline.run("checkout regression in Greece")
        types = {e.event_type for e in pipeline.events}
        assert GRAPH_SEED_SELECTED not in types
        assert GRAPH_ENTITY_RESOLVED not in types
        assert result.node_evidence == []
        assert any(chunk.selected for chunk in result.document_evidence)

    def test_label_for_table_inverts_the_record_tables(self) -> None:
        from app.retrieval.standard.records import SERIALISERS

        assert set(RECORD_LABELS) == set(SERIALISERS)
        assert label_for_table("incidents") == "Incident"
        assert label_for_table("game_mechanics") == "GameMechanic"
        assert label_for_table("payment_methods") == "PaymentMethod"
        assert label_for_table("devices") == "Device"
        assert label_for_table("kpi_daily") is None


class TestExcludedLabels:
    ROWS: ClassVar[list[tuple[str, str, str, str]]] = [
        ("INC_1", "REFERENCES", "DOC_1", "Document"),
        # Same relationship type: the document sorts first and must not take
        # the incident's place under the per-type cap.
        ("INC_1", "RELATED_TO", "DOC_2", "Document"),
        ("INC_1", "RELATED_TO", "INC_2", "Incident"),
        ("INC_1", "MAPS_TO", "CONCEPT_X", "BusinessConcept"),
        ("CONCEPT_X", "MAPS_TO", "DOC_3", "Document"),
        ("CONCEPT_X", "MAPS_TO", "INC_3", "Incident"),
    ]

    @staticmethod
    def _settings(excluded: tuple[str, ...]) -> GraphRagSettings:
        return dataclasses.replace(
            make_settings().graph,
            max_depth=1,
            max_edges_per_node_type=1,
            relationship_types=("MAPS_TO", "REFERENCES", "RELATED_TO"),
            excluded_labels=excluded,
        )

    def test_documents_are_excluded_by_default_and_in_pipeline_b(self) -> None:
        graph = make_settings().graph
        assert graph.excluded_labels == ("Document",)
        assert graph.without_ontology().excluded_labels == ("Document",)

    def test_document_targets_are_never_traversed_or_recorded(self) -> None:
        provider = load_static_provider_from_rows(self.ROWS)
        settings = self._settings(("Document",))
        traversal = bounded_traversal(provider, ["INC_1"], settings)
        assert traversal.node_ids == ["INC_1", "CONCEPT_X", "INC_2"]
        assert all(edge.to_label != "Document" for edge in traversal.edges)
        expanded, counts, new_edges = expand_ontology(
            provider, traversal, settings, ["CONCEPT_X"], lambda c: [0.0] * len(c)
        )
        assert [edge.to_id for edge in new_edges] == ["INC_3"]
        assert counts == {"CONCEPT_X": 1}
        assert "DOC_3" not in expanded.node_ids

    def test_without_exclusion_the_same_walk_reaches_documents(self) -> None:
        provider = load_static_provider_from_rows(self.ROWS)
        traversal = bounded_traversal(provider, ["INC_1"], self._settings(()))
        assert {"DOC_1", "DOC_2"} <= set(traversal.node_ids)
        assert "INC_2" not in traversal.node_ids


class TestNodeText:
    RECORD_TEXT = (
        "Incident INC_S007_GR in Greece: Payment checkout failures. Severity HIGH. "
        "Source: incident_management table incidents, record INC_S007_GR."
    )

    def test_a_node_with_a_record_block_is_judged_on_the_record_text(self, tmp_path) -> None:  # type: ignore[no-untyped-def]
        pipeline = build_pipeline()
        pipeline.source_lookup = SourceLookup(
            tmp_path, {("incidents", "INC_S007_GR"): self.RECORD_TEXT}
        )
        reranker, generator = RecordingReranker(), PromptCapture()
        pipeline.reranker, pipeline.generator = reranker, generator
        pipeline.run(QUESTION)
        node = next(c for c in reranker.calls[0][1] if c.chunk_id == "INC_S007_GR")
        assert node.text == self.RECORD_TEXT
        # Formatted exactly like a document block: title line, then the text.
        assert context_block(node) in generator.extra_blocks
        assert all("Graph path" not in block for block in generator.extra_blocks)

    def test_a_node_superseding_a_record_reuses_its_title_and_language(self, tmp_path) -> None:  # type: ignore[no-untyped-def]
        """Same fact, same block: the generator sees A's record block in B and C."""
        pipeline = build_pipeline()
        record = record_corpus_chunk("incidents", "INC_S007_GR", self.RECORD_TEXT)
        index_corpus(pipeline.store, pipeline.embeddings, pipeline.sparse, [record])
        pipeline.source_lookup = SourceLookup(
            tmp_path, {("incidents", "INC_S007_GR"): self.RECORD_TEXT}
        )
        reranker = RecordingReranker()
        pipeline.reranker = reranker
        result = pipeline.run(QUESTION)
        superseded = [
            c for c in result.document_evidence if c.discard_reason == SELECTION_SUPERSEDED
        ]
        assert [c.chunk_id for c in superseded] == [record.chunk_id]
        judged = {c.chunk_id: c for c in reranker.calls[0][1] if c.kind == "node"}
        node = judged["INC_S007_GR"]
        assert (node.title, node.language_code) == (record.title, record.language_code)
        # A node without a record block keeps its graph title.
        assert judged["GAME_GR_01"].title == "Game: GAME_GR_01"

    def test_a_node_without_a_record_block_gets_one_humanised_sentence(self, tmp_path) -> None:  # type: ignore[no-untyped-def]
        import duckdb

        connection = duckdb.connect()
        connection.execute(
            "COPY (SELECT * FROM (VALUES"
            " ('SUP_1','MKT_UK','SUPC_UK_GAME',CAST(NULL AS TIMESTAMP),'Login failed'))"
            " AS t(support_case_id, market_id, category_code, opened_at, summary_text)"
            f") TO '{tmp_path / 'support_cases.parquet'}' (FORMAT PARQUET)"
        )
        connection.close()
        lookup = SourceLookup(tmp_path, {})
        assert lookup.node_text("SupportCase", "SUP_1") == (
            "SupportCase SUP_1: market id MKT_UK, category code SUPC_UK_GAME, "
            "summary text Login failed"
        )
        assert lookup.node_text("Supplier", "SUPP_1") == "Supplier SUPP_1"

    def test_concept_text_comes_from_the_ontology(self) -> None:
        ontology = load_ontology()
        assert concept_text(ontology.concept("CONCEPT_PLATFORM_INCIDENT")) == (
            "Concept Platform incident: An incident on one of the operator's technology "
            "platforms. Labels: en: Platform incident; el: Περιστατικό πλατφόρμας; "
            "de: Plattformstörung; cs: Incident platformy. Synonyms: en: platform outage; "
            "el: βλάβη πλατφόρμας; de: Plattformausfall; cs: výpadek platformy."
        )

    def test_pipeline_c_judges_concept_nodes_on_their_ontology_text(self) -> None:
        ontology = load_ontology()
        pipeline = build_pipeline()
        pipeline.ontology = ontology
        reranker = RecordingReranker()
        pipeline.reranker = reranker
        pipeline.run(QUESTION)
        concept = next(c for c in reranker.calls[0][1] if c.chunk_id == "CONCEPT_PLATFORM_INCIDENT")
        assert concept.text == concept_text(ontology.concept("CONCEPT_PLATFORM_INCIDENT"))
