"""One token budget, two ranked channels (method v0.3, D-084).

Documents (chunks and record blocks, in cross-encoder order) and graph nodes
(pipelines B and C, in graph relevance order, D-083) are merged by
alternation, documents first, into one token budget with no item limit.
Every approach is charged the rendered prompt block of each item. Pipeline A
has no graph channel, so its selection is its cross-encoder order cut at the
budget (docs/evaluation/v0.3-method-proposal.md section 4.2).
"""

from __future__ import annotations

import dataclasses
import random
from collections.abc import Sequence

import pytest
from app.config import SELECTION_RULE, ContextSettings, from_env
from app.events import (
    GRAPH_CANDIDATE_DISCARDED,
    GRAPH_CANDIDATE_RERANKED,
    GRAPH_CANDIDATE_SELECTED,
    GRAPH_CONTEXT_ASSEMBLED,
    GRAPH_ENTITY_RESOLUTION_STARTED,
    GRAPH_SEED_SELECTED,
    GRAPH_TARGET_TYPES_RESOLVED,
)
from app.evidence import EvidenceChunk
from app.graph.statements import STATED_LINKS_LIMIT
from app.retrieval.graph.pipeline import GraphRagPipeline
from app.retrieval.graph.resolution import ResolvedEntity, StaticEntityResolver
from app.retrieval.graph.traversal import (
    NeighbourEdge,
    StatedLink,
    StatedLinksError,
    StaticNeighbourProvider,
)
from app.retrieval.standard.context import (
    SELECTION_BUDGET,
    SELECTION_DUPLICATE,
    SELECTION_SAME_RECORD,
    assemble_context,
    block_tokens,
    estimate_tokens,
    interleave_by_budget,
)
from app.retrieval.standard.corpus import CorpusChunk
from app.retrieval.standard.embeddings import HashingEmbedder
from app.retrieval.standard.generation import FakeAnswerGenerator, context_block
from app.retrieval.standard.index import index_corpus
from app.retrieval.standard.reranking import build_reranker
from app.retrieval.standard.sparse import HashingSparseEmbedder
from app.retrieval.standard.vector_store import InMemoryVectorStore

from tests.test_graph_rag import (
    PromptCapture,
    RecordingReranker,
    build_corpus,
    build_pipeline,
    make_settings,
)


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


def record_chunk(record_id: str, words: int) -> EvidenceChunk:
    return doc_chunk(f"REC_games_{record_id}", words).model_copy(
        update={"kind": "record", "document_id": record_id, "record_table": "games"}
    )


def settings(budget: int) -> ContextSettings:
    return ContextSettings(budget_tokens=budget, dedupe_threshold=0.85)


def _ids(chunks: Sequence[EvidenceChunk]) -> list[str]:
    return [chunk.chunk_id for chunk in chunks]


def _reasons(chunks: Sequence[EvidenceChunk]) -> dict[str, str | None]:
    return {chunk.chunk_id: chunk.discard_reason for chunk in chunks}


def _cost(*chunks: EvidenceChunk) -> int:
    return sum(block_tokens(chunk) for chunk in chunks)


# -- the merge ----------------------------------------------------------------------------


def test_alternates_starting_with_documents() -> None:
    documents = [doc_chunk(f"d{i}", 5) for i in range(3)]
    graph = [node_chunk(f"n{i}", 5) for i in range(2)]
    result = assemble_context(documents, graph, settings(10_000))
    assert _ids(result.selected) == ["d0", "n0", "d1", "n1", "d2"]
    assert _ids(result.document_selected) == ["d0", "d1", "d2"]
    assert _ids(result.structured_selected) == ["n0", "n1"]
    assert not result.discarded
    assert result.context_tokens == _cost(*documents, *graph)


def test_one_channel_continues_alone_when_the_other_is_used_up() -> None:
    documents = [doc_chunk(f"d{i}", 5) for i in range(4)]
    result = assemble_context(documents, [node_chunk("n0", 5)], settings(10_000))
    assert _ids(result.selected) == ["d0", "n0", "d1", "d2", "d3"]

    nodes = [node_chunk(f"n{i}", 5) for i in range(3)]
    result = assemble_context([doc_chunk("d0", 5)], nodes, settings(10_000))
    assert _ids(result.selected) == ["d0", "n0", "n1", "n2"]

    result = assemble_context([], nodes, settings(10_000))
    assert _ids(result.selected) == ["n0", "n1", "n2"]


def test_record_in_both_channels_taken_once_at_first_appearance() -> None:
    # Block first: the document channel offers the record block before the
    # graph channel reaches its node, so the node is refused and the graph
    # channel offers its next item in the same turn.
    block, node = record_chunk("GAME_GR_01", 5), node_chunk("GAME_GR_01", 5)
    result = assemble_context(
        [block, doc_chunk("d0", 5)], [node, node_chunk("n1", 5)], settings(10_000)
    )
    assert _ids(result.selected) == ["REC_games_GAME_GR_01", "n1", "d0"]
    assert _reasons(result.discarded) == {"GAME_GR_01": SELECTION_SAME_RECORD}

    # Node first: the graph channel's node is taken before the document
    # channel reaches the block, so the block is refused.
    result = assemble_context([doc_chunk("d0", 5), block], [node], settings(10_000))
    assert _ids(result.selected) == ["d0", "GAME_GR_01"]
    assert _reasons(result.discarded) == {"REC_games_GAME_GR_01": SELECTION_SAME_RECORD}


def test_a_refused_first_appearance_leaves_the_record_to_its_other_copy() -> None:
    # The block does not fit the budget; the node of the same row fits and
    # is taken: same_record refuses only a record that is already selected.
    block = record_chunk("GAME_GR_01", 400)
    node = node_chunk("GAME_GR_01", 5)
    result = assemble_context([block], [node], settings(_cost(node)))
    assert _ids(result.selected) == ["GAME_GR_01"]
    assert _reasons(result.discarded) == {"REC_games_GAME_GR_01": SELECTION_BUDGET}


def test_budget_refusal_keeps_offering_from_the_same_channel() -> None:
    big, small, n0 = doc_chunk("big", 400), doc_chunk("small", 5), node_chunk("n0", 5)
    result = assemble_context([big, small], [n0], settings(_cost(small, n0)))
    # big is refused and the document channel offers its next item in the
    # same turn, so small comes first; the turn then passes to the graph.
    assert _ids(result.selected) == ["small", "n0"]
    assert _reasons(result.discarded) == {"big": SELECTION_BUDGET}


def test_oversized_head_of_one_channel_does_not_stop_the_other() -> None:
    # Review Focus 3: a node bigger than the whole budget heads the graph
    # channel; it is refused as context_budget and the documents still fill
    # the budget.
    huge = node_chunk("huge", 4_000)
    documents = [doc_chunk(f"d{i}", 20) for i in range(6)]
    budget = _cost(*documents)
    assert block_tokens(huge) > budget
    result = assemble_context(documents, [huge], settings(budget))
    assert _ids(result.selected) == _ids(documents)
    assert _reasons(result.discarded) == {"huge": SELECTION_BUDGET}
    assert result.context_tokens == budget

    # The same with the channels swapped: an oversized document head.
    nodes = [node_chunk(f"n{i}", 20) for i in range(6)]
    result = assemble_context([doc_chunk("big", 4_000)], nodes, settings(_cost(*nodes)))
    assert _ids(result.selected) == _ids(nodes)
    assert _reasons(result.discarded) == {"big": SELECTION_BUDGET}


def test_near_duplicate_chunks_refused_records_and_nodes_never() -> None:
    shared = (
        "Game market_id=MKT_GR status=ACTIVE category=DRAW channel=RETAIL currency=EUR"
        " draw_day=FRIDAY jackpot=ROLLING operator=SYNTHETIC_GR licence=GR_LOTTERY"
        " region=EU format=6_49 tier=STANDARD"
    )
    first, second = f"{shared} GAME_GR_01", f"{shared} GAME_GR_02"
    left, right = set(first.lower().split()), set(second.lower().split())
    assert len(left & right) / len(left | right) > 0.85  # above the dedupe threshold

    nodes = [
        node_chunk("GAME_GR_01", 1).model_copy(update={"text": first}),
        node_chunk("GAME_GR_02", 1).model_copy(update={"text": second}),
    ]
    records = [
        record_chunk("GAME_GR_03", 1).model_copy(update={"text": first}),
        record_chunk("GAME_GR_04", 1).model_copy(update={"text": second}),
    ]
    result = assemble_context(records, nodes, settings(10_000))
    assert len(result.structured_selected) == 2 and len(result.document_selected) == 2
    assert not result.discarded

    docs = [
        doc_chunk("d0", 1).model_copy(update={"text": first}),
        doc_chunk("d1", 1).model_copy(update={"text": second}),
    ]
    result = assemble_context(docs, [], settings(10_000))
    assert [(c.chunk_id, c.discard_reason) for c in result.discarded] == [
        ("d1", SELECTION_DUPLICATE)
    ]


def test_checks_run_same_record_then_budget_then_duplicate() -> None:
    # A copy of a selected chunk that does not fit is refused by the budget,
    # not as a duplicate; a selected record's second copy that does not fit
    # is refused as same_record.
    d0 = doc_chunk("d0", 20)
    copy = d0.model_copy(update={"chunk_id": "copy"})
    _selected, discarded = interleave_by_budget([d0, copy], [], _cost(d0), 0.85)
    assert _reasons(discarded) == {"copy": SELECTION_BUDGET}
    _selected, discarded = interleave_by_budget([d0, copy], [], 10_000, 0.85)
    assert _reasons(discarded) == {"copy": SELECTION_DUPLICATE}

    block = record_chunk("GAME_1", 5)
    node = node_chunk("GAME_1", 400)
    selected, discarded = interleave_by_budget([block], [node], _cost(block), 0.85)
    assert _ids(selected) == ["REC_games_GAME_1"]
    assert _reasons(discarded) == {"GAME_1": SELECTION_SAME_RECORD}


def test_each_kind_keeps_its_channel_order() -> None:
    documents = [doc_chunk("d1", 5), record_chunk("GAME_GR_01", 5), doc_chunk("d0", 5)]
    graph = [node_chunk("n1", 5), node_chunk("n0", 5)]
    result = assemble_context(documents, graph, settings(10_000))
    assert _ids(result.structured_selected) == ["n1", "n0"]
    assert _ids(result.document_selected) == ["d1", "REC_games_GAME_GR_01", "d0"]


def _random_channels(rng: random.Random) -> tuple[list[EvidenceChunk], list[EvidenceChunk]]:
    """Random chunks, records and nodes. A row has at most one record block
    and one node, as in the corpus and the graph; a node often shares its row
    with a record block, which gives same_record cases."""
    documents: list[EvidenceChunk] = []
    graph: list[EvidenceChunk] = []
    rows = [f"ROW_{index}" for index in range(12)]
    record_rows = rng.sample(rows, rng.randint(0, len(rows)))
    node_rows = rng.sample(rows, rng.randint(0, len(rows)))
    for index in range(rng.randint(0, 30)):
        kind = rng.choice(("chunk", "record", "node"))
        words = rng.randint(1, 120)
        if kind == "node" and node_rows:
            graph.append(node_chunk(node_rows.pop(), words))
        elif kind == "record" and record_rows:
            documents.append(record_chunk(record_rows.pop(), words))
        else:
            documents.append(doc_chunk(f"c{index}", words))
    return documents, graph


def test_never_exceeds_budget() -> None:
    for seed in range(200):
        rng = random.Random(seed)
        documents, graph = _random_channels(rng)
        budget = rng.randint(1, 1_500)
        selected, discarded = interleave_by_budget(documents, graph, budget, 0.85)
        assert sum(block_tokens(chunk) for chunk in selected) <= budget
        assert sorted(_ids([*selected, *discarded])) == sorted(_ids([*documents, *graph]))
        rows = [c.document_id for c in selected if c.kind in ("record", "node")]
        assert len(rows) == len(set(rows))
        assert all(c.selected and c.discard_reason is None for c in selected)
        assert all(not c.selected and c.discard_reason for c in discarded)


# -- pipeline A: the cross-encoder order cut at the budget --------------------------------


def test_a_selection_is_cross_encoder_order_cut_at_budget() -> None:
    documents = [
        doc_chunk("d0", 30),
        doc_chunk("big", 400),
        record_chunk("GAME_GR_01", 10),
        doc_chunk("d1", 30),
        doc_chunk("d2", 5),
    ]
    budget = _cost(documents[0], documents[2], documents[3])
    result = assemble_context(documents, [], settings(budget))
    assert _ids(result.selected) == ["d0", "REC_games_GAME_GR_01", "d1"]
    assert _reasons(result.discarded) == {"big": SELECTION_BUDGET, "d2": SELECTION_BUDGET}

    # No item limit: twenty small documents all fit a large budget.
    many = [doc_chunk(f"d{i}", 5) for i in range(20)]
    result = assemble_context(many, [], settings(10_000))
    assert _ids(result.selected) == [f"d{i}" for i in range(20)]


def _greedy_cut(
    candidates: list[EvidenceChunk], budget: int
) -> tuple[list[EvidenceChunk], list[EvidenceChunk]]:
    """D-025 as built, without its item cap and charging the rendered block:
    one walk in judge order, budget then near-duplicate check."""
    selected: list[EvidenceChunk] = []
    discarded: list[EvidenceChunk] = []
    used = 0
    for candidate in candidates:
        tokens = block_tokens(candidate)
        words = set(candidate.text.lower().split())
        if used + tokens > budget:
            reason = SELECTION_BUDGET
        elif candidate.kind == "chunk" and any(
            len(words & set(kept.text.lower().split()))
            / len(words | set(kept.text.lower().split()))
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


def test_a_selection_equals_the_old_walk_without_its_item_cap() -> None:
    first = doc_chunk("d0", 10)
    cases = [
        [doc_chunk(f"d{i}", 5) for i in range(20)],
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
    for seed in range(50):
        documents, _graph = _random_channels(random.Random(seed))
        cases.append(documents)
    for candidates in cases:
        for budget in (10_000, 200, 100, 20):
            assert interleave_by_budget(candidates, [], budget, 0.85) == _greedy_cut(
                candidates, budget
            )


def test_budget_counts_the_rendered_block() -> None:
    chunk = doc_chunk("d0", 5).model_copy(update={"title": "A long title " * 20})
    assert len(context_block(chunk)) > len(chunk.text)
    assert block_tokens(chunk) == estimate_tokens(context_block(chunk))
    assert block_tokens(chunk) > estimate_tokens(chunk.text)
    # A budget that holds the text but not the rendered block refuses it.
    result = assemble_context([chunk], [], settings(estimate_tokens(chunk.text)))
    assert _reasons(result.discarded) == {"d0": SELECTION_BUDGET}
    result = assemble_context([chunk], [], settings(block_tokens(chunk)))
    assert _ids(result.selected) == ["d0"]
    assert result.context_tokens == block_tokens(chunk)


# -- settings -----------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("name", "value"), [("RAG_EVIDENCE_SLOTS", "12"), ("RAG_GRAPH_SLOTS", "6")]
)
def test_settings_refuse_removed_slot_variables(
    monkeypatch: pytest.MonkeyPatch, name: str, value: str
) -> None:
    # Review Focus 1: a .env that still sets a slot count is refused, never
    # silently ignored.
    monkeypatch.setenv(name, value)
    with pytest.raises(ValueError, match=name) as raised:
        from_env()
    assert "D-084" in str(raised.value)


def test_selection_rule_label() -> None:
    assert SELECTION_RULE == "graph-rank-interleave-budget"
    context = from_env().context
    assert {field.name for field in dataclasses.fields(context)} == {
        "budget_tokens",
        "dedupe_threshold",
    }
    assert (context.budget_tokens, context.dedupe_threshold) == (2000, 0.85)


# -- the graph pipeline -------------------------------------------------------------------


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


def test_nodes_are_not_reranked() -> None:
    graph_pipeline = _record_pipeline()
    reranker = RecordingReranker()
    graph_pipeline.reranker = reranker
    graph_pipeline.run("What is the price of GAME_GR_01?")
    ((_question, judged),) = reranker.calls
    assert judged and {chunk.kind for chunk in judged} <= {"chunk", "record"}
    assert "REC_games_GAME_GR_01" in _ids(judged)
    reranked = [e for e in graph_pipeline.events if e.event_type == GRAPH_CANDIDATE_RERANKED]
    assert {e.payload["kind"] for e in reranked} <= {"chunk", "record"}
    assert len(reranked) == len(judged)


def test_record_block_and_its_node_take_one_place() -> None:
    run = _record_pipeline().run("What is the price of GAME_GR_01?")
    block = next(c for c in run.document_evidence if c.chunk_id == "REC_games_GAME_GR_01")
    node = next(n for n in run.node_evidence if n.node_id == "GAME_GR_01")
    assert block.selected != node.selected
    refused = node.discard_reason if block.selected else block.discard_reason
    assert refused == SELECTION_SAME_RECORD


def test_graph_context_tokens_respect_the_shared_budget() -> None:
    graph_pipeline = _record_pipeline()
    budget = 40
    graph_pipeline.settings = dataclasses.replace(graph_pipeline.settings, context=settings(budget))
    run = graph_pipeline.run("What is the price of GAME_GR_01?")
    assert run.answer.context_tokens <= budget
    (assembled,) = [e for e in graph_pipeline.events if e.event_type == GRAPH_CONTEXT_ASSEMBLED]
    assert assembled.payload["budget_tokens"] == budget


def test_node_events_carry_tier_and_graph_rank() -> None:
    pipeline = build_pipeline()
    capture = PromptCapture()
    pipeline.generator = capture
    run = pipeline.run("Which platform versions did INC_S007_GR relate to?")
    node_events = [
        e
        for e in pipeline.events
        if e.event_type in (GRAPH_CANDIDATE_SELECTED, GRAPH_CANDIDATE_DISCARDED)
        and "node_id" in e.payload
    ]
    assert node_events
    for event in node_events:
        assert "rerank_score" not in event.payload
        if event.payload.get("reason") in ("excluded_label", "out_of_scope_market"):
            assert event.payload["tier"] is None and event.payload["graph_rank"] is None
        else:
            assert event.payload["tier"] in ("seed", "target", "other")
            assert isinstance(event.payload["graph_rank"], int)
    ranked = sorted(
        (n for n in run.node_evidence if n.graph_rank is not None),
        key=lambda n: n.graph_rank or 0,
    )
    assert [n.graph_rank for n in ranked] == list(range(1, len(ranked) + 1))
    assert (ranked[0].node_id, ranked[0].tier) == ("INC_S007_GR", "seed")
    order = ("seed", "target", "other")
    assert [n.tier for n in ranked] == sorted((n.tier for n in ranked), key=order.index)
    version = next(n for n in ranked if n.node_id == "PLV_PAYMENTS_3")
    assert version.tier == "target" and version.selected
    # The prompt's node block carries the graph rank and the walked path.
    (shown,) = [c for c in capture.contexts if c.chunk_id == "PLV_PAYMENTS_3"]
    assert shown.rank == version.graph_rank
    assert shown.graph_path == "INC_S007_GR -RELATED_TO_VERSION-> PLV_PAYMENTS_3"
    (seed,) = [c for c in capture.contexts if c.chunk_id == "INC_S007_GR"]
    assert seed.graph_path is None


def test_target_types_event() -> None:
    pipeline = build_pipeline()
    pipeline.run("Which markets and platform versions did INC_S007_GR affect?")
    types = [e.event_type for e in pipeline.events]
    (target,) = [e for e in pipeline.events if e.event_type == GRAPH_TARGET_TYPES_RESOLVED]
    assert target.payload == {"labels": "Market,PlatformVersion"}
    assert (
        types.index(GRAPH_ENTITY_RESOLUTION_STARTED)
        < types.index(GRAPH_TARGET_TYPES_RESOLVED)
        < types.index(GRAPH_SEED_SELECTED)
    )

    pipeline = build_pipeline()
    pipeline.run("Why did checkout fail in Greece?")
    (target,) = [e for e in pipeline.events if e.event_type == GRAPH_TARGET_TYPES_RESOLVED]
    assert target.payload == {"labels": ""}


class OverflowingLinks(StaticNeighbourProvider):
    """A provider whose stated-links read returns more rows than the limit,
    counting the reads."""

    reads = 0

    def stated_links(
        self, ids: list[str], rel_types: tuple[str, ...], limit: int
    ) -> list[StatedLink]:
        self.reads += 1
        return [StatedLink("A", "AFFECTS", f"B{index}") for index in range(limit)]


def test_stated_links_are_read_only_for_a_target_type_and_counted() -> None:
    pipeline = build_pipeline()
    pipeline.run("Which platform versions did INC_S007_GR relate to?")
    (assembled,) = [e for e in pipeline.events if e.event_type == GRAPH_CONTEXT_ASSEMBLED]
    assert isinstance(assembled.payload["stated_links"], int)
    assert assembled.payload["stated_links"] > 0

    pipeline = build_pipeline()
    pipeline.run("Why did checkout fail in Greece?")
    (assembled,) = [e for e in pipeline.events if e.event_type == GRAPH_CONTEXT_ASSEMBLED]
    assert assembled.payload["stated_links"] is None


def test_a_refused_stated_links_read_fails_the_run() -> None:
    pipeline = _record_pipeline()
    provider = OverflowingLinks(
        {"MKT_GR": [NeighbourEdge("MKT_GR", "AVAILABLE_IN", "GAME_GR_01", "Game")]}
    )
    pipeline.neighbours = provider
    with pytest.raises(StatedLinksError, match=str(STATED_LINKS_LIMIT)):
        pipeline.run("Which games are available in Greece?")
    assert provider.reads == 1
    # Without a target type no read is made, so the same provider cannot fail it.
    pipeline.run("What is the price of GAME_GR_01?")
    assert provider.reads == 1
