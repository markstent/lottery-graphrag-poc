"""Evidence metrics over discoveries and failure classes (Phase 3 benchmark v2, Task 3)."""

from __future__ import annotations

import dataclasses
import json
from pathlib import Path

import pytest
from app.evaluation.checks import GroundednessScore, TokenCheck
from app.evaluation.claims import Claim
from app.evaluation.grounding import BankInstance
from app.evaluation.runner import (
    PipelineRun,
    ShownBlock,
    _score_from_payload,
    score_pipeline_run,
)
from app.evaluation.scoring import EvidenceScore, classify_failure, evidence_score


def test_evidence_score_excludes_the_anchor_and_scores_discoveries() -> None:
    claims = (Claim("a", "s", frozenset({"INC_2"})), Claim("b", "s", frozenset({"INC_3"})))
    score = evidence_score(
        claims,
        ["INC_1", "INC_2", "DOC_9"],
        anchor_id="INC_1",
        resolved_ids=["INC_1"],
        context_tokens=500,
    )
    assert (
        score.recall,
        score.precision,
        score.claims_found,
        score.efficiency_per_1k,
        score.anchor_resolved,
    ) == (0.5, 0.5, 1, 2.0, True)
    assert score.f1 == 0.5 and score.claims_total == 2


def test_no_surviving_claim_means_no_evidence_score() -> None:
    score = evidence_score((), ["X"], anchor_id="X", resolved_ids=[], context_tokens=10)
    assert score.recall is None and score.f1 is None and score.anchor_resolved is True
    assert score.precision is None and score.claims_found is None
    assert score.efficiency_per_1k is None and score.claims_total == 0


def test_claims_carried_only_by_the_anchor_do_not_survive() -> None:
    claims = (Claim("a", "s", frozenset({"INC_1"})),)
    score = evidence_score(claims, ["INC_1"], anchor_id="INC_1", resolved_ids=[], context_tokens=9)
    assert score.recall is None and score.claims_total == 0


def test_anchor_resolution_reads_resolved_ids_when_not_selected() -> None:
    claims = (Claim("a", "s", frozenset({"INC_2"})),)
    resolved = evidence_score(
        claims, [], anchor_id="INC_1", resolved_ids=["INC_1"], context_tokens=0
    )
    unresolved = evidence_score(
        claims, ["INC_2"], anchor_id="INC_1", resolved_ids=[], context_tokens=0
    )
    assert resolved.anchor_resolved is True and unresolved.anchor_resolved is False


def test_empty_selection_scores_zero_and_no_tokens_means_no_efficiency() -> None:
    claims = (Claim("a", "s", frozenset({"INC_2"})),)
    score = evidence_score(claims, [], anchor_id="INC_1", resolved_ids=[], context_tokens=0)
    assert (score.recall, score.precision, score.f1, score.efficiency_per_1k) == (
        0.0,
        0.0,
        0.0,
        None,
    )


def test_one_selected_item_carrying_several_claims_counts_once_for_precision() -> None:
    claims = (Claim("a", "s", frozenset({"CHNK_1"})), Claim("b", "s", frozenset({"CHNK_1"})))
    score = evidence_score(
        claims, ["CHNK_1", "CHNK_1", "INC_4"], anchor_id="X", resolved_ids=[], context_tokens=1000
    )
    assert (score.recall, score.precision, score.claims_found, score.efficiency_per_1k) == (
        1.0,
        0.5,
        2,
        2.0,
    )
    assert score.f1 == pytest.approx(2 / 3)


def _evidence(recall: float | None, anchor_resolved: bool) -> EvidenceScore:
    return EvidenceScore(recall, None, None, None, 0, None, anchor_resolved)


@pytest.mark.parametrize(
    ("answer", "evidence", "seeded", "expected"),
    [
        (1.0, _evidence(1.0, True), True, None),
        (None, _evidence(None, False), True, None),
        (0.0, _evidence(1.0, False), True, "entity_resolution_failure"),
        (0.0, _evidence(0.0, False), False, "retrieval_failure"),
        (1.0, _evidence(0.4, True), True, "retrieval_failure"),
        (0.0, _evidence(1.0, True), True, "generation_failure"),
        (0.0, _evidence(1.0, False), False, "generation_failure"),
        (0.0, _evidence(None, True), True, "generation_failure"),
    ],
)
def test_failure_classes(
    answer: float | None, evidence: EvidenceScore, seeded: bool, expected: str | None
) -> None:
    assert classify_failure(answer, evidence, seeded) == expected


def test_lab_reports_the_serialiser_of_the_index_it_loaded(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import app.lab as lab_module
    from app.lab import build_lab
    from app.retrieval.standard.generation import FakeAnswerGenerator
    from app.retrieval.standard.records import RECORD_SERIALISER_VERSION
    from app.retrieval.standard.vector_store import InMemoryVectorStore

    from tests.test_graph_rag import make_settings

    class PopulatedStore(InMemoryVectorStore):
        def count(self) -> int:
            return 1

    monkeypatch.setattr(lab_module, "build_store", lambda *_args: PopulatedStore())
    monkeypatch.setattr(lab_module, "load_indexed_corpus", lambda _dir: {})
    (tmp_path / "vector-index.json").write_text(
        json.dumps({"record_serialiser_version": RECORD_SERIALISER_VERSION})
    )
    lab = build_lab(make_settings(dataset_dir=str(tmp_path)), FakeAnswerGenerator())
    assert lab.index_manifest == {"record_serialiser_version": RECORD_SERIALISER_VERSION}
    assert lab.record_serialiser_version == RECORD_SERIALISER_VERSION


# -- groundedness on the run score (method v0.3, D-088) ---------------------------

_INSTANCE = BankInstance(
    instance_id="Q01-2026-INC_024",
    question_id="Q01",
    stratum="H2",
    sub_stratum=None,
    ontology_dependent=False,
    world_seed=2026,
    anchor_id="INC_024",
    text="When did INC_024 start?",
    expected_answer="It started 2025-08-19.",
    checks=(TokenCheck("2025-08-19"),),
    claims=(Claim("Q01-c1", "It started 2025-08-19.", frozenset({"INC_024"})),),
)


def _run(answer: str, block_texts: tuple[str, ...]) -> PipelineRun:
    blocks = tuple(
        ShownBlock(f"REC_{n}", f"Block {n}", text) for n, text in enumerate(block_texts, 1)
    )
    return PipelineRun(
        pipeline="A",
        repeat=0,
        verdict="2025-08-19",
        answer=answer,
        raw_text=answer,
        cited_blocks=(1,),
        blocks=blocks,
        selected=tuple(block.carrier_id for block in blocks),
        resolved_ids=(),
        seeded=False,
        context_tokens=100,
        latency_ms=1.0,
        generation_failed=False,
    )


def test_run_score_records_groundedness() -> None:
    run = _run(
        "It started 2025-08-19 [1]. It closed 2025-09-02 [1].",
        ("INC_024 opened 2025-08-19.", "Other block."),
    )
    score = score_pipeline_run(_INSTANCE, run)
    assert score.groundedness == GroundednessScore(
        atoms=2, supported_share=0.5, unsupported_share=0.5, abstained=False
    )
    assert _score_from_payload(score.to_payload()) == score


def test_live_lab_score_without_block_texts_has_no_groundedness() -> None:
    # Live Lab scoring rebuilds the shown blocks without their texts (F16).
    run = _run("It started 2025-08-19 [1].", ("", ""))
    assert score_pipeline_run(_INSTANCE, run).groundedness is None


def test_old_score_payload_loads_without_groundedness() -> None:
    score = score_pipeline_run(_INSTANCE, _run("It started 2025-08-19 [1].", ("2025-08-19",)))
    payload = score.to_payload()
    del payload["groundedness"]
    assert _score_from_payload(payload) == dataclasses.replace(score, groundedness=None)
