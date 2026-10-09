"""Deterministic scoring for benchmark runs (docs/05-benchmark-spec.md
sections 6 and 8; docs/evaluation/scoring.md).

No LLM judge in this phase: every score is computed from recorded evidence
and the answer text against grounded expected checks. If an LLM judge is
introduced later it must be versioned, identified per result, and never a
replacement for these deterministic metrics (docs/05 section 9).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

_NUMBER_PATTERN = re.compile(r"\d+(?:[.,]\d+)?")


def check_score(check: tuple[str, object], answer: str) -> float:
    """Score one expected-answer check against the answer text (0..1)."""
    kind, expected = check
    if kind == "number":
        target = _normalise_number(str(expected))
        numbers = (_normalise_number(match) for match in _NUMBER_PATTERN.findall(answer))
        return 1.0 if any(number == target for number in numbers) else 0.0
    if kind == "token":
        return 1.0 if _contains_token(answer, str(expected)) else 0.0
    if kind == "set":
        values = expected if isinstance(expected, frozenset) else frozenset()
        if not values:
            return 0.0
        found = sum(1 for value in values if _contains_token(answer, value))
        return found / len(values)
    raise ValueError(f"unknown check kind: {kind!r}")


def score_checks(checks: tuple[tuple[str, object], ...], answer: str) -> float | None:
    """Mean of all checks; None when the question grades on evidence only."""
    if not checks:
        return None
    return sum(check_score(check, answer) for check in checks) / len(checks)


def evidence_metrics(
    required: tuple[str, ...],
    retrieved: tuple[str, ...],
) -> tuple[float | None, float | None]:
    """Evidence recall and precision against required record ids.

    Recall: |retrieved & required| / |required|. Precision:
    |retrieved & required| / |retrieved|. Both None when the question has no
    required evidence.
    """
    if not required:
        return None, None
    required_set = set(required)
    retrieved_set = set(retrieved)
    hits = required_set & retrieved_set
    recall = len(hits) / len(required_set)
    precision = len(hits) / len(retrieved_set) if retrieved_set else 0.0
    return recall, precision


def classify_failure(
    answer_score: float | None,
    evidence_recall: float | None,
    seed_ids: tuple[str, ...],
    required: tuple[str, ...],
    retrieved_nodes: tuple[str, ...],
    discarded_nodes: tuple[str, ...],
) -> str | None:
    """Primary failure class for a weak result (docs/05 section 14).

    Heuristic and deterministic: it reads only pipeline telemetry, never the
    truth ledger beyond the required-evidence list the grounding produced.
    """
    threshold = 0.5
    answered = answer_score is None or answer_score >= threshold
    if answered and (evidence_recall is None or evidence_recall >= threshold):
        return None
    if not seed_ids:
        # Pipeline A has no entity resolution stage; a weak run there is a
        # pure retrieval failure.
        return "retrieval_failure"
    if any(seed in retrieved_nodes for seed in seed_ids):
        if evidence_recall == 0.0 and any(node in discarded_nodes for node in required):
            return "graph_traversal_failure"
        if evidence_recall is not None and evidence_recall < threshold:
            return "retrieval_failure"
        return "generation_failure"
    return "entity_resolution_failure"


def _normalise_number(text: str) -> str:
    normalised = text.replace(",", ".").rstrip("%")
    try:
        number = float(normalised)
    except ValueError:
        return normalised
    if number == int(number):
        return str(int(number))
    return f"{number:g}"


def _contains_token(answer: str, token: str) -> bool:
    pattern = r"(?<![A-Za-z0-9_])" + re.escape(token) + r"(?![A-Za-z0-9_])"
    return re.search(pattern, answer, flags=re.IGNORECASE) is not None


@dataclass(frozen=True, slots=True)
class PipelineRunResult:
    """What the harness records per (question, pipeline) execution."""

    pipeline: str
    answer: str
    selected_nodes: tuple[str, ...]
    discarded_nodes: tuple[str, ...]
    seed_ids: tuple[str, ...]
    selected_document_ids: tuple[str, ...]
    context_tokens: int
    latency_ms: float
    event_counts: dict[str, int]
    generation_failed: bool = False

    def retrieved_evidence(self) -> tuple[str, ...]:
        """Record ids a run surfaced as evidence (nodes + cited documents)."""
        return tuple(dict.fromkeys((*self.selected_nodes, *self.selected_document_ids)))

    def to_payload(self) -> dict[str, Any]:
        return {
            "pipeline": self.pipeline,
            "answer": self.answer,
            "selected_nodes": list(self.selected_nodes),
            "discarded_nodes": list(self.discarded_nodes),
            "seed_ids": list(self.seed_ids),
            "selected_document_ids": list(self.selected_document_ids),
            "context_tokens": self.context_tokens,
            "latency_ms": round(self.latency_ms, 1),
            "event_counts": self.event_counts,
        }


@dataclass(frozen=True, slots=True)
class QuestionScore:
    """Deterministic scores for one (question, pipeline) pair."""

    answer_score: float | None
    evidence_recall: float | None
    evidence_precision: float | None
    failure_class: str | None

    def to_payload(self) -> dict[str, Any]:
        return {
            "answer_score": self.answer_score,
            "evidence_recall": self.evidence_recall,
            "evidence_precision": self.evidence_precision,
            "failure_class": self.failure_class,
        }
