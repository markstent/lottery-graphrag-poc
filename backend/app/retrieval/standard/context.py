"""Context selection: one token budget, two ranked channels (method v0.3, D-084).

Every pipeline answers from one total token budget with no item limit, and
every item is charged the tokens of the block the prompt shows for it
(``block_tokens``), so A, B and C pay the same for the same block; a
graph record's declared path line (D-085) is paid for from the same budget.

There are two ranked channels:

- documents: document chunks and record blocks from the shared hybrid
  search, in cross-encoder order (the shared re-ranker, identical in A, B
  and C);
- graph: structured graph nodes (pipelines B and C only), in graph
  relevance order (seeds, then target-type holders, then the rest; D-083).
  Nodes are never re-ranked by the cross-encoder.

``interleave_by_budget`` takes one item from each channel in turn, starting
with the documents, so B's and C's first block is A's first block. Each
offered item is checked in a fixed order, and the first failing check is its
discard reason:

1. ``same_record``: a record block or a node whose row (``document_id``) is
   already selected through the other channel. A row reaches the prompt
   once, at its first appearance;
2. ``context_budget``: its block does not fit the tokens left;
3. ``duplicate``: a document chunk that is a near-duplicate (Jaccard at or
   above the threshold) of a selected chunk. Records and nodes are never
   near-duplicates: two distinct rows with similar columns are different
   facts.

A refused item is recorded and the same channel offers its next item; an
admitted item passes the turn to the other channel. When one channel is used
up, the other continues alone. The walk is single-pass: a refused item is
never offered again. Every refusal is final anyway (the budget only shrinks,
and a selected row or chunk stays selected), so the single pass loses no
item that a second pass would admit.

Pipeline A has no graph channel, so its selection is its cross-encoder order
cut at the budget. The selected list is in prompt order.

History: D-025 (one shared cut over 12 slots) and D-081 (a graph share of
the slots) are superseded by D-083 and D-084; see DECISIONS.md.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass

from app.config import ContextSettings
from app.evidence import EvidenceChunk
from app.retrieval.standard.generation import context_block

SELECTION_BUDGET = "context_budget"
SELECTION_DUPLICATE = "duplicate"
# A record block or node whose row is already selected through the other channel.
SELECTION_SAME_RECORD = "same_record"
# A graph node whose label is in GraphRagSettings.excluded_labels (a
# directly resolved Document seed): it may anchor traversal but is never a
# structured candidate; its text reaches the model through the document channel.
SELECTION_EXCLUDED_LABEL = "excluded_label"

# EvidenceChunk.kind of a structured graph candidate.
NODE_KIND = "node"
# Kinds that stand for one authoritative row (``document_id`` is its id).
_ROW_KINDS = frozenset({"record", NODE_KIND})


def estimate_tokens(text: str) -> int:
    """Cheap deterministic token estimate (~4 characters per token)."""
    return max(1, math.ceil(len(text) / 4))


def block_tokens(chunk: EvidenceChunk) -> int:
    """The tokens an item costs: its rendered prompt block, not its bare text."""
    return estimate_tokens(context_block(chunk))


def _token_set(text: str) -> set[str]:
    return set(text.lower().split())


def _jaccard(left: set[str], right: set[str]) -> float:
    union = left | right
    if not union:
        return 0.0
    return len(left & right) / len(union)


def interleave_by_budget(
    documents: Sequence[EvidenceChunk],
    graph: Sequence[EvidenceChunk],
    budget_tokens: int,
    dedupe_threshold: float,
) -> tuple[list[EvidenceChunk], list[EvidenceChunk]]:
    """Merge the two ranked channels into (selected, discarded-with-reason).

    ``selected`` is in prompt order; ``discarded`` in the order the items
    were offered. The module docstring states the rule.
    """
    channels = (list(documents), list(graph))
    heads = [0, 0]
    turn = 0  # the document channel starts
    selected: list[EvidenceChunk] = []
    discarded: list[EvidenceChunk] = []
    used = 0
    rows: set[str] = set()
    chunk_token_sets: list[set[str]] = []

    while heads[0] < len(channels[0]) or heads[1] < len(channels[1]):
        channel = turn if heads[turn] < len(channels[turn]) else 1 - turn
        candidate = channels[channel][heads[channel]]
        heads[channel] += 1
        tokens = block_tokens(candidate)
        token_set = _token_set(candidate.text) if candidate.kind == "chunk" else set()
        reason: str | None = None
        if candidate.kind in _ROW_KINDS and candidate.document_id in rows:
            reason = SELECTION_SAME_RECORD
        elif used + tokens > budget_tokens:
            reason = SELECTION_BUDGET
        elif candidate.kind == "chunk" and any(
            _jaccard(token_set, kept) >= dedupe_threshold for kept in chunk_token_sets
        ):
            reason = SELECTION_DUPLICATE
        if reason is not None:
            discarded.append(candidate.model_copy(update={"discard_reason": reason}))
            continue
        selected.append(candidate.model_copy(update={"selected": True}))
        used += tokens
        if candidate.kind in _ROW_KINDS:
            rows.add(candidate.document_id)
        if candidate.kind == "chunk":
            chunk_token_sets.append(token_set)
        turn = 1 - channel

    return selected, discarded


@dataclass(frozen=True, slots=True)
class ContextAssembly:
    """Outcome of one context selection under the shared budget.

    ``selected`` is the one list every pipeline hands the generator, in
    prompt order. ``document_selected`` (chunks and records) and
    ``structured_selected`` (graph nodes) are the same selection split by
    channel, for telemetry only. ``context_tokens`` is the sum of the
    selected items' block tokens.
    """

    selected: list[EvidenceChunk]
    structured_selected: list[EvidenceChunk]
    document_selected: list[EvidenceChunk]
    discarded: list[EvidenceChunk]  # every discarded candidate with its reason
    context_tokens: int


def assemble_context(
    documents: Sequence[EvidenceChunk],
    graph: Sequence[EvidenceChunk],
    settings: ContextSettings,
) -> ContextAssembly:
    """Select the ranked document and graph channels into the one budget."""
    selected, discarded = interleave_by_budget(
        documents, graph, settings.budget_tokens, settings.dedupe_threshold
    )
    return ContextAssembly(
        selected=selected,
        structured_selected=[chunk for chunk in selected if chunk.kind == NODE_KIND],
        document_selected=[chunk for chunk in selected if chunk.kind != NODE_KIND],
        discarded=discarded,
        context_tokens=sum(block_tokens(chunk) for chunk in selected),
    )
