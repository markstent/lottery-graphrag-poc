"""One total context budget and evidence-slot cap for every pipeline.

Structured graph blocks (pipelines B and C) and document chunks share one
token budget and one evidence-slot count, so A, B and C answer from the same
amount of context (docs/retrieval/retrieval-fairness.md). Record blocks for
nodes that enter as structured facts are superseded rather than duplicated
(design 10a.8).
"""

from __future__ import annotations

import dataclasses

from app.config import ContextSettings
from app.events import GRAPH_CANDIDATE_DISCARDED
from app.evidence import EvidenceChunk
from app.retrieval.graph.entities import ResolvedEntity, StaticEntityResolver
from app.retrieval.graph.pipeline import GraphRagPipeline
from app.retrieval.graph.traversal import NeighbourEdge, StaticNeighbourProvider
from app.retrieval.standard.context import (
    SELECTION_BUDGET,
    SELECTION_DUPLICATE,
    SELECTION_SLOT_LIMIT,
    SELECTION_SUPERSEDED,
    assemble_context,
    estimate_tokens,
    select_context,
)
from app.retrieval.standard.corpus import CorpusChunk
from app.retrieval.standard.embeddings import HashingEmbedder
from app.retrieval.standard.generation import FakeAnswerGenerator
from app.retrieval.standard.index import index_corpus
from app.retrieval.standard.reranking import build_reranker
from app.retrieval.standard.sparse import HashingSparseEmbedder
from app.retrieval.standard.vector_store import InMemoryVectorStore

from tests.test_graph_rag import build_corpus, make_settings


def _words(prefix: str, count: int) -> str:
    """Distinct words so no two chunks are near-duplicates."""
    return " ".join(f"{prefix}w{index}" for index in range(count))


def node_chunk(node_id: str, words: int) -> EvidenceChunk:
    return EvidenceChunk(
        kind="node",
        chunk_id=node_id,
        document_id=node_id,
        chunk_index=0,
        text=_words(node_id, words),
        title=f"Incident: {node_id}",
        document_type="Incident",
        market_id="",
        language_code="-",
        source_system="graph",
        similarity=1.0,
        rank=1,
    )


def doc_chunk(chunk_id: str, words: int) -> EvidenceChunk:
    return EvidenceChunk(
        chunk_id=chunk_id,
        document_id=f"DOC_{chunk_id}",
        chunk_index=0,
        text=_words(chunk_id, words),
        title=f"Document {chunk_id}",
        document_type="RELEASE_NOTE",
        market_id="MKT_UK",
        language_code="en",
        source_system="document_store",
        similarity=0.5,
        rank=1,
    )


def settings(budget: int, slots: int = 12) -> ContextSettings:
    return ContextSettings(budget_tokens=budget, dedupe_threshold=0.85, evidence_slots=slots)


def test_structured_blocks_count_against_the_same_budget() -> None:
    structured = [node_chunk(f"n{i}", words=200) for i in range(3)]
    docs = [doc_chunk(f"d{i}", words=200) for i in range(3)]
    result = assemble_context(structured, docs, settings(300))
    assert result.context_tokens <= 300 and not result.document_selected
    assert {chunk.discard_reason for chunk in result.discarded} == {SELECTION_BUDGET}


def test_documents_use_the_budget_left_by_structured_blocks() -> None:
    structured = [node_chunk("n0", words=20)]
    docs = [doc_chunk(f"d{i}", words=20) for i in range(4)]
    one_block = estimate_tokens(structured[0].text)
    doc_tokens = estimate_tokens(docs[0].text)
    result = assemble_context(structured, docs, settings(one_block + 2 * doc_tokens))
    assert len(result.structured_selected) == 1
    assert len(result.document_selected) == 2
    assert result.context_tokens == sum(
        estimate_tokens(chunk.text)
        for chunk in [*result.structured_selected, *result.document_selected]
    )


def test_slot_limit_applies_across_structured_and_documents() -> None:
    structured = [node_chunk(f"n{i}", words=5) for i in range(3)]
    docs = [doc_chunk(f"d{i}", words=5) for i in range(4)]
    result = assemble_context(structured, docs, settings(10_000, slots=5))
    assert len(result.structured_selected) == 3
    assert len(result.document_selected) == 2
    slot_discards = [c.chunk_id for c in result.discarded if c.discard_reason == "slot_limit"]
    assert slot_discards == ["d2", "d3"]


def test_structured_blocks_alone_can_fill_every_slot() -> None:
    structured = [node_chunk(f"n{i}", words=5) for i in range(4)]
    docs = [doc_chunk("d0", words=5)]
    result = assemble_context(structured, docs, settings(10_000, slots=3))
    assert len(result.structured_selected) == 3
    assert not result.document_selected
    reasons = {chunk.chunk_id: chunk.discard_reason for chunk in result.discarded}
    assert reasons == {"n3": SELECTION_SLOT_LIMIT, "d0": SELECTION_SLOT_LIMIT}


def test_select_context_checks_budget_then_slots_then_duplicates() -> None:
    first = doc_chunk("d0", words=10)
    duplicate = first.model_copy(update={"chunk_id": "d0_copy"})
    oversized = doc_chunk("big", words=400)
    late = doc_chunk("d1", words=10)
    selected, discarded = select_context(
        [first, oversized, duplicate, late], budget_tokens=200, max_items=1
    )
    assert [chunk.chunk_id for chunk in selected] == ["d0"]
    reasons = {chunk.chunk_id: chunk.discard_reason for chunk in discarded}
    assert reasons == {
        "big": SELECTION_BUDGET,
        "d0_copy": SELECTION_SLOT_LIMIT,
        "d1": SELECTION_SLOT_LIMIT,
    }

    selected, discarded = select_context([first, duplicate], budget_tokens=200)
    assert [chunk.discard_reason for chunk in discarded] == [SELECTION_DUPLICATE]


def test_no_slot_cap_when_max_items_is_omitted() -> None:
    docs = [doc_chunk(f"d{i}", words=5) for i in range(20)]
    selected, discarded = select_context(docs, budget_tokens=10_000)
    assert len(selected) == 20 and not discarded


def _record_block() -> CorpusChunk:
    return CorpusChunk(
        chunk_id="REC_games_GAME_GR_01",
        document_id="GAME_GR_01",
        chunk_index=0,
        text="games record GAME_GR_01: market_id=MKT_GR, ticket price=2.00 EUR, name=Greek Draw",
        title="games: GAME_GR_01",
        document_type="RECORD",
        market_id="MKT_GR",
        language_code="-",
        source_system="warehouse",
        valid_from=None,
        valid_to=None,
        kind="record",
        record_table="games",
    )


def _record_pipeline() -> GraphRagPipeline:
    retrieval = make_settings()
    retrieval = dataclasses.replace(
        retrieval, context=dataclasses.replace(retrieval.context, evidence_slots=12)
    )
    embeddings = HashingEmbedder(dimensions=retrieval.embedding.dimensions)
    sparse = HashingSparseEmbedder()
    store = InMemoryVectorStore()
    index_corpus(store, embeddings, sparse, [*build_corpus().values(), _record_block()])
    adjacency = {
        "MKT_GR": [
            NeighbourEdge(
                from_id="MKT_GR", rel_type="AVAILABLE_IN", to_id="GAME_GR_01", to_label="Game"
            )
        ]
    }
    seed = ResolvedEntity(
        entity_id="MKT_GR",
        node_label="Market",
        matched_text="Greece",
        origin="market_alias",
        confidence=1.0,
    )
    return GraphRagPipeline(
        resolver=StaticEntityResolver([seed]),
        neighbours=StaticNeighbourProvider(adjacency),
        embeddings=embeddings,
        sparse=sparse,
        store=store,
        generator=FakeAnswerGenerator(),
        settings=retrieval,
        reranker=build_reranker(retrieval),
    )


def test_record_block_for_a_selected_node_is_superseded() -> None:
    graph_pipeline = _record_pipeline()
    run = graph_pipeline.run("What is the price of GAME_GR_01?")
    reasons = {c.chunk_id: c.discard_reason for c in run.document_evidence}
    assert reasons.get("REC_games_GAME_GR_01") == SELECTION_SUPERSEDED
    assert any(node.node_id == "GAME_GR_01" and node.selected for node in run.node_evidence)
    superseded_events = [
        event
        for event in graph_pipeline.events
        if event.event_type == GRAPH_CANDIDATE_DISCARDED
        and event.payload.get("chunk_id") == "REC_games_GAME_GR_01"
    ]
    assert [event.payload["reason"] for event in superseded_events] == [SELECTION_SUPERSEDED]


def test_graph_context_tokens_respect_the_shared_budget() -> None:
    graph_pipeline = _record_pipeline()
    budget = 40
    graph_pipeline.settings = dataclasses.replace(
        graph_pipeline.settings,
        context=ContextSettings(budget_tokens=budget, dedupe_threshold=0.85, evidence_slots=12),
    )
    run = graph_pipeline.run("What is the price of GAME_GR_01?")
    assert run.answer.context_tokens <= budget


def record_chunk(record_id: str, words: int) -> EvidenceChunk:
    return doc_chunk(f"REC_games_{record_id}", words).model_copy(
        update={"kind": "record", "document_id": record_id, "record_table": "games"}
    )


def test_record_block_of_a_selected_node_is_superseded_in_assembly() -> None:
    structured = [node_chunk("GAME_GR_01", words=5)]
    docs = [record_chunk("GAME_GR_01", words=5), doc_chunk("d0", words=5)]
    result = assemble_context(structured, docs, settings(10_000, slots=2))
    reasons = {chunk.chunk_id: chunk.discard_reason for chunk in result.discarded}
    assert reasons == {"REC_games_GAME_GR_01": SELECTION_SUPERSEDED}
    # The superseded record does not take the remaining slot.
    assert [chunk.chunk_id for chunk in result.document_selected] == ["d0"]


def test_record_block_of_a_dropped_node_stays_a_document_candidate() -> None:
    structured = [node_chunk("n0", words=5), node_chunk("GAME_GR_01", words=5)]
    docs = [record_chunk("GAME_GR_01", words=5)]
    result = assemble_context(structured, docs, settings(10_000, slots=2))
    assert [chunk.chunk_id for chunk in result.structured_selected] == ["n0", "GAME_GR_01"]

    dropped = assemble_context(structured, docs, settings(10_000, slots=1))
    reasons = {chunk.chunk_id: chunk.discard_reason for chunk in dropped.discarded}
    assert reasons["GAME_GR_01"] == SELECTION_SLOT_LIMIT
    # Not superseded: it competed in the document pass (and lost its slot).
    assert reasons["REC_games_GAME_GR_01"] == SELECTION_SLOT_LIMIT

    budget = estimate_tokens(structured[0].text) + estimate_tokens(docs[0].text)
    by_budget = assemble_context(
        [structured[0], node_chunk("GAME_GR_01", words=400)], docs, settings(budget)
    )
    assert [chunk.chunk_id for chunk in by_budget.document_selected] == ["REC_games_GAME_GR_01"]


def test_structured_blocks_are_never_dropped_as_duplicates() -> None:
    shared = (
        "Game market_id=MKT_GR status=ACTIVE category=DRAW channel=RETAIL currency=EUR"
        " draw_day=FRIDAY jackpot=ROLLING operator=SYNTHETIC_GR licence=GR_LOTTERY"
        " region=EU format=6_49 tier=STANDARD"
    )
    first = node_chunk("GAME_GR_01", words=1).model_copy(update={"text": f"{shared} GAME_GR_01"})
    second = node_chunk("GAME_GR_02", words=1).model_copy(update={"text": f"{shared} GAME_GR_02"})
    left, right = set(first.text.lower().split()), set(second.text.lower().split())
    assert len(left & right) / len(left | right) > 0.85  # above the dedupe threshold

    result = assemble_context([first, second], [], settings(10_000))
    assert [chunk.chunk_id for chunk in result.structured_selected] == ["GAME_GR_01", "GAME_GR_02"]
    assert not result.discarded

    # Documents with the same texts keep the near-duplicate check.
    docs = [
        doc_chunk("d0", 1).model_copy(update={"text": first.text}),
        doc_chunk("d1", 1).model_copy(update={"text": second.text}),
    ]
    discarded = assemble_context([], docs, settings(10_000)).discarded
    assert [chunk.discard_reason for chunk in discarded] == [SELECTION_DUPLICATE]
