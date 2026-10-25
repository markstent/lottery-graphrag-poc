"""Context budget selection (docs/reference/retrieval/context-budgeting.md).

Every pipeline answers from one total token budget and one evidence-slot
count (retrieval fairness), and one judge orders the candidates: the shared
reranker scores every candidate a pipeline has, and selection walks the
reranked list once, in judge order. Pipeline A's candidates are its hybrid
hits; pipelines B and C add structured graph candidates to the same list.

The graph share (D-081, which superseded D-025's single shared cut and
D-023's "no reserved slots per channel"): of the evidence slots,
``graph_slots`` are reserved for graph nodes and the rest go to documents
(chunks and records). Before the walk, the first ``graph_slots`` usable nodes
in judge order are given a graph slot; a node is usable when its own tokens
fit the whole budget. Every other node is refused as ``slot_limit``. During
the walk a document is admitted only while the selected items plus the graph
slots still waiting for their node leave room, so documents never take a
graph slot. The share goes one way: a graph slot that no node fills (fewer
usable nodes than the share) goes to documents, but a document slot that no
document fills never goes to a node. Pipeline A has no nodes and so keeps
every slot for documents, exactly as under D-025.

A record block competes as a document under its own rank, except when its
node holds a graph slot: then the node is the authoritative copy (design
10a.8, D-028) and the block is refused as ``superseded_by_structured_fact``,
so one fact never takes two slots. A node refused by the share leaves its
record block to compete as a document.

Known limitation: the walk is single-pass. A node that holds a slot but is
refused by the budget releases its slot at that point, so a later, lower
ranked document may take it, while a document already refused as
``slot_limit`` stays refused, because the walk never revisits a decision.
The budget rarely binds (pilot prompts used about 1,130 of 2,000 tokens).

For each candidate the checks run in a fixed order, and the first failing
check is the discard reason:

1. budget: the candidate's tokens do not fit the remaining budget
   (``context_budget``); a smaller later candidate may still fit. Nodes and
   documents share the one budget in judge order, so neither channel
   reserves any of it;
2. slots: the candidate's channel has no slot left (``slot_limit``);
3. duplicates: a document chunk is a near-duplicate of a selected chunk
   (``duplicate``). Records and graph nodes have unique ids and are never
   near-duplicates of each other: two distinct authoritative rows with
   similar columns are different facts.

The selected list stays in judge order whatever the channel. The final token
count is recorded on the event stream.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from app.config import ContextSettings
from app.evidence import EvidenceChunk

SELECTION_BUDGET = "context_budget"
SELECTION_DUPLICATE = "duplicate"
SELECTION_SLOT_LIMIT = "slot_limit"
# A record block whose node holds a graph slot (design 10a.8): the node is
# the authoritative copy.
SELECTION_SUPERSEDED = "superseded_by_structured_fact"
# A graph node whose label is in GraphRagSettings.excluded_labels (a
# directly resolved Document seed): it may anchor traversal but is never a
# structured candidate; its text reaches the model through the document channel.
SELECTION_EXCLUDED_LABEL = "excluded_label"

# EvidenceChunk.kind of a structured graph candidate.
NODE_KIND = "node"


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
    *,
    graph_slots: int,
) -> tuple[list[EvidenceChunk], list[EvidenceChunk]]:
    """Split ranked candidates into (selected, discarded-with-reason).

    ``max_items`` caps how many candidates are selected (evidence slots);
    None means no cap and no graph share. ``graph_slots`` of those slots are
    reserved for graph nodes, as the module docstring describes. The
    near-duplicate check compares document chunks (``kind == "chunk"``) with
    the chunks already selected; records and nodes skip it. Discarded
    candidates keep their discard_reason so the UI and the benchmark can show
    why context looks the way it does.
    """
    selected: list[EvidenceChunk] = []
    discarded: list[EvidenceChunk] = []
    used = 0
    selected_token_sets: list[set[str]] = []

    holders = _graph_slot_holders(candidates, budget_tokens, max_items, graph_slots)
    waiting = len(holders)
    # A node holding a slot is the authoritative copy of its record's fact.
    superseding = {candidates[index].chunk_id for index in holders}

    for index, candidate in enumerate(candidates):
        tokens = estimate_tokens(candidate.text)
        holds_slot = index in holders
        if holds_slot:
            waiting -= 1  # its slot is filled below or released by a refusal
        if candidate.kind == "record" and candidate.document_id in superseding:
            discarded.append(candidate.model_copy(update={"discard_reason": SELECTION_SUPERSEDED}))
            continue
        if used + tokens > budget_tokens:
            discarded.append(candidate.model_copy(update={"discard_reason": SELECTION_BUDGET}))
            continue
        if candidate.kind == NODE_KIND:
            slot_free = holds_slot or max_items is None
        else:
            slot_free = max_items is None or len(selected) + waiting < max_items
        if not slot_free:
            discarded.append(candidate.model_copy(update={"discard_reason": SELECTION_SLOT_LIMIT}))
            continue
        if candidate.kind == "chunk":
            token_set = _token_set(candidate.text)
            if any(
                _jaccard(token_set, existing) >= dedupe_threshold
                for existing in selected_token_sets
            ):
                discarded.append(
                    candidate.model_copy(update={"discard_reason": SELECTION_DUPLICATE})
                )
                continue
            selected_token_sets.append(token_set)
        selected.append(candidate.model_copy(update={"selected": True}))
        used += tokens

    return selected, discarded


def _graph_slot_holders(
    candidates: list[EvidenceChunk],
    budget_tokens: int,
    max_items: int | None,
    graph_slots: int,
) -> set[int]:
    """Indexes of the nodes given a graph slot: the first usable ones in judge order."""
    if max_items is None:
        return set()
    share = min(graph_slots, max_items)
    usable = [
        index
        for index, candidate in enumerate(candidates)
        if candidate.kind == NODE_KIND and estimate_tokens(candidate.text) <= budget_tokens
    ]
    return set(usable[:share])


@dataclass(frozen=True, slots=True)
class ContextAssembly:
    """Outcome of one context selection under the shared budget and slots.

    ``selected`` is the one list every pipeline hands the generator, in
    judge order whatever the kind. ``document_selected`` (chunks and
    records) and ``structured_selected`` (graph nodes) are the same
    selection split by channel, for telemetry only.
    """

    selected: list[EvidenceChunk]
    structured_selected: list[EvidenceChunk]
    document_selected: list[EvidenceChunk]
    discarded: list[EvidenceChunk]  # every discarded candidate with its reason
    context_tokens: int


def assemble_context(candidates: list[EvidenceChunk], settings: ContextSettings) -> ContextAssembly:
    """Select reranked candidates into one budget, one slot count and the graph share."""
    selected, discarded = select_context(
        candidates,
        budget_tokens=settings.budget_tokens,
        dedupe_threshold=settings.dedupe_threshold,
        max_items=settings.evidence_slots,
        graph_slots=settings.graph_slots,
    )
    return ContextAssembly(
        selected=selected,
        structured_selected=[chunk for chunk in selected if chunk.kind == NODE_KIND],
        document_selected=[chunk for chunk in selected if chunk.kind != NODE_KIND],
        discarded=discarded,
        context_tokens=sum(estimate_tokens(chunk.text) for chunk in selected),
    )
