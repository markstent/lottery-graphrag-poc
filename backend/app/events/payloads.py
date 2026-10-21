"""The payload of every execution event, one model per event type.

Pipelines emit plain dicts through ``EventEmitter.emit``; these models are the
declared shape of those dicts. They feed the OpenAPI contract (and so the
frontend's types) and a test validates every stored event against them.
``extra="forbid"`` makes a field added to an emitter without a model here a
failure rather than silent drift.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.api.errors import ApiErrorBody

DiscardReason = Literal[
    "excluded_label",
    "out_of_scope_market",
    "superseded_by_structured_fact",
    "context_budget",
    "slot_limit",
    "duplicate",
]
EntityOrigin = Literal["id", "market_alias", "term", "concept_binding", "vector_fallback"]
CandidateKind = Literal["node", "chunk", "record"]


class Payload(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Empty(Payload):
    """Lifecycle events that carry no fields."""


class ErrorPayload(ApiErrorBody):
    """``pipeline.failed``, ``pipeline.cancelled``, ``run.failed`` and
    ``run.cancelled`` carry the docs/07 section 11 error envelope."""

    model_config = ConfigDict(extra="forbid")


# -- standard RAG (docs/07 section 7) ----------------------------------------


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


class RagContextAssembled(Payload):
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


# -- graph (docs/07 section 8) ------------------------------------------------


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
    candidate_id: str
    kind: CandidateKind
    rerank_score: float | None
    rank: int


class GraphNodeSelected(Payload):
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
    node_id: str
    score: float
    rerank_score: float | None
    hops: int
    seed: bool
    reason: DiscardReason


class GraphChunkDiscarded(Payload):
    chunk_id: str
    rerank_score: float | None
    reason: DiscardReason


class GraphEvidencePathCompleted(Payload):
    paths: int
    max_hops: int


class GraphContextAssembled(Payload):
    structured_nodes: int
    document_chunks: int
    context_tokens: int
    evidence_slots: int
