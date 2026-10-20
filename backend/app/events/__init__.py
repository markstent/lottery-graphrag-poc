"""Typed retrieval telemetry events (docs/07-api-event-spec.md sections 7-11).

Events are the sole driver of UI visuals and the record used for replay.
Every pipeline emits into an EventSink; nothing else observes execution.
"""

from __future__ import annotations

import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

# Standard RAG event types (docs/07 section 7).
RAG_QUERY_RECEIVED = "rag.query.received"
RAG_EMBEDDING_STARTED = "rag.embedding.started"
RAG_EMBEDDING_COMPLETED = "rag.embedding.completed"
RAG_VECTOR_SEARCH_STARTED = "rag.vector_search.started"
RAG_CANDIDATE_RETRIEVED = "rag.candidate.retrieved"
RAG_RERANK_STARTED = "rag.rerank.started"
RAG_CANDIDATE_RERANKED = "rag.candidate.reranked"
RAG_EVIDENCE_SELECTED = "rag.evidence.selected"
RAG_EVIDENCE_DISCARDED = "rag.evidence.discarded"
RAG_CONTEXT_ASSEMBLED = "rag.context.assembled"
RAG_GENERATION_STARTED = "rag.generation.started"
RAG_GENERATION_COMPLETED = "rag.generation.completed"

# Graph pipeline event types (docs/07 section 8) are declared alongside so
# both pipelines share one sink contract from the start.
GRAPH_ENTITY_RESOLUTION_STARTED = "graph.entity_resolution.started"
GRAPH_ENTITY_RESOLVED = "graph.entity.resolved"
GRAPH_QUERY_EXPANDED = "graph.query.expanded"
GRAPH_SEED_SELECTED = "graph.seed.selected"
GRAPH_TRAVERSAL_STARTED = "graph.traversal.started"
GRAPH_NODE_DISCOVERED = "graph.node.discovered"
GRAPH_RELATIONSHIP_TRAVERSED = "graph.relationship.traversed"
GRAPH_ONTOLOGY_EXPANDED = "graph.ontology.expanded"
GRAPH_RERANK_STARTED = "graph.rerank.started"
GRAPH_CANDIDATE_RERANKED = "graph.candidate.reranked"
GRAPH_CANDIDATE_SELECTED = "graph.candidate.selected"
GRAPH_CANDIDATE_DISCARDED = "graph.candidate.discarded"
GRAPH_EVIDENCE_PATH_COMPLETED = "graph.evidence_path.completed"
GRAPH_CONTEXT_ASSEMBLED = "graph.context.assembled"
GRAPH_GENERATION_STARTED = "graph.generation.started"
GRAPH_GENERATION_COMPLETED = "graph.generation.completed"

# Run lifecycle event types (Phase 4). The API worker emits them around the
# pipelines' own events: ``run.*`` under the pipeline id ``run``, and
# ``pipeline.*`` under the id of the pipeline they describe. ``pipeline.failed``,
# ``pipeline.cancelled``, ``run.failed`` and ``run.cancelled`` carry the error
# envelope.
RUN_PIPELINE = "run"
RUN_STARTED = "run.started"
PIPELINE_STARTED = "pipeline.started"
PIPELINE_COMPLETED = "pipeline.completed"
PIPELINE_FAILED = "pipeline.failed"
PIPELINE_CANCELLED = "pipeline.cancelled"
RUN_COMPLETED = "run.completed"
RUN_FAILED = "run.failed"
RUN_CANCELLED = "run.cancelled"
TERMINAL_EVENT_TYPES = frozenset({RUN_COMPLETED, RUN_FAILED, RUN_CANCELLED})

EventValue = str | int | float | bool | None


@dataclass(frozen=True, slots=True)
class RetrievalEvent:
    """One observable execution event, JSON-ready for the SSE transport."""

    event_type: str
    pipeline: str
    t_ms: float
    event_id: str
    timestamp: str
    payload: dict[str, EventValue] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        """The one serialisation of an event (stored, replayed and streamed as is)."""
        return {
            "event_id": self.event_id,
            "timestamp": self.timestamp,
            "event_type": self.event_type,
            "pipeline": self.pipeline,
            "t_ms": round(self.t_ms, 1),
            "payload": self.payload,
        }


class EventSink:
    """Destination for pipeline telemetry."""

    def emit(self, event: RetrievalEvent) -> None:
        raise NotImplementedError


class ListEventSink(EventSink):
    """Collects events in memory (the CLIs, the benchmark runner and tests)."""

    def __init__(self) -> None:
        self.events: list[RetrievalEvent] = []

    def emit(self, event: RetrievalEvent) -> None:
        self.events.append(event)


Clock = Callable[[], float]


def monotonic_ms() -> float:
    return time.monotonic() * 1000.0


class EventEmitter:
    """Convenience wrapper binding pipeline id and clock to a sink."""

    def __init__(self, pipeline: str, sink: EventSink, clock: Clock = monotonic_ms) -> None:
        self.pipeline = pipeline
        self.sink = sink
        self.clock = clock

    def emit(self, event_type: str, **payload: EventValue) -> RetrievalEvent:
        event = RetrievalEvent(
            event_type=event_type,
            pipeline=self.pipeline,
            t_ms=self.clock(),
            event_id=uuid.uuid4().hex,
            timestamp=datetime.now(UTC).isoformat(),
            payload=payload,
        )
        self.sink.emit(event)
        return event


def new_run_id() -> str:
    """Fresh opaque run identifier (RUN-YYYYMMDD-HHMMSS-xxxxxxxx)."""
    stamp = time.strftime("%Y%m%d-%H%M%S", time.gmtime())
    return f"RUN-{stamp}-{uuid.uuid4().hex[:8]}"
