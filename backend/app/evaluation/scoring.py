"""Evidence metrics over discoveries and failure classes (benchmark v2;
docs/05-benchmark-spec.md sections 8 and 14; docs/evaluation/scoring.md).

The question's anchor is removed from both the required claims and the
selected evidence, so the metric scores what a pipeline discovered beyond
the id the question already names. Whether the anchor itself was resolved
is reported separately.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from app.evaluation.claims import Claim, exclude_anchor

# A score below this marks a weak answer or weak evidence (docs/05 section 14).
FAILURE_THRESHOLD = 0.5


@dataclass(frozen=True, slots=True)
class EvidenceScore:
    """Evidence metrics of one run; the evidence fields are None when no claim
    survives anchor exclusion."""

    recall: float | None
    precision: float | None
    f1: float | None
    claims_found: int | None
    claims_total: int
    efficiency_per_1k: float | None
    anchor_resolved: bool


def evidence_score(
    claims: Sequence[Claim],
    selected: Sequence[str],
    anchor_id: str,
    resolved_ids: Sequence[str],
    context_tokens: int,
) -> EvidenceScore:
    """Score the selected carriers (in selection order) against the claims.

    Recall is claims found over claims; precision is the share of distinct
    selected items that carry at least one claim; efficiency is claims found
    per 1,000 context tokens. The anchor is resolved when it is among the
    selected carriers or the resolved entity ids; pipeline A resolves no
    entities, so for A it reads the selection alone, by definition.
    """
    anchor_resolved = anchor_id in selected or anchor_id in resolved_ids
    scored = exclude_anchor(claims, anchor_id)
    if not scored:
        return EvidenceScore(None, None, None, None, 0, None, anchor_resolved)
    items = [item for item in dict.fromkeys(selected) if item != anchor_id]
    found = sum(1 for claim in scored if not claim.carriers.isdisjoint(items))
    carrying = sum(1 for item in items if any(item in claim.carriers for claim in scored))
    recall = found / len(scored)
    precision = carrying / len(items) if items else 0.0
    f1 = 2 * recall * precision / (recall + precision) if recall + precision else 0.0
    efficiency = found * 1000 / context_tokens if context_tokens else None
    return EvidenceScore(recall, precision, f1, found, len(scored), efficiency, anchor_resolved)


def classify_failure(answer: float | None, evidence: EvidenceScore, seeded: bool) -> str | None:
    """Primary failure class of a weak run, from scores and telemetry alone.

    ``seeded`` says the pipeline has an entity-resolution stage; a pipeline
    without one (A) cannot fail at resolution.
    """
    answered = answer is None or answer >= FAILURE_THRESHOLD
    retrieved = evidence.recall is None or evidence.recall >= FAILURE_THRESHOLD
    if answered and retrieved:
        return None
    if seeded and not evidence.anchor_resolved:
        return "entity_resolution_failure"
    if not retrieved:
        return "retrieval_failure"
    return "generation_failure"
