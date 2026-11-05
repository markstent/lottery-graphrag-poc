"""The evidence and answer outcomes of a stored run (app/evaluation/outcomes.py)."""

from __future__ import annotations

import dataclasses
from typing import Any

import pytest
from app.evaluation.claims import Claim
from app.evaluation.outcomes import (
    AnswerCounts,
    EvidenceCounts,
    payload_outcomes,
    run_outcomes,
)
from app.evaluation.runner import InstanceResult, PipelineRun, RunScore
from app.evaluation.scoring import evidence_score

from tests.test_benchmark_report import _instance, _run, _score

ANCHOR = "X"
CLAIMS = (
    Claim("c1", "one", frozenset({"Y"})),
    Claim("c2", "two", frozenset({"Z", ANCHOR})),
    # Only the anchor carries it, so the scorer drops it.
    Claim("c3", "three", frozenset({ANCHOR})),
)


def _repeat(
    answer: float | None,
    verdict: str = "",
    selected: tuple[str, ...] = (),
    found: int | None = 1,
    total: int = 2,
) -> tuple[PipelineRun, RunScore]:
    run = dataclasses.replace(_run("A", 0), verdict=verdict, selected=selected)
    score = _score(0.0 if answer is None else answer, 0.5)
    evidence = dataclasses.replace(score.evidence, claims_found=found, claims_total=total)
    return run, dataclasses.replace(score, answer=answer, evidence=evidence)


def _result(
    repeats: list[tuple[PipelineRun, RunScore]],
    claims: tuple[Claim, ...] = CLAIMS,
    tag: str = "A",
    question: str = "L10",
) -> InstanceResult:
    instance = dataclasses.replace(_instance(question, "H1", 2026), claims=claims)
    return InstanceResult(
        instance=instance,
        runs={tag: [run for run, _ in repeats]},
        scores={tag: [score for _, score in repeats]},
    )


def test_answers_band_by_score_and_mark_declines() -> None:
    results = [
        _result([_repeat(1.0)], question="L10"),
        _result([_repeat(0.5, verdict="unknown: the records do not say")], question="L11"),
        _result([_repeat(0.0)], question="L12"),
        _result([_repeat(0.0, verdict="Unknown")], question="L13"),
    ]
    outcomes = run_outcomes(results)
    assert outcomes.recorded
    assert outcomes.answers == {
        "A": AnswerCounts(
            scored=4,
            right=1,
            partly=1,
            wrong=2,
            right_declined=0,
            partly_declined=1,
            wrong_declined=1,
            not_scored=0,
        )
    }


def test_a_verdict_that_only_starts_with_unknown_letters_is_not_a_decline() -> None:
    outcomes = run_outcomes([_result([_repeat(0.0, verdict="unknowable, but 12")])])
    assert outcomes.answers["A"].wrong_declined == 0


def test_unscored_repeat_is_outside_the_bands() -> None:
    run, score = _repeat(None)
    failed = dataclasses.replace(_run("A", 1, failed=True), verdict="unknown")
    result = _result([(run, score), _repeat(1.0)])
    result.runs["A"].append(failed)
    result.scores["A"].append(None)
    answers = run_outcomes([result]).answers["A"]
    assert (answers.scored, answers.right, answers.partly, answers.wrong) == (1, 1, 0, 0)
    # The repeat without checks and the repeat whose generation failed.
    assert answers.not_scored == 2
    assert answers.right_declined + answers.partly_declined + answers.wrong_declined == 0


def test_evidence_counts_skip_repeats_without_claims() -> None:
    results = [
        _result([_repeat(1.0, found=1, total=2), _repeat(0.0, found=2, total=2)]),
        # No claim survived anchor exclusion: not measured, so outside every count.
        _result([_repeat(1.0, found=None, total=0, selected=("Q",))], question="L11"),
    ]
    evidence = run_outcomes(results).evidence["A"]
    assert (evidence.repeats, evidence.found, evidence.missed) == (2, 3, 1)


def test_extra_uses_the_scorer_rule() -> None:
    # Y carries c1 and Z carries c2; the anchor X is apart; Q and R carry nothing,
    # and the duplicate Q counts once.
    first = _repeat(1.0, selected=(ANCHOR, "Y", "Q", "Q", "Z", "R"))
    second = _repeat(1.0, selected=("Y",))
    evidence = run_outcomes([_result([first, second])]).evidence["A"]
    assert evidence == EvidenceCounts(repeats=2, found=2, missed=2, extra_per_question=1.0)


def test_extra_matches_the_stored_precision() -> None:
    """The extra count is the scorer's: items times one less precision."""
    selected = (ANCHOR, "Y", "Q", "Q", "R")
    scored = evidence_score(CLAIMS, selected, ANCHOR, (), 100)
    run, score = _repeat(1.0, selected=selected)
    result = _result([(run, dataclasses.replace(score, evidence=scored))])
    evidence = run_outcomes([result]).evidence["A"]
    assert scored.precision is not None
    assert evidence.extra_per_question == pytest.approx(3 * (1 - scored.precision))
    assert (evidence.found, evidence.missed) == (1, 1)


def test_no_measured_repeat_gives_no_extra_average() -> None:
    result = _result([_repeat(1.0, found=None, total=0)])
    assert run_outcomes([result]).evidence["A"] == EvidenceCounts(0, 0, 0, None)


def test_pipelines_are_listed_in_order() -> None:
    results = [_result([_repeat(1.0)], tag=tag) for tag in ("C", "A", "B")]
    outcomes = run_outcomes(results)
    assert list(outcomes.answers) == list(outcomes.evidence) == ["A", "B", "C"]


def test_missing_fields_are_not_recorded() -> None:
    # A run whose instances carry no claims cannot show evidence.
    no_claims = run_outcomes([_result([_repeat(1.0)], claims=())])
    assert (no_claims.recorded, no_claims.evidence, no_claims.answers) == (False, {}, {})
    assert not run_outcomes([]).recorded


def _payload(result: InstanceResult) -> dict[str, Any]:
    return {
        "worlds": [
            {
                "results": [
                    {
                        "instance": result.instance.to_payload(),
                        "runs": {
                            tag: [run.to_payload() for run in runs]
                            for tag, runs in result.runs.items()
                        },
                        "scores": {
                            tag: [None if s is None else s.to_payload() for s in scores]
                            for tag, scores in result.scores.items()
                        },
                    }
                ]
            }
        ]
    }


def test_a_stored_run_reads_back_to_the_same_outcomes() -> None:
    result = _result([_repeat(1.0, selected=("Y", "Q"))])
    assert payload_outcomes(_payload(result)) == run_outcomes([result])


@pytest.mark.parametrize(
    "drop",
    [
        lambda p: p["runs"]["A"][0].pop("selected"),
        lambda p: p["instance"].pop("claims"),
        lambda p: p["scores"]["A"][0]["evidence"].pop("claims_found"),
        lambda p: p["scores"]["A"][0]["evidence"].pop("claims_total"),
    ],
    ids=["selected", "claims", "claims_found", "claims_total"],
)
def test_a_stored_run_without_the_fields_is_not_recorded(drop: Any) -> None:
    payload = _payload(_result([_repeat(1.0)]))
    drop(payload["worlds"][0]["results"][0])
    outcomes = payload_outcomes(payload)
    assert (outcomes.recorded, outcomes.evidence, outcomes.answers) == (False, {}, {})
