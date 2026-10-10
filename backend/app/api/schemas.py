"""Request and response models for the versioned public API.

Contracts follow docs/07-api-event-spec.md. Evidence DTOs reuse the typed
domain models in app.evidence directly: they are the retrieval layer's own
public record (provenance included) and are already Pydantic.
"""

from typing import Any, Literal

from pydantic import BaseModel, Field

from app.evidence import GraphRunResult, RagRunResult

PipelineId = Literal["A", "B", "C"]
QueryStatus = Literal["running", "completed", "failed"]


class HealthResponse(BaseModel):
    """Response for GET /api/v1/health."""

    status: Literal["ok"]
    version: str


class QueryRequest(BaseModel):
    """Request for POST /api/v1/queries (docs/07 section 4)."""

    question: str = Field(min_length=1, max_length=2000)
    configurations: list[PipelineId] = Field(default=["A", "B", "C"], min_length=1, max_length=3)
    # Fraud-topology questions need the player-instrument relationships
    # added to the B/C allow-list (same profile switch as the harness).
    profile: Literal["fraud"] | None = None


class QueryAccepted(BaseModel):
    """Response for POST /api/v1/queries: the run starts in the background."""

    run_id: str
    status: QueryStatus = "running"
    results_url: str
    events_url: str


class ApiError(BaseModel):
    """Typed error surface (docs/07 section 11); never a stack trace."""

    error_code: str
    message: str


class QueryResults(BaseModel):
    """Response for GET /api/v1/queries/{run_id}."""

    run_id: str
    question: str
    status: QueryStatus
    configurations: list[PipelineId]
    results: dict[str, RagRunResult | GraphRunResult] = Field(default_factory=dict)
    error: ApiError | None = None


class RecordedEvent(BaseModel):
    """One replayable execution event (docs/07 section 6)."""

    sequence: int
    event_type: str
    pipeline: str
    t_ms: float
    payload: dict[str, Any]


class EventStream(BaseModel):
    """Response for GET /api/v1/queries/{run_id}/events (replay source)."""

    run_id: str
    status: QueryStatus
    events: list[RecordedEvent]


class DemoQuestion(BaseModel):
    """A saved presentation question (fixed demo configuration)."""

    id: str
    question: str
    category: str
    profile: Literal["fraud"] | None = None
    configurations: list[PipelineId] = ["A", "B", "C"]
    # Published benchmark question whose evaluator scores the Results
    # surface may show alongside a live run; None when no published result
    # corresponds to this question.
    benchmark_question_id: str | None = None


class BenchmarkQuestionResult(BaseModel):
    """One scored question from the latest published benchmark run."""

    question_id: str
    scores: dict[str, dict[str, Any]]
    failure_classes: dict[str, str | None]


class BenchmarkSummary(BaseModel):
    """Response for GET /api/v1/benchmarks/latest (published results only)."""

    run_id: str
    reproducibility: dict[str, Any]
    questions: list[BenchmarkQuestionResult]
    # Aggregate over scored questions, exactly as report.md renders it
    # (written by the harness as summary.json). None for runs produced
    # before summary.json existed.
    summary: dict[str, Any] | None = None
