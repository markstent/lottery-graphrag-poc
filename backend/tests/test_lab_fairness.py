"""Lab fairness tests (docs/08 Phase 12): the B/C contract is structural.

Pipeline B must be exactly pipeline C minus ontology traversal, so any
measured B/C difference is attributable to the ontology layer and not to
divergent configuration. These tests pin that contract offline.
"""

from __future__ import annotations

import dataclasses
from pathlib import Path

import pytest
from app.config import RetrievalSettings
from app.graph.statements import ONTOLOGY_RELATIONSHIP_TYPES
from app.retrieval.graph.lab import Lab, bc_graph_settings, graph_pipelines
from app.retrieval.graph.neo4j_adapter import build_resolvers
from app.retrieval.graph.pipeline import GraphRagPipeline
from app.retrieval.graph.resolution import (
    IdEntityResolver,
    QueryExpansion,
    StaticEntityResolver,
    TermEntityResolver,
)
from app.retrieval.graph.source_lookup import SourceLookup
from app.retrieval.graph.traversal import load_static_provider_from_rows
from app.retrieval.standard.index import index_corpus

from tests.conftest import build_lab_offline
from tests.test_graph_rag import (
    PromptCapture,
    RecordingReranker,
    build_corpus,
    make_settings,
    record_corpus_chunk,
    resolved,
    scn007_adjacency,
)


def diff_labels(base_settings: object, other: object) -> list[str]:
    """Top-level settings fields whose values differ."""
    return [
        field.name
        for field in dataclasses.fields(base_settings)  # type: ignore[arg-type]
        if getattr(base_settings, field.name) != getattr(other, field.name)
    ]


@pytest.fixture
def base() -> RetrievalSettings:
    return make_settings()


def test_b_and_c_differ_only_in_graph_traversal(base: RetrievalSettings) -> None:
    settings_b, settings_c = bc_graph_settings(base)
    assert diff_labels(base, settings_b) == ["graph"]
    assert diff_labels(base, settings_c) in ([], ["graph"])
    assert diff_labels(settings_b, settings_c) == ["graph"]
    # One total budget and evidence-slot count for A (base), B and C.
    assert settings_b.context == settings_c.context == base.context


def test_b_excludes_every_ontology_relationship_and_nothing_else(
    base: RetrievalSettings,
) -> None:
    settings_b, settings_c = bc_graph_settings(base)
    removed = set(settings_c.graph.relationship_types) - set(settings_b.graph.relationship_types)
    assert removed == set(ONTOLOGY_RELATIONSHIP_TYPES)
    assert not settings_b.graph.ontology_expansion
    assert settings_c.graph.ontology_expansion


def test_b_preserves_the_c_order_for_non_ontology_types(base: RetrievalSettings) -> None:
    settings_b, settings_c = bc_graph_settings(base)
    assert settings_c.graph.relationship_types == base.graph.relationship_types
    expected = tuple(
        rel for rel in settings_c.graph.relationship_types if rel not in ONTOLOGY_RELATIONSHIP_TYPES
    )
    assert settings_b.graph.relationship_types == expected


def test_every_question_traverses_player_instruments(base: RetrievalSettings) -> None:
    settings_b, settings_c = bc_graph_settings(base)
    for relationship in ("USES", "USES_PAYMENT"):
        assert relationship in base.graph.relationship_types
        assert relationship in settings_b.graph.relationship_types
        assert relationship in settings_c.graph.relationship_types


def test_allow_list_sizes_and_mechanic_path(base: RetrievalSettings) -> None:
    settings_b, settings_c = bc_graph_settings(base)
    assert len(settings_c.graph.relationship_types) == 22
    assert len(settings_b.graph.relationship_types) == 19
    assert "HAS_MECHANIC" in settings_b.graph.relationship_types
    assert "HAS_MECHANIC" in settings_c.graph.relationship_types


@pytest.fixture
def lab() -> Lab:
    return build_lab_offline()


@pytest.fixture
def b_and_c(lab: Lab) -> tuple[GraphRagPipeline, GraphRagPipeline]:
    pipelines = graph_pipelines(
        lab, scn007_adjacency(), StaticEntityResolver([]), StaticEntityResolver([])
    )
    assert [tag for tag, _ in pipelines] == ["B", "C"]
    b, c = (pipeline for _, pipeline in pipelines)
    return b, c


def test_lab_pipeline_a_uses_the_lab_reranker_instance(lab: Lab) -> None:
    assert lab.pipeline_a().reranker is lab.reranker


def test_a_b_c_share_every_retrieval_component(
    lab: Lab, b_and_c: tuple[GraphRagPipeline, GraphRagPipeline]
) -> None:
    a = lab.pipeline_a()
    b, c = b_and_c
    for attr in ("embeddings", "sparse", "reranker", "store", "generator"):
        assert getattr(a, attr) is getattr(b, attr) is getattr(c, attr)
        assert getattr(a, attr) is getattr(lab, attr)
    assert b.source_lookup is c.source_lookup is lab.source_lookup
    assert a.settings.top_k == b.settings.top_k == c.settings.top_k
    assert a.settings.context == b.settings.context == c.settings.context


def test_b_and_c_share_reference_date_and_ranking_weights(
    b_and_c: tuple[GraphRagPipeline, GraphRagPipeline],
) -> None:
    b, c = b_and_c
    assert b.settings.graph.reference_date == c.settings.graph.reference_date
    assert b.settings.graph.ranking == c.settings.graph.ranking


def test_b_has_no_term_resolver_and_c_has_one(lab: Lab) -> None:
    id_resolver, term_resolver = StaticEntityResolver([]), StaticEntityResolver([])
    b, c = (p for _, p in graph_pipelines(lab, scn007_adjacency(), id_resolver, term_resolver))
    assert b.resolver is id_resolver
    assert b.expansion is None
    assert c.resolver is term_resolver
    assert isinstance(c.expansion, QueryExpansion)


class StubReader:
    def lookup_node(self, node_id: str) -> tuple[str, bool] | None:
        return None

    def markets(self) -> dict[str, str]:
        return {}


def test_build_resolvers_gives_b_the_id_resolver_and_c_the_term_resolver(lab: Lab) -> None:
    ids, terms = build_resolvers(StubReader(), lab.ontology, lab.term_matcher)  # type: ignore[arg-type]
    b, c = (p for _, p in graph_pipelines(lab, scn007_adjacency(), ids, terms))
    assert isinstance(b.resolver, IdEntityResolver)
    assert isinstance(c.resolver, TermEntityResolver)
    assert b.ontology is None and c.ontology is lab.ontology
    assert b.expansion is None
    assert c.expansion is not None


def test_one_shared_judge_sees_the_same_documents_in_a_b_and_c() -> None:
    """A, B and C hand the shared reranker the same document candidates.

    No entity resolves and the static store holds no record, so B and C have
    no seed and no structured candidates: what remains is exactly A's
    document channel, judged by the same instance on the raw question.
    """
    reranker = RecordingReranker()
    lab = dataclasses.replace(build_lab_offline(), reranker=reranker)
    index_corpus(lab.store, lab.embeddings, lab.sparse, list(build_corpus().values()))
    b, c = (
        pipeline
        for _, pipeline in graph_pipelines(
            lab, scn007_adjacency(), StaticEntityResolver([]), StaticEntityResolver([])
        )
    )
    a = lab.pipeline_a()
    assert a.reranker is b.reranker is c.reranker is reranker
    question = "Why did checkout fail in Greece?"
    for pipeline in (a, b, c):
        pipeline.run(question)
    assert len(reranker.calls) == 3
    judged = [
        (asked, [(chunk.chunk_id, chunk.rank) for chunk in candidates if chunk.kind != "node"])
        for asked, candidates in reranker.calls
    ]
    assert judged[0][1], "A must judge document candidates"
    assert judged[0] == judged[1] == judged[2] == (question, judged[0][1])


def test_b_judges_a_documents_minus_the_records_its_nodes_supersede() -> None:
    """With structured candidates, B's document channel is A's minus the
    record blocks of B's own nodes (design 10a.8), in A's order and ranks."""
    reranker = RecordingReranker()
    lab = dataclasses.replace(build_lab_offline(), reranker=reranker)
    record = record_corpus_chunk(
        "incidents", "INC_S007_GR", "Incident INC_S007_GR in Greece: checkout failed."
    )
    index_corpus(lab.store, lab.embeddings, lab.sparse, [*build_corpus().values(), record])
    (_, b), _c = graph_pipelines(
        lab, scn007_adjacency(), StaticEntityResolver(resolved()), StaticEntityResolver([])
    )
    question = "Why did checkout fail in Greece?"
    lab.pipeline_a().run(question)
    b.run(question)
    (asked_a, judged_a), (asked_b, judged_b) = reranker.calls
    assert asked_a == asked_b == question
    nodes_b = {chunk.chunk_id for chunk in judged_b if chunk.kind == "node"}
    assert "INC_S007_GR" in nodes_b
    documents_a = [(chunk.chunk_id, chunk.rank) for chunk in judged_a]
    assert record.chunk_id in dict(documents_a), "A must retrieve the record block"
    expected = [
        (chunk.chunk_id, chunk.rank)
        for chunk in judged_a
        if not (chunk.kind == "record" and chunk.document_id in nodes_b)
    ]
    documents_b = [(chunk.chunk_id, chunk.rank) for chunk in judged_b if chunk.kind != "node"]
    assert documents_b == expected
    assert len(expected) == len(documents_a) - 1


def test_a_and_b_hand_the_generator_the_same_prompt_for_the_same_evidence() -> None:
    """Same selected evidence, same prompt (design G1, 5.4; D-025).

    B's two nodes are exactly A's two record hits, so both pipelines select
    the same evidence; the generator must then receive the same blocks in
    the same (judge) order, with the same titles, and answer identically.
    """
    incident = record_corpus_chunk(
        "incidents", "INC_S007_GR", "Incident INC_S007_GR in Greece: checkout failed."
    )
    version = record_corpus_chunk(
        "platform_versions",
        "PLV_PAYMENTS_3",
        "Platform version 3 (PLV_PAYMENTS_3) of Payments. Released 2025-05-01.",
        market_id="",
    )
    records = {
        (chunk.record_table or "", chunk.document_id): chunk for chunk in (incident, version)
    }
    lab = dataclasses.replace(
        build_lab_offline(), source_lookup=SourceLookup(Path("unused"), records)
    )
    index_corpus(
        lab.store, lab.embeddings, lab.sparse, [*build_corpus().values(), incident, version]
    )
    neighbours = load_static_provider_from_rows(
        [("INC_S007_GR", "RELATED_TO_VERSION", "PLV_PAYMENTS_3", "PlatformVersion")]
    )
    (_, b), _c = graph_pipelines(
        lab, neighbours, StaticEntityResolver(resolved()), StaticEntityResolver([])
    )
    question = "Why did checkout fail in Greece?"
    generator_a, generator_b = PromptCapture(), PromptCapture()
    a = lab.pipeline_a()
    a.generator, b.generator = generator_a, generator_b
    result_a, result_b = a.run(question), b.run(question)

    shown_a = [chunk.document_id for chunk in generator_a.contexts]
    shown_b = [chunk.document_id for chunk in generator_b.contexts]
    assert sorted(shown_a) == ["DOC_S007_GR", "DOC_S007_UK", "INC_S007_GR", "PLV_PAYMENTS_3"]
    assert {c.kind for c in generator_b.contexts} == {"node", "chunk"}
    assert shown_b == shown_a
    assert generator_b.prompt == generator_a.prompt
    assert result_b.answer.raw_text == result_a.answer.raw_text
    citations = [
        (c.document_id, c.title, c.source_system, c.source_record_id, c.record_table)
        for c in result_a.answer.citations
    ]
    assert citations == [
        (c.document_id, c.title, c.source_system, c.source_record_id, c.record_table)
        for c in result_b.answer.citations
    ]
