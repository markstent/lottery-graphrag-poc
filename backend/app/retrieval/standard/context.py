"""Context budget selection (docs/retrieval/context-budgeting.md).

Selection walks candidates in rank order and keeps chunks while the token
budget allows, skipping near-duplicates. Priority therefore follows ranking:
authoritative, high-scoring evidence enters first; diversity is protected by
the duplicate filter. The final token count is recorded on the event stream.
"""

from __future__ import annotations

import math

from app.evidence import EvidenceChunk

SELECTION_BUDGET = "context_budget"
SELECTION_DUPLICATE = "duplicate"


def estimate_tokens(text: str) -> int:
    """Cheap deterministic token estimate (~4 characters per token)."""
    return max(1, math.ceil(len(text) / 4))


def _token_set(text: str) -> set[str]:
    return set(text.lower().split())


def _jaccard(left: set[str], right: set[str]) -> float:
    union = left | right
    if not union:
        return 0.0
    return len(left & right) / len(union)


def select_context(
    candidates: list[EvidenceChunk],
    budget_tokens: int,
    dedupe_threshold: float = 0.85,
) -> tuple[list[EvidenceChunk], list[EvidenceChunk]]:
    """Split ranked candidates into (selected, discarded-with-reason).

    Discarded chunks keep their discard_reason so the UI and the benchmark
    can show why context looks the way it does.
    """
    selected: list[EvidenceChunk] = []
    discarded: list[EvidenceChunk] = []
    used = 0
    selected_token_sets: list[set[str]] = []

    for candidate in candidates:
        tokens = estimate_tokens(candidate.text)
        if used + tokens > budget_tokens:
            discarded.append(candidate.model_copy(update={"discard_reason": SELECTION_BUDGET}))
            continue
        token_set = _token_set(candidate.text)
        if any(
            _jaccard(token_set, existing) >= dedupe_threshold for existing in selected_token_sets
        ):
            discarded.append(candidate.model_copy(update={"discard_reason": SELECTION_DUPLICATE}))
            continue
        selected.append(candidate.model_copy(update={"selected": True}))
        selected_token_sets.append(token_set)
        used += tokens

    return selected, discarded
