"""Context budget selection (docs/retrieval/context-budgeting.md).

Every pipeline answers from one total token budget and one evidence-slot
count (retrieval fairness): pipeline A spends both on document chunks;
pipelines B and C spend them on structured graph blocks first and give
the remainder to document chunks.

Selection walks candidates in rank order. For each candidate the checks
run in a fixed order, and the first failing check is the discard reason:

1. budget: the candidate's tokens do not fit the remaining budget
   (``context_budget``); a smaller later candidate may still fit;
2. slots: every evidence slot is already filled (``slot_limit``);
3. duplicates: the candidate is a near-duplicate of selected text
   (``duplicate``).

Priority therefore follows ranking: high-scoring evidence enters first;
diversity is protected by the duplicate filter. The final token count is
recorded on the event stream.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from app.config import ContextSettings
from app.evidence import EvidenceChunk

SELECTION_BUDGET = "context_budget"
SELECTION_DUPLICATE = "duplicate"
SELECTION_SLOT_LIMIT = "slot_limit"
# A record block whose record already enters as a structured graph fact
# (design 10a.8): the structured block is the authoritative copy.
SELECTION_SUPERSEDED = "superseded_by_structured_fact"


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
    max_items: int | None = None,
) -> tuple[list[EvidenceChunk], list[EvidenceChunk]]:
    """Split ranked candidates into (selected, discarded-with-reason).

    ``max_items`` caps how many candidates are selected (evidence slots);
    None means no cap. Discarded chunks keep their discard_reason so the UI
    and the benchmark can show why context looks the way it does.
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
        if max_items is not None and len(selected) >= max_items:
            discarded.append(candidate.model_copy(update={"discard_reason": SELECTION_SLOT_LIMIT}))
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


@dataclass(frozen=True, slots=True)
class ContextAssembly:
    """Outcome of one context assembly under the shared budget and slots."""

    structured_selected: list[EvidenceChunk]
    document_selected: list[EvidenceChunk]
    discarded: list[EvidenceChunk]  # every discarded item with its reason
    context_tokens: int


def assemble_context(
    structured: list[EvidenceChunk],
    documents: list[EvidenceChunk],
    settings: ContextSettings,
) -> ContextAssembly:
    """Fill one budget and one slot count: structured blocks, then documents.

    Structured blocks (graph nodes with their authoritative facts) are
    selected first; documents get the remaining tokens and slots. Pipeline A
    passes no structured blocks, so A, B and C share the same totals.
    """
    structured_selected, structured_discarded = select_context(
        structured,
        budget_tokens=settings.budget_tokens,
        dedupe_threshold=settings.dedupe_threshold,
        max_items=settings.evidence_slots,
    )
    structured_tokens = sum(estimate_tokens(chunk.text) for chunk in structured_selected)
    document_selected, document_discarded = select_context(
        documents,
        budget_tokens=settings.budget_tokens - structured_tokens,
        dedupe_threshold=settings.dedupe_threshold,
        max_items=settings.evidence_slots - len(structured_selected),
    )
    document_tokens = sum(estimate_tokens(chunk.text) for chunk in document_selected)
    return ContextAssembly(
        structured_selected=structured_selected,
        document_selected=document_selected,
        discarded=[*structured_discarded, *document_discarded],
        context_tokens=structured_tokens + document_tokens,
    )
