"""The event envelope as one discriminated union over ``event_type``.

Each member pairs an event type with its payload model (``app.events.payloads``),
so the OpenAPI contract, and the frontend types generated from it, carry the
payload of every event the API can replay or stream (docs/reference/07 sections 6 to 11).
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, RootModel

from app.events.payloads import (
    Empty,
    ErrorPayload,
    GenerationCompleted,
    GraphCandidateReranked,
    GraphChunkDiscarded,
    GraphChunkSelected,
    GraphContextAssembled,
    GraphEntityResolutionStarted,
    GraphEntityResolved,
    GraphEvidencePathCompleted,
    GraphNodeDiscarded,
    GraphNodeDiscovered,
    GraphNodeSelected,
    GraphOntologyExpanded,
    GraphQueryExpanded,
    GraphRelationshipTraversed,
    GraphSeedSelected,
    GraphTraversalStarted,
    ModelStarted,
    RagCandidateReranked,
    RagCandidateRetrieved,
    RagContextAssembled,
    RagEmbeddingCompleted,
    RagEvidenceDiscarded,
    RagEvidenceSelected,
    RagQueryReceived,
    RagVectorSearchStarted,
    RerankStarted,
)


class _Envelope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_id: str
    timestamp: str
    run_id: str
    pipeline: Literal["A", "B", "C", "run"]
    t_ms: float
    sequence: int


class RunStarted(_Envelope):
    event_type: Literal["run.started"]
    payload: Empty


class PipelineStarted(_Envelope):
    event_type: Literal["pipeline.started"]
    payload: Empty


class PipelineCompleted(_Envelope):
    event_type: Literal["pipeline.completed"]
    payload: Empty


class PipelineFailed(_Envelope):
    event_type: Literal["pipeline.failed"]
    payload: ErrorPayload


class PipelineCancelled(_Envelope):
    event_type: Literal["pipeline.cancelled"]
    payload: ErrorPayload


class RunCompleted(_Envelope):
    event_type: Literal["run.completed"]
    payload: Empty


class RunFailed(_Envelope):
    event_type: Literal["run.failed"]
    payload: ErrorPayload


class RunCancelled(_Envelope):
    event_type: Literal["run.cancelled"]
    payload: ErrorPayload


class RagQueryReceivedEvent(_Envelope):
    event_type: Literal["rag.query.received"]
    payload: RagQueryReceived


class RagEmbeddingStartedEvent(_Envelope):
    event_type: Literal["rag.embedding.started"]
    payload: ModelStarted


class RagEmbeddingCompletedEvent(_Envelope):
    event_type: Literal["rag.embedding.completed"]
    payload: RagEmbeddingCompleted


class RagVectorSearchStartedEvent(_Envelope):
    event_type: Literal["rag.vector_search.started"]
    payload: RagVectorSearchStarted


class RagCandidateRetrievedEvent(_Envelope):
    event_type: Literal["rag.candidate.retrieved"]
    payload: RagCandidateRetrieved


class RagRerankStartedEvent(_Envelope):
    event_type: Literal["rag.rerank.started"]
    payload: RerankStarted


class RagCandidateRerankedEvent(_Envelope):
    event_type: Literal["rag.candidate.reranked"]
    payload: RagCandidateReranked


class RagEvidenceSelectedEvent(_Envelope):
    event_type: Literal["rag.evidence.selected"]
    payload: RagEvidenceSelected


class RagEvidenceDiscardedEvent(_Envelope):
    event_type: Literal["rag.evidence.discarded"]
    payload: RagEvidenceDiscarded


class RagContextAssembledEvent(_Envelope):
    event_type: Literal["rag.context.assembled"]
    payload: RagContextAssembled


class RagGenerationStartedEvent(_Envelope):
    event_type: Literal["rag.generation.started"]
    payload: ModelStarted


class RagGenerationCompletedEvent(_Envelope):
    event_type: Literal["rag.generation.completed"]
    payload: GenerationCompleted


class GraphEntityResolutionStartedEvent(_Envelope):
    event_type: Literal["graph.entity_resolution.started"]
    payload: GraphEntityResolutionStarted


class GraphEntityResolvedEvent(_Envelope):
    event_type: Literal["graph.entity.resolved"]
    payload: GraphEntityResolved


class GraphQueryExpandedEvent(_Envelope):
    event_type: Literal["graph.query.expanded"]
    payload: GraphQueryExpanded


class GraphSeedSelectedEvent(_Envelope):
    event_type: Literal["graph.seed.selected"]
    payload: GraphSeedSelected


class GraphTraversalStartedEvent(_Envelope):
    event_type: Literal["graph.traversal.started"]
    payload: GraphTraversalStarted


class GraphNodeDiscoveredEvent(_Envelope):
    event_type: Literal["graph.node.discovered"]
    payload: GraphNodeDiscovered


class GraphRelationshipTraversedEvent(_Envelope):
    event_type: Literal["graph.relationship.traversed"]
    payload: GraphRelationshipTraversed


class GraphOntologyExpandedEvent(_Envelope):
    event_type: Literal["graph.ontology.expanded"]
    payload: GraphOntologyExpanded


class GraphRerankStartedEvent(_Envelope):
    event_type: Literal["graph.rerank.started"]
    payload: RerankStarted


class GraphCandidateRerankedEvent(_Envelope):
    event_type: Literal["graph.candidate.reranked"]
    payload: GraphCandidateReranked


class GraphCandidateSelectedEvent(_Envelope):
    event_type: Literal["graph.candidate.selected"]
    payload: GraphNodeSelected | GraphChunkSelected


class GraphCandidateDiscardedEvent(_Envelope):
    event_type: Literal["graph.candidate.discarded"]
    payload: GraphNodeDiscarded | GraphChunkDiscarded


class GraphEvidencePathCompletedEvent(_Envelope):
    event_type: Literal["graph.evidence_path.completed"]
    payload: GraphEvidencePathCompleted


class GraphContextAssembledEvent(_Envelope):
    event_type: Literal["graph.context.assembled"]
    payload: GraphContextAssembled


class GraphGenerationStartedEvent(_Envelope):
    event_type: Literal["graph.generation.started"]
    payload: ModelStarted


class GraphGenerationCompletedEvent(_Envelope):
    event_type: Literal["graph.generation.completed"]
    payload: GenerationCompleted


class RecordedEvent(
    RootModel[
        Annotated[
            RunStarted
            | PipelineStarted
            | PipelineCompleted
            | PipelineFailed
            | PipelineCancelled
            | RunCompleted
            | RunFailed
            | RunCancelled
            | RagQueryReceivedEvent
            | RagEmbeddingStartedEvent
            | RagEmbeddingCompletedEvent
            | RagVectorSearchStartedEvent
            | RagCandidateRetrievedEvent
            | RagRerankStartedEvent
            | RagCandidateRerankedEvent
            | RagEvidenceSelectedEvent
            | RagEvidenceDiscardedEvent
            | RagContextAssembledEvent
            | RagGenerationStartedEvent
            | RagGenerationCompletedEvent
            | GraphEntityResolutionStartedEvent
            | GraphEntityResolvedEvent
            | GraphQueryExpandedEvent
            | GraphSeedSelectedEvent
            | GraphTraversalStartedEvent
            | GraphNodeDiscoveredEvent
            | GraphRelationshipTraversedEvent
            | GraphOntologyExpandedEvent
            | GraphRerankStartedEvent
            | GraphCandidateRerankedEvent
            | GraphCandidateSelectedEvent
            | GraphCandidateDiscardedEvent
            | GraphEvidencePathCompletedEvent
            | GraphContextAssembledEvent
            | GraphGenerationStartedEvent
            | GraphGenerationCompletedEvent,
            Field(discriminator="event_type"),
        ]
    ]
):
    """One execution event: the envelope shared by replay and the stream
    (docs/reference/07 section 6). ``pipeline`` is ``run`` for run lifecycle events."""
