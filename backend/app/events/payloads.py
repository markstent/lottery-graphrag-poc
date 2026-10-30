"""The payload of every execution event, one model per event type.

Pipelines emit plain dicts through ``EventEmitter.emit``; these models are the
declared shape of those dicts. They feed the OpenAPI contract (and so the
frontend's types) and a test validates every stored event against them.
``extra="forbid"`` makes a field added to an emitter without a model here a
failure rather than silent drift.

Stored Live Lab runs of the old method (v0.2, the slot rule of D-081) replay
through these models: every payload whose fields or discard reasons changed
keeps an OldMethod... model beside the current one, and the union accepts
either. The current models accept only the current reasons
(DiscardReason); the old ones also accept the reasons only v0.2 gave
(OldMethodDiscardReason). Method v0.3 code never emits an old shape.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.api.errors import ApiErrorBody
from app.evidence import GraphTier

DiscardReason = Literal[
    "excluded_label",
    "out_of_scope_market",
    "same_record",
    "context_budget",
    "duplicate",
]
# Every reason a stored old-method (v0.2) run may carry: the current ones and
# the two the slot rule gave.
OldMethodDiscardReason = Literal[
    DiscardReason,
    "superseded_by_structured_fact",
    "slot_limit",
]
EntityOrigin = Literal["id", "market_alias", "term", "concept_binding", "vector_fallback"]
CandidateKind = Literal["node", "chunk", "record"]


class Payload(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Empty(Payload):
    """Lifecycle events that carry no fields."""


class ErrorPayload(ApiErrorBody):
    """``pipeline.failed``, ``pipeline.cancelled``, ``run.failed`` and
    ``run.cancelled`` carry the docs/reference/07 section 11 error envelope."""

    model_config = ConfigDict(extra="forbid")


# -- standard RAG (docs/reference/07 section 7) ----------------------------------------


class RagQueryReceived(Payload):
    question: str
    markets: str


class ModelStarted(Payload):
    """Start of an embedding or generation stage (``rag.embedding.started``,
    ``rag.generation.started``, ``graph.generation.started``)."""

    model: str


class RagEmbeddingCompleted(Payload):
    model: str
    dimensions: int


class RagVectorSearchStarted(Payload):
    top_k: int


class RagCandidateRetrieved(Payload):
    chunk_id: str
    document_id: str
    similarity: float
    dense_rank: int | None
    sparse_rank: int | None
    rank: int


class RerankStarted(Payload):
    """``rag.rerank.started`` and ``graph.rerank.started``."""

    candidates: int
    model: str


class RagCandidateReranked(Payload):
    chunk_id: str
    similarity: float
    rerank_score: float | None
    rank: int


class RagEvidenceSelected(Payload):
    chunk_id: str
    rank: int


class RagEvidenceDiscarded(Payload):
    chunk_id: str
    reason: DiscardReason


class OldMethodRagEvidenceDiscarded(Payload):
    """Old method (v0.2) only: a discard with a reason of the slot rule."""

    chunk_id: str
    reason: OldMethodDiscardReason


class RagContextAssembled(Payload):
    selected: int
    discarded: int
    context_tokens: int
    budget_tokens: int  # the shared token budget (D-084)


class OldMethodRagContextAssembled(Payload):
    """Old method (v0.2) only: it recorded its evidence-slot count."""

    selected: int
    discarded: int
    context_tokens: int
    evidence_slots: int


class GenerationCompleted(Payload):
    """``rag.generation.completed`` and ``graph.generation.completed``."""

    model: str
    latency_ms: float
    context_tokens: int
    verdict: str
    cited_blocks: int


# -- graph (docs/reference/07 section 8) ------------------------------------------------


class GraphEntityResolutionStarted(Payload):
    question: str
    markets: str


class GraphEntityResolved(Payload):
    """A resolver match carries ``confidence``; a vector fallback seed has no
    resolver confidence and carries ``fused_score`` instead."""

    entity_id: str
    node_label: str
    origin: EntityOrigin
    matched_text: str
    via_concept: str | None
    confidence: float | None = None
    fused_score: float | None = None


class GraphQueryExpanded(Payload):
    added_terms: int
    expanded_length: int


class GraphTargetTypesResolved(Payload):
    """The graph labels the question asks about, sorted and comma-joined; ""
    when it names none (D-083)."""

    labels: str


class GraphSeedSelected(Payload):
    node_id: str


class GraphTraversalStarted(Payload):
    max_depth: int
    max_nodes_per_hop: int
    max_edges_per_node_type: int
    max_total_nodes: int
    relationship_types: int
    ontology_expansion: bool


class GraphNodeDiscovered(Payload):
    node_id: str
    node_label: str
    hop: int
    via_concept: str | None = None


class GraphRelationshipTraversed(Payload):
    from_id: str
    relationship_type: str
    to_id: str
    to_label: str
    hop: int


class GraphOntologyExpanded(Payload):
    concept_id: str
    bound_entities: int


class GraphCandidateReranked(Payload):
    """A document candidate's cross-encoder outcome (old-method runs also
    re-ranked nodes, with ``kind`` "node")."""

    candidate_id: str
    kind: CandidateKind
    rerank_score: float | None
    rank: int


class GraphNodeSelected(Payload):
    """``tier`` and ``graph_rank`` place the node in the graph channel's
    relevance order (D-083)."""

    node_id: str
    score: float
    hops: int
    seed: bool
    tier: GraphTier
    graph_rank: int
    weight_graph_distance: float
    weight_relationship_type: float
    weight_semantic_relevance: float
    weight_temporal_validity: float


class OldMethodGraphNodeSelected(Payload):
    """Old method (v0.2) only: nodes were re-ranked with the documents."""

    node_id: str
    score: float
    rerank_score: float | None
    hops: int
    seed: bool
    weight_graph_distance: float
    weight_relationship_type: float
    weight_semantic_relevance: float
    weight_temporal_validity: float


class GraphChunkSelected(Payload):
    chunk_id: str
    rerank_score: float | None
    rank: int


class GraphNodeDiscarded(Payload):
    """``tier`` and ``graph_rank`` are None only for a node refused before
    the graph order (``out_of_scope_market``, ``excluded_label``)."""

    node_id: str
    score: float
    hops: int
    seed: bool
    reason: DiscardReason
    tier: GraphTier | None
    graph_rank: int | None


class OldMethodGraphNodeDiscarded(Payload):
    """Old method (v0.2) only: nodes were re-ranked with the documents."""

    node_id: str
    score: float
    rerank_score: float | None
    hops: int
    seed: bool
    reason: OldMethodDiscardReason


class GraphChunkDiscarded(Payload):
    chunk_id: str
    rerank_score: float | None
    reason: DiscardReason


class OldMethodGraphChunkDiscarded(Payload):
    """Old method (v0.2) only: a discard with a reason of the slot rule."""

    chunk_id: str
    rerank_score: float | None
    reason: OldMethodDiscardReason


class GraphEvidencePathCompleted(Payload):
    paths: int
    max_hops: int


class GraphContextAssembled(Payload):
    """``stated_links`` counts the schema-stated links read among the reached
    nodes for the target-type tier; None when none were read (the question
    names no target type)."""

    structured_nodes: int
    document_chunks: int
    context_tokens: int
    budget_tokens: int  # the shared token budget (D-084)
    stated_links: int | None


class OldMethodGraphContextAssembled(Payload):
    """Old method (v0.2) only: it recorded its evidence-slot count."""

    structured_nodes: int
    document_chunks: int
    context_tokens: int
    evidence_slots: int
