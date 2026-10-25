"""One judge, one total context budget and one evidence-slot cap for every pipeline.

Structured graph candidates (pipelines B and C) and document candidates are
reranked together and selected from one list into one token budget and one
evidence-slot count, so A, B and C answer from the same amount of context
(docs/reference/retrieval/retrieval-fairness.md). Record blocks of structured
candidates are judged with the documents and yield to their node only when
the node holds a graph slot (design 10a.8, D-081).
"""

from __future__ import annotations

import dataclasses
from pathlib import Path

import pytest
from app.config import SELECTION_RULE, ContextSettings, from_env
from app.events import GRAPH_CANDIDATE_DISCARDED
from app.evidence import EvidenceChunk
from app.retrieval.graph.pipeline import GraphRagPipeline
from app.retrieval.graph.resolution import ResolvedEntity, StaticEntityResolver
from app.retrieval.graph.source_lookup import SourceLookup
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

from tests.test_graph_rag import RecordingReranker, build_corpus, make_settings


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


def settings(budget: int, slots: int = 12, graph_slots: int = 6) -> ContextSettings:
    return ContextSettings(
        budget_tokens=budget,
        dedupe_threshold=0.85,
        evidence_slots=slots,
        graph_slots=graph_slots,
    )


def test_nodes_and_documents_count_against_the_same_budget() -> None:
    candidates = [node_chunk("n0", words=100), doc_chunk("d0", words=100), node_chunk("n1", 100)]
    result = assemble_context(candidates, settings(200))
    assert result.context_tokens <= 200
    assert [chunk.chunk_id for chunk in result.structured_selected] == ["n0"]
    assert not result.document_selected
    assert {chunk.discard_reason for chunk in result.discarded} == {SELECTION_BUDGET}
    assert result.context_tokens == estimate_tokens(candidates[0].text)


def test_a_higher_ranked_document_takes_a_slot_ahead_of_a_node() -> None:
    reranked = [doc_chunk("d0", words=5), node_chunk("n0", words=5), node_chunk("n1", words=5)]
    result = assemble_context(reranked, settings(10_000, slots=2, graph_slots=1))
    assert [chunk.chunk_id for chunk in result.document_selected] == ["d0"]
    assert [chunk.chunk_id for chunk in result.structured_selected] == ["n0"]
    assert {chunk.chunk_id: chunk.discard_reason for chunk in result.discarded} == {
        "n1": SELECTION_SLOT_LIMIT
    }


def test_a_higher_ranked_node_takes_a_slot_ahead_of_a_document() -> None:
    reranked = [node_chunk("n0", words=5), doc_chunk("d0", words=5), doc_chunk("d1", words=5)]
    result = assemble_context(reranked, settings(10_000, slots=1))
    assert [chunk.chunk_id for chunk in result.structured_selected] == ["n0"]
    assert not result.document_selected
    assert [chunk.discard_reason for chunk in result.discarded] == [SELECTION_SLOT_LIMIT] * 2


def test_each_kind_keeps_selection_order() -> None:
    reranked = [
        node_chunk("n1", 5),
        doc_chunk("d1", 5),
        node_chunk("n0", 5),
        record_chunk("GAME_GR_01", 5),
        doc_chunk("d0", 5),
    ]
    result = assemble_context(reranked, settings(10_000))
    assert [chunk.chunk_id for chunk in result.structured_selected] == ["n1", "n0"]
    assert [chunk.chunk_id for chunk in result.document_selected] == [
        "d1",
        "REC_games_GAME_GR_01",
        "d0",
    ]


def test_select_context_checks_budget_then_slots_then_duplicates() -> None:
    first = doc_chunk("d0", words=10)
    duplicate = first.model_copy(update={"chunk_id": "d0_copy"})
    oversized = doc_chunk("big", words=400)
    late = doc_chunk("d1", words=10)
    selected, discarded = select_context(
        [first, oversized, duplicate, late], budget_tokens=200, max_items=1, graph_slots=0
    )
    assert [chunk.chunk_id for chunk in selected] == ["d0"]
    reasons = {chunk.chunk_id: chunk.discard_reason for chunk in discarded}
    assert reasons == {
        "big": SELECTION_BUDGET,
        "d0_copy": SELECTION_SLOT_LIMIT,
        "d1": SELECTION_SLOT_LIMIT,
    }

    selected, discarded = select_context([first, duplicate], budget_tokens=200, graph_slots=0)
    assert [chunk.discard_reason for chunk in discarded] == [SELECTION_DUPLICATE]


def test_no_slot_cap_when_max_items_is_omitted() -> None:
    docs = [doc_chunk(f"d{i}", words=5) for i in range(20)]
    selected, discarded = select_context(docs, budget_tokens=10_000, graph_slots=6)
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


def test_record_block_of_a_slotted_node_is_judged_then_superseded() -> None:
    graph_pipeline = _record_pipeline()
    reranker = RecordingReranker()
    graph_pipeline.reranker = reranker
    run = graph_pipeline.run("What is the price of GAME_GR_01?")
    judged = [candidate.chunk_id for candidate in reranker.calls[0][1]]
    assert "GAME_GR_01" in judged and "REC_games_GAME_GR_01" in judged
    assert len(judged) == len(set(judged))  # each candidate is judged once
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
    assert superseded_events[0].payload["rerank_score"] is not None


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


def _pairs(count: int) -> list[EvidenceChunk]:
    """Node and record block pairs for the same rows, equal text, node first."""
    pairs: list[EvidenceChunk] = []
    for index in range(count):
        row = f"GAME_{index:02d}"
        node = node_chunk(row, 5)
        pairs += [node, record_chunk(row, 5).model_copy(update={"text": node.text})]
    return pairs


def test_a_node_in_a_graph_slot_supersedes_its_record_block() -> None:
    result = assemble_context(_pairs(2), settings(10_000))
    assert _ids(result.structured_selected) == ["GAME_00", "GAME_01"]
    assert not result.document_selected
    assert {c.chunk_id: c.discard_reason for c in result.discarded} == {
        "REC_games_GAME_00": SELECTION_SUPERSEDED,
        "REC_games_GAME_01": SELECTION_SUPERSEDED,
    }


def test_a_record_block_competes_as_a_document_when_its_node_misses_the_share() -> None:
    # Seven equal-scoring pairs: six nodes take the graph slots and their
    # blocks yield; the seventh node is refused by the share, so its block
    # competes for a document slot under its own rank.
    result = assemble_context(_pairs(7), settings(10_000))
    assert _ids(result.structured_selected) == [f"GAME_{i:02d}" for i in range(6)]
    assert _ids(result.document_selected) == ["REC_games_GAME_06"]
    reasons = {c.chunk_id: c.discard_reason for c in result.discarded}
    assert reasons["GAME_06"] == SELECTION_SLOT_LIMIT
    assert reasons["REC_games_GAME_00"] == SELECTION_SUPERSEDED
    assert "REC_games_GAME_06" not in reasons


def test_with_no_nodes_record_blocks_are_ordinary_documents() -> None:
    records = [record_chunk(f"GAME_{i:02d}", 5) for i in range(3)]
    result = assemble_context(records, settings(10_000))
    assert _ids(result.document_selected) == _ids(records) and not result.discarded


def _shared_text(suffix: str) -> str:
    shared = (
        "Game market_id=MKT_GR status=ACTIVE category=DRAW channel=RETAIL currency=EUR"
        " draw_day=FRIDAY jackpot=ROLLING operator=SYNTHETIC_GR licence=GR_LOTTERY"
        " region=EU format=6_49 tier=STANDARD"
    )
    return f"{shared} {suffix}"


def test_nodes_and_records_are_never_dropped_as_duplicates() -> None:
    first, second = _shared_text("GAME_GR_01"), _shared_text("GAME_GR_02")
    left, right = set(first.lower().split()), set(second.lower().split())
    assert len(left & right) / len(left | right) > 0.85  # above the dedupe threshold

    nodes = [
        node_chunk("GAME_GR_01", words=1).model_copy(update={"text": first}),
        node_chunk("GAME_GR_02", words=1).model_copy(update={"text": second}),
    ]
    records = [
        record_chunk("GAME_GR_03", 1).model_copy(update={"text": first}),
        record_chunk("GAME_GR_04", 1).model_copy(update={"text": second}),
    ]
    result = assemble_context([*nodes, *records], settings(10_000))
    assert len(result.structured_selected) == 2 and len(result.document_selected) == 2
    assert not result.discarded

    # Document chunks with the same texts keep the near-duplicate check.
    docs = [
        doc_chunk("d0", 1).model_copy(update={"text": first}),
        doc_chunk("d1", 1).model_copy(update={"text": second}),
    ]
    discarded = assemble_context(docs, settings(10_000)).discarded
    assert [(chunk.chunk_id, chunk.discard_reason) for chunk in discarded] == [
        ("d1", SELECTION_DUPLICATE)
    ]


MECHANIC_TEXT = (
    "Game mechanic EPILOGI (MECH_GR_EPILOGI) in Greece: Pick your numbers. Language el. "
    "Source: product_catalogue table game_mechanics, record MECH_GR_EPILOGI."
)


def test_game_mechanic_node_supersedes_its_record_block(tmp_path: Path) -> None:
    graph_pipeline = _record_pipeline()
    record = dataclasses.replace(
        _record_block(),
        chunk_id="REC_game_mechanics_MECH_GR_EPILOGI",
        document_id="MECH_GR_EPILOGI",
        text=MECHANIC_TEXT,
        title="game_mechanics: MECH_GR_EPILOGI",
        record_table="game_mechanics",
    )
    index_corpus(graph_pipeline.store, graph_pipeline.embeddings, graph_pipeline.sparse, [record])
    graph_pipeline.neighbours = StaticNeighbourProvider(
        {
            "MKT_GR": [
                NeighbourEdge("MKT_GR", "AVAILABLE_IN", "GAME_GR_01", "Game"),
            ],
            "GAME_GR_01": [
                NeighbourEdge("GAME_GR_01", "HAS_MECHANIC", "MECH_GR_EPILOGI", "GameMechanic"),
            ],
        }
    )
    graph_pipeline.source_lookup = SourceLookup(
        tmp_path, {("game_mechanics", "MECH_GR_EPILOGI"): record}
    )
    reranker = RecordingReranker()
    graph_pipeline.reranker = reranker
    run = graph_pipeline.run("Which mechanic does GAME_GR_01 use?")
    reasons = {c.chunk_id: c.discard_reason for c in run.document_evidence}
    assert reasons["REC_game_mechanics_MECH_GR_EPILOGI"] == SELECTION_SUPERSEDED
    node = next(c for c in reranker.calls[0][1] if c.chunk_id == "MECH_GR_EPILOGI")
    assert node.kind == "node" and node.text == MECHANIC_TEXT


def _ids(chunks: list[EvidenceChunk]) -> list[str]:
    return [chunk.chunk_id for chunk in chunks]


def _old_rule(
    candidates: list[EvidenceChunk], budget: int, slots: int
) -> tuple[list[EvidenceChunk], list[EvidenceChunk]]:
    """D-025 as it was built: budget, then slots, then duplicates, one walk."""
    selected: list[EvidenceChunk] = []
    discarded: list[EvidenceChunk] = []
    used = 0
    for candidate in candidates:
        tokens = estimate_tokens(candidate.text)
        if used + tokens > budget:
            reason = SELECTION_BUDGET
        elif len(selected) >= slots:
            reason = SELECTION_SLOT_LIMIT
        elif candidate.kind == "chunk" and any(
            len(set(candidate.text.split()) & set(kept.text.split()))
            / len(set(candidate.text.split()) | set(kept.text.split()))
            >= 0.85
            for kept in selected
            if kept.kind == "chunk"
        ):
            reason = SELECTION_DUPLICATE
        else:
            selected.append(candidate.model_copy(update={"selected": True}))
            used += tokens
            continue
        discarded.append(candidate.model_copy(update={"discard_reason": reason}))
    return selected, discarded


def test_documents_only_selection_is_unchanged() -> None:
    first = doc_chunk("d0", words=10)
    cases = [
        [doc_chunk(f"d{i}", words=5) for i in range(20)],
        [doc_chunk("d0", 30), doc_chunk("big", 400), doc_chunk("d1", 30), doc_chunk("d2", 5)],
        [first, first.model_copy(update={"chunk_id": "copy"}), doc_chunk("d1", 10)],
        [
            record_chunk("GAME_GR_01", 40),
            doc_chunk("d0", 120),
            record_chunk("GAME_GR_02", 5),
            doc_chunk("d1", 200),
        ],
        [],
    ]
    for candidates in cases:
        for budget, slots in [(10_000, 12), (200, 12), (10_000, 3), (100, 2)]:
            for graph_slots in (0, 6):
                new = select_context(
                    candidates,
                    budget_tokens=budget,
                    dedupe_threshold=0.85,
                    max_items=slots,
                    graph_slots=graph_slots,
                )
                assert new == _old_rule(candidates, budget, slots)


def _mixed(nodes_first: int, nodes: int, documents: int) -> list[EvidenceChunk]:
    """Nodes n0.. and documents d0.. with the first `nodes_first` nodes on top."""
    node_list = [node_chunk(f"n{i}", 5) for i in range(nodes)]
    doc_list = [doc_chunk(f"d{i}", 5) for i in range(documents)]
    return [*node_list[:nodes_first], *doc_list, *node_list[nodes_first:]]


def test_graph_candidates_get_their_share() -> None:
    result = assemble_context(_mixed(0, 8, 12), settings(10_000))
    assert _ids(result.structured_selected) == [f"n{i}" for i in range(6)]
    assert _ids(result.document_selected) == [f"d{i}" for i in range(6)]
    reasons = {c.chunk_id: c.discard_reason for c in result.discarded}
    assert reasons["n6"] == reasons["d6"] == SELECTION_SLOT_LIMIT


def test_unused_graph_slots_go_to_documents() -> None:
    result = assemble_context(_mixed(0, 2, 20), settings(10_000))
    assert len(result.structured_selected) == 2
    assert len(result.document_selected) == 10


def test_nodes_never_take_more_than_their_share() -> None:
    result = assemble_context(_mixed(15, 15, 20), settings(10_000))
    assert len(result.structured_selected) == 6
    assert len(result.document_selected) == 6
    assert len(result.selected) == 12


def test_selected_list_is_in_judge_order() -> None:
    reranked = [
        doc_chunk("d0", 5),
        node_chunk("n0", 5),
        doc_chunk("d1", 5),
        node_chunk("n1", 5),
        record_chunk("GAME_GR_01", 5),
    ]
    result = assemble_context(reranked, settings(10_000))
    assert _ids(result.selected) == _ids(reranked)


def test_budget_is_shared_in_judge_order() -> None:
    # Each candidate costs the same, and the budget holds four. Candidates
    # enter in judge order across both channels; neither reserves budget for
    # its share, so the fifth is refused whatever its channel.
    reranked = [
        doc_chunk("d0", 20),
        doc_chunk("d1", 20),
        node_chunk("n0", 20),
        node_chunk("n1", 20),
        doc_chunk("d2", 20),
    ]
    budget = 4 * estimate_tokens(reranked[0].text)
    result = assemble_context(reranked, settings(budget))
    assert _ids(result.selected) == ["d0", "d1", "n0", "n1"]
    assert {c.chunk_id: c.discard_reason for c in result.discarded} == {"d2": SELECTION_BUDGET}


def test_nodes_that_never_fit_do_not_take_a_graph_slot() -> None:
    reranked = [node_chunk("big", 400), *[doc_chunk(f"d{i}", 5) for i in range(12)]]
    result = assemble_context(reranked, settings(200))
    assert {c.chunk_id: c.discard_reason for c in result.discarded}["big"] == SELECTION_BUDGET
    assert len(result.document_selected) == 12


def test_a_budget_refused_node_releases_its_slot_to_later_documents() -> None:
    # n0 holds a graph slot but the budget, spent by d0, refuses it. The slot
    # is released at that point, so d2 may take it. d1 was walked while the
    # slot was still held and stays refused: a decision is never revisited.
    d0, n0 = doc_chunk("d0", 20), node_chunk("n0", 20)
    small = [doc_chunk("d1", 2), doc_chunk("d2", 2)]
    budget = estimate_tokens(d0.text) + estimate_tokens(small[0].text) * 2
    assert estimate_tokens(n0.text) > budget - estimate_tokens(d0.text)
    result = assemble_context(
        [d0, small[0], n0, small[1]], settings(budget, slots=2, graph_slots=1)
    )
    reasons = {c.chunk_id: c.discard_reason for c in result.discarded}
    assert reasons == {"d1": SELECTION_SLOT_LIMIT, "n0": SELECTION_BUDGET}
    assert _ids(result.selected) == ["d0", "d2"]


def test_share_discard_reason() -> None:
    reranked = [node_chunk(f"n{i}", 5) for i in range(3)] + [
        doc_chunk(f"d{i}", 5) for i in range(3)
    ]
    result = assemble_context(reranked, settings(10_000, slots=4, graph_slots=2))
    reasons = {c.chunk_id: c.discard_reason for c in result.discarded}
    assert reasons == {"n2": SELECTION_SLOT_LIMIT, "d2": SELECTION_SLOT_LIMIT}
    assert _ids(result.selected) == ["n0", "n1", "d0", "d1"]


def test_selection_rule_is_recorded() -> None:
    assert SELECTION_RULE == "reranker-graph-share"
    context = from_env().context
    assert (context.evidence_slots, context.graph_slots) == (12, 6)


def test_graph_slots_must_lie_within_the_evidence_slots(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RAG_GRAPH_SLOTS", "13")
    with pytest.raises(ValueError, match="RAG_GRAPH_SLOTS"):
        from_env()
    monkeypatch.setenv("RAG_GRAPH_SLOTS", "-1")
    with pytest.raises(ValueError, match="RAG_GRAPH_SLOTS"):
        from_env()
    monkeypatch.setenv("RAG_GRAPH_SLOTS", "0")
    assert from_env().context.graph_slots == 0
