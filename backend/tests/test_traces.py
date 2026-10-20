"""Trace CLI: question selection and markdown rendering (no live services)."""

from __future__ import annotations

import pytest
from app.api.schemas import DemoQuestion
from app.events import RetrievalEvent
from app.evidence import EvidenceChunk, GraphEvidence, GraphRunResult, RagAnswer, RagRunResult
from app.traces import HEADER, select_questions, trace_a, trace_g


def _chunk(chunk_id: str, kind: str, selected: bool) -> EvidenceChunk:
    return EvidenceChunk(
        chunk_id=chunk_id,
        document_id=chunk_id,
        chunk_index=0,
        text="text",
        title=f"title {chunk_id}",
        document_type="record" if kind == "record" else "policy",
        market_id="MKT_UK",
        language_code="en",
        source_system="warehouse",
        kind=kind,
        record_table="games" if kind == "record" else None,
        similarity=0.03,
        dense_rank=1,
        sparse_rank=2,
        rank=1,
        rerank_score=0.9,
        selected=selected,
        discard_reason=None if selected else "context_budget",
    )


DEMOS = [
    DemoQuestion(
        instance_id=f"{qid}-2026-X", question_id=qid, text=f"q {qid}", stratum=s, market_scope=[]
    )
    for qid, s in (("L05", "H1"), ("L09", "H2"), ("L01", "H3"))
]


def test_select_questions_defaults_to_every_demo_question_in_order() -> None:
    assert select_questions(DEMOS, None) == DEMOS


def test_select_questions_filters_and_rejects_unknown_ids() -> None:
    assert [q.question_id for q in select_questions(DEMOS, ["L01", "L05"])] == ["L05", "L01"]
    with pytest.raises(ValueError, match="L99"):
        select_questions(DEMOS, ["L99"])


def _answer() -> RagAnswer:
    return RagAnswer(
        text="The price is 2.50 [1].",
        verdict="2.50 GBP",
        cited_blocks=[1],
        raw_text="{}",
        model="fake-answer-v1",
        latency_ms=1.0,
        context_tokens=42,
        citations=[],
    )


def _event(event_type: str, **payload: str | int | float | None) -> RetrievalEvent:
    return RetrievalEvent(event_type, "C", 0.0, "e1", "2026-01-01T00:00:00Z", dict(payload))


def test_trace_a_shows_block_kinds_and_the_parsed_answer() -> None:
    answer = _answer()
    result = RagRunResult(
        run_id="r1",
        question="q",
        answer=answer,
        evidence=[
            _chunk("rec-1", "record", True),
            _chunk("doc-1", "chunk", True),
            _chunk("doc-2", "chunk", False),
        ],
        embedding_model="bge-m3",
        generation_model="fake-answer-v1",
    )
    text = "\n".join(trace_a(result, []))
    assert "selected context (2: 1 record, 1 document)" in text
    assert "`rec-1` [record games]" in text
    assert "`doc-1` [chunk]" in text
    assert "discarded: 1 (context_budget)" in text
    assert "- verdict: 2.50 GBP" in text
    assert "- cited blocks: [1]" in text


def test_header_describes_v2_and_has_no_em_dash() -> None:
    assert "cross-encoder" in HEADER
    assert "lexical" not in HEADER
    assert chr(0x2014) not in HEADER  # em dash


def test_trace_g_shows_query_expansion_and_via_concept_discoveries() -> None:
    result = GraphRunResult(
        run_id="r2",
        question="q",
        answer=_answer(),
        node_evidence=[],
        document_evidence=[],
        ontology_concepts=["CONCEPT_INCIDENT"],
        embedding_model="bge-m3",
        generation_model="fake-answer-v1",
    )
    events = [
        _event(
            "graph.entity.resolved",
            entity_id="CONCEPT_INCIDENT",
            node_label="BusinessConcept",
            origin="term",
            matched_text="incident",
            via_concept=None,
        ),
        _event("graph.query.expanded", added_terms=3, expanded_length=140),
        _event("graph.seed.selected", node_id="CONCEPT_INCIDENT"),
        _event(
            "graph.node.discovered",
            node_id="INC_001",
            node_label="Incident",
            hop=1,
            via_concept="CONCEPT_INCIDENT",
        ),
        _event("graph.node.discovered", node_id="MKT_UK", node_label="Market", hop=1),
    ]
    text = "\n".join(trace_g("C", result, events))
    assert "`CONCEPT_INCIDENT` (BusinessConcept, term, matched 'incident')" in text
    assert "graph.query.expanded: 3 term(s) added, search text 140 chars" in text
    assert "discovered via_concept `CONCEPT_INCIDENT`: 1 node(s): `INC_001`" in text
    assert "MKT_UK" not in text


def test_trace_g_counts_the_selected_context_by_kind() -> None:
    node = GraphEvidence(
        node_id="INC_001",
        node_label="Incident",
        hops=0,
        path=["INC_001"],
        rel_type="SEED",
        score=0.9,
        components={},
        rerank_score=1.5,
        selected=True,
    )
    excluded = node.model_copy(
        update={"node_id": "INC_002", "selected": False, "discard_reason": "excluded_label"}
    )
    result = GraphRunResult(
        run_id="r3",
        question="q",
        answer=_answer(),
        node_evidence=[node, excluded],
        document_evidence=[
            _chunk("rec-1", "record", True),
            _chunk("doc-1", "chunk", True),
            _chunk("doc-2", "chunk", True),
        ],
        ontology_concepts=[],
        embedding_model="bge-m3",
        generation_model="fake-answer-v1",
    )
    text = "\n".join(trace_g("B", result, []))
    assert "- selected context (4: 1 node, 1 record, 2 document)" in text
    assert "rerank 1.500" in text
    assert "- discarded nodes: 1 (excluded_label=1)" in text
    assert "- seeds: (none)" in text


def test_answer_without_citations_reads_none() -> None:
    answer = _answer().model_copy(update={"cited_blocks": []})
    result = RagRunResult(
        run_id="r4",
        question="q",
        answer=answer,
        evidence=[],
        embedding_model="bge-m3",
        generation_model="fake-answer-v1",
    )
    assert "- cited blocks: none (0 shown)" in "\n".join(trace_a(result, []))


def test_timings_line_reports_wall_clock_and_judge_time() -> None:
    result = GraphRunResult(
        run_id="r5",
        question="q",
        answer=_answer(),
        node_evidence=[],
        document_evidence=[],
        ontology_concepts=[],
        embedding_model="bge-m3",
        generation_model="fake-answer-v1",
    )
    events = [
        RetrievalEvent("graph.rerank.started", "B", 100.0, "e1", "t", {}),
        RetrievalEvent("graph.candidate.reranked", "B", 350.0, "e2", "t", {}),
        RetrievalEvent("graph.candidate.reranked", "B", 351.0, "e3", "t", {}),
    ]
    text = "\n".join(trace_g("B", result, events, wall_ms=1234.4))
    assert "- timings: run 1234 ms, judge 250 ms over 2 candidates" in text
    assert "timings" not in "\n".join(trace_g("B", result, events))
