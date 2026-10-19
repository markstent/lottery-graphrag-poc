"""Deterministic scoring tests (docs/05-benchmark-spec.md sections 6, 8, 14)."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import cast

from app.evaluation.runner import BenchmarkRunner
from app.evaluation.scoring import (
    PipelineRunResult,
    check_score,
    classify_failure,
    evidence_metrics,
    score_checks,
)
from app.retrieval.graph.lab import Lab


class TestNumberCheck:
    def test_decimal_formatting_is_normalised(self) -> None:
        check = ("number", "2.5")
        assert check_score(check, "The price is GBP 2.50 per ticket.") == 1.0
        assert check_score(check, "2,50 euros apply.") == 1.0
        assert check_score(check, "The price is 2.05.") == 0.0

    def test_integers(self) -> None:
        assert check_score(("number", "30"), "There were 30 cases.") == 1.0
        assert check_score(("number", "30"), "About 130 cases.") == 0.0


class TestTokenCheck:
    def test_word_boundaries_prevent_substring_hits(self) -> None:
        assert check_score(("token", "INC_01"), "seen in INC_010 and INC_011.") == 0.0
        assert check_score(("token", "INC_010"), "seen in INC_010 and INC_011.") == 1.0

    def test_case_insensitive(self) -> None:
        assert check_score(("token", "game_uk_01"), "Source GAME_UK_01 says so.") == 1.0


class TestSetCheck:
    def test_partial_recall(self) -> None:
        check = ("set", frozenset({"APP", "WEB", "RETAIL"}))
        assert check_score(check, "offered via APP and WEB only.") == 2 / 3

    def test_empty_expected_scores_zero(self) -> None:
        assert check_score(("set", frozenset()), "anything") == 0.0


class TestScoreChecks:
    def test_mean_of_checks(self) -> None:
        checks = (("number", "2.5"), ("token", "GAME_UK_01"))
        score = score_checks(checks, "GAME_UK_01 costs 2.5")
        assert score == 1.0
        assert score_checks(checks, "GAME_UK_01 costs 3.0") == 0.5

    def test_no_checks_means_none(self) -> None:
        assert score_checks((), "anything") is None


class TestEvidenceMetrics:
    def test_recall_and_precision(self) -> None:
        recall, precision = evidence_metrics(
            required=("INC_A", "INC_B", "DOC_C"),
            retrieved=("INC_A", "DOC_C", "GAME_X"),
        )
        assert recall == 2 / 3
        assert precision == 2 / 3

    def test_no_required_evidence(self) -> None:
        assert evidence_metrics((), ("INC_A",)) == (None, None)

    def test_empty_retrieval(self) -> None:
        recall, precision = evidence_metrics(("INC_A",), ())
        assert recall == 0.0
        assert precision == 0.0


class TestFailureClassification:
    def test_healthy_run_has_no_failure(self) -> None:
        assert (
            classify_failure(
                answer_score=1.0,
                evidence_recall=1.0,
                seed_ids=("GAME_UK_01",),
                required=("GAME_UK_01",),
                retrieved_nodes=("GAME_UK_01",),
                discarded_nodes=(),
            )
            is None
        )

    def test_pipeline_a_failure_is_retrieval(self) -> None:
        assert (
            classify_failure(
                answer_score=0.0,
                evidence_recall=0.0,
                seed_ids=(),
                required=("GAME_UK_01",),
                retrieved_nodes=(),
                discarded_nodes=(),
            )
            == "retrieval_failure"
        )

    def test_required_node_in_discard_is_traversal_failure(self) -> None:
        assert (
            classify_failure(
                answer_score=0.0,
                evidence_recall=0.0,
                seed_ids=("INC_S007_GR",),
                required=("INC_S007_AT",),
                retrieved_nodes=("INC_S007_GR",),
                discarded_nodes=("INC_S007_AT",),
            )
            == "graph_traversal_failure"
        )

    def test_good_evidence_but_wrong_answer_is_generation(self) -> None:
        assert (
            classify_failure(
                answer_score=0.0,
                evidence_recall=1.0,
                seed_ids=("GAME_UK_01",),
                required=("GAME_UK_01",),
                retrieved_nodes=("GAME_UK_01",),
                discarded_nodes=(),
            )
            == "generation_failure"
        )

    def test_missing_seed_is_entity_resolution(self) -> None:
        assert (
            classify_failure(
                answer_score=0.0,
                evidence_recall=0.0,
                seed_ids=("GAME_UK_01",),
                required=("GAME_UK_01",),
                retrieved_nodes=("INC_009",),
                discarded_nodes=(),
            )
            == "entity_resolution_failure"
        )


class TestPipelineRunResult:
    def test_retrieved_evidence_deduplicates_in_order(self) -> None:
        run = PipelineRunResult(
            pipeline="C",
            answer="",
            selected_nodes=("GAME_UK_01", "DOC_0001"),
            discarded_nodes=(),
            seed_ids=("GAME_UK_01",),
            selected_document_ids=("DOC_0001", "DOC_0002"),
            context_tokens=100,
            latency_ms=12.0,
            event_counts={},
        )
        assert run.retrieved_evidence() == ("GAME_UK_01", "DOC_0001", "DOC_0002")


def test_reproducibility_record_carries_the_ontology_version(tmp_path: Path) -> None:
    """The run record names the ontology the graph was built from, never a fallback."""
    from tests.test_graph_rag import make_settings

    runner = object.__new__(BenchmarkRunner)
    runner.lab = cast(
        Lab,
        SimpleNamespace(
            settings=make_settings(),
            embeddings=SimpleNamespace(model_name="hashing-256"),
            generator=SimpleNamespace(model_name="fake-answer-v1"),
            reranker=SimpleNamespace(model_name="lexical(w=0.3)"),
        ),
    )
    runner.world_dir = tmp_path

    record = runner._record()
    assert record.ontology_version == "2.0.0"
    assert record.reranker == "lexical(w=0.3)"
