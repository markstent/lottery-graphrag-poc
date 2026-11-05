"""Evidence and answer outcomes of a stored run, as counts.

Two views of a run read these counts (docs/superpowers/specs/2026-11-05-help-readability-design.md):

- Evidence: claims found and missed, summed over the repeats whose question
  keeps at least one claim after anchor exclusion (``claims_total`` above 0);
  a repeat with no claim left is not measured and is in no count. The share
  found is the published evidence recall, built as the summary builds it: the
  mean over questions of each question's mean recall (``report.instance_means``).
  It differs from the pooled counts by construction, since a question with
  many claims weighs more in the pool. Extra records are the distinct selected
  items, apart from the anchor, that carry no claim, by the scorer's own rule
  (``scoring.selected_items`` and ``scoring.carries_claim``), averaged first
  over a question's measured repeats and then over questions.
- Answers: every scored repeat falls in one band by its answer score: right
  (exactly 1), partly right (above 0, below 1) or wrong (0), the levels of
  ``judge.answer_level``. Inside each band the repeats whose verdict is an
  abstention (``checks.is_abstention``) are counted again as declined; a
  decline stays in its band. A repeat without an answer score (no checks, or a
  failed generation) is ``not_scored``. ``partly_score_sum`` adds up the
  partly right scores, so (right + partly_score_sum) / scored is the mean
  answer score per repeat, the published mean whenever every question has as
  many scored repeats (one each in the official run).

Everything is read from the run's own results (``results.json``): the
instance's claims are the evaluator output the run stored, so no truth
ledger is read. Nothing here writes to a run.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from statistics import mean
from typing import Any

from app.evaluation.checks import is_abstention
from app.evaluation.claims import exclude_anchor
from app.evaluation.judge import answer_level
from app.evaluation.report import instance_means
from app.evaluation.runner import InstanceResult, instance_result_from_payload
from app.evaluation.scoring import carries_claim, selected_items

# The evidence fields a stored score must hold for the evidence view.
_EVIDENCE_FIELDS = ("claims_found", "claims_total")
# The bands by ``answer_level``: 0 is wrong (0), 1 partly right, 2 right (exactly 1).
_BANDS = ("wrong", "partly", "right")


@dataclass(frozen=True, slots=True)
class EvidenceCounts:
    """One pipeline's evidence over its measured repeats; ``found_share`` and
    ``extra_per_question`` are means over questions, None when no question was
    measured."""

    repeats: int
    found: int
    missed: int
    found_share: float | None
    extra_per_question: float | None


@dataclass(frozen=True, slots=True)
class AnswerCounts:
    """One pipeline's answers by band; each ``*_declined`` is inside its band."""

    scored: int
    right: int
    partly: int
    partly_score_sum: float
    wrong: int
    right_declined: int
    partly_declined: int
    wrong_declined: int
    not_scored: int


@dataclass(frozen=True, slots=True)
class RunOutcomes:
    """The counts per pipeline; ``recorded`` is False, with both maps empty,
    for a run that did not store what the counts need."""

    recorded: bool
    evidence: dict[str, EvidenceCounts]
    answers: dict[str, AnswerCounts]


NOT_RECORDED = RunOutcomes(recorded=False, evidence={}, answers={})


def run_outcomes(results: Sequence[InstanceResult]) -> RunOutcomes:
    """The evidence and answer counts of every pipeline over ``results``.

    A run in which no instance carries a claim (one recorded before claims
    were stored, or no run at all) is not recorded rather than counted as zeros.
    """
    if not any(result.instance.claims for result in results):
        return NOT_RECORDED
    tags = sorted({tag for result in results for tag in result.runs})
    return RunOutcomes(
        recorded=True,
        evidence={tag: _evidence(results, tag) for tag in tags},
        answers={tag: _answers(results, tag) for tag in tags},
    )


def payload_outcomes(payload: Mapping[str, Any]) -> RunOutcomes:
    """The counts of a run as ``results.json`` stores it; a run whose
    repeats lack ``selected``, whose instances lack ``claims`` or whose
    scores lack the claim counts is not recorded."""
    entries = [entry for world in payload["worlds"] for entry in world["results"]]
    if not all(_has_fields(entry) for entry in entries):
        return NOT_RECORDED
    return run_outcomes([instance_result_from_payload(entry) for entry in entries])


def _has_fields(entry: Mapping[str, Any]) -> bool:
    runs = [run for repeats in entry["runs"].values() for run in repeats]
    scores = [s for repeats in entry["scores"].values() for s in repeats if s is not None]
    return (
        "claims" in entry["instance"]
        and all("selected" in run for run in runs)
        and all(field in score["evidence"] for score in scores for field in _EVIDENCE_FIELDS)
    )


def _evidence(results: Sequence[InstanceResult], tag: str) -> EvidenceCounts:
    repeats = found = missed = 0
    recalls: list[float] = []
    extras: list[float] = []
    for result in results:
        anchor = result.instance.anchor_id
        claims = exclude_anchor(result.instance.claims, anchor)
        extra: list[int] = []
        for run, score in zip(result.runs.get(tag, []), result.scores.get(tag, []), strict=True):
            if score is None or score.evidence.claims_total == 0:
                continue
            # The scorer sets claims_found whenever a claim is left.
            claims_found = score.evidence.claims_found or 0
            repeats += 1
            found += claims_found
            missed += score.evidence.claims_total - claims_found
            items = selected_items(run.selected, anchor)
            extra.append(sum(1 for item in items if not carries_claim(item, claims)))
        if extra:
            extras.append(mean(extra))
        if tag in result.scores:
            recall = instance_means(result)[tag]["evidence_recall"]
            if recall is not None:
                recalls.append(recall)
    return EvidenceCounts(
        repeats=repeats,
        found=found,
        missed=missed,
        found_share=mean(recalls) if recalls else None,
        extra_per_question=mean(extras) if extras else None,
    )


def _answers(results: Sequence[InstanceResult], tag: str) -> AnswerCounts:
    bands = {"right": 0, "partly": 0, "wrong": 0}
    declined = {"right": 0, "partly": 0, "wrong": 0}
    partly_score_sum = 0.0
    not_scored = 0
    for result in results:
        for run, score in zip(result.runs.get(tag, []), result.scores.get(tag, []), strict=True):
            if score is None or score.answer is None:
                not_scored += 1
                continue
            band = _BANDS[answer_level(score.answer)]
            bands[band] += 1
            declined[band] += is_abstention(run.verdict)
            if band == "partly":
                partly_score_sum += score.answer
    return AnswerCounts(
        scored=sum(bands.values()),
        right=bands["right"],
        partly=bands["partly"],
        partly_score_sum=partly_score_sum,
        wrong=bands["wrong"],
        right_declined=declined["right"],
        partly_declined=declined["partly"],
        wrong_declined=declined["wrong"],
        not_scored=not_scored,
    )
