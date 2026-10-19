"""Request and response models for the versioned public API.

Contracts follow docs/07-api-event-spec.md. Evidence DTOs reuse the typed
domain models in app.evidence directly: they are the retrieval layer's own
public record (provenance included) and are already Pydantic.
"""

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

from app.datasets.master_data import MARKETS
from app.evidence import GraphRunResult, RagRunResult

PipelineId = Literal["A", "B", "C"]
QueryStatus = Literal["running", "completed", "failed"]

# Canonical market codes from the synthetic world's master data (UK, GR, AT, CZ).
MARKET_CODES = frozenset(code for _market_id, code, *_rest in MARKETS)


class HealthResponse(BaseModel):
    """Response for GET /api/v1/health."""

    status: Literal["ok"]
    version: str


class QueryRequest(BaseModel):
    """Request for POST /api/v1/queries (docs/07 section 4)."""

    question: str = Field(min_length=1, max_length=2000)
    configurations: list[PipelineId] = Field(default=["A", "B", "C"], min_length=1, max_length=3)
    # Accepted for compatibility but ignored: the B/C allow-list no longer
    # varies per question. Phase 3 removes this field.
    profile: Literal["fraud"] | None = None
    # Optional retrieval scope: market codes ("UK") or full ids ("MKT_UK"),
    # normalised to full ids. Empty means all markets. The scope applies
    # identically to every requested pipeline (retrieval fairness).
    market_scope: list[str] = Field(default_factory=list, max_length=4)

    @field_validator("market_scope")
    @classmethod
    def _normalise_market_scope(cls, value: list[str]) -> list[str]:
        normalised: list[str] = []
        for entry in value:
            code = entry.strip().upper().removeprefix("MKT_")
            if code not in MARKET_CODES:
                raise ValueError(f"unknown market: {entry!r}")
            market_id = f"MKT_{code}"
            if market_id not in normalised:
                normalised.append(market_id)
        return normalised


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
    market_scope: list[str] = Field(default_factory=list)
    results: dict[str, RagRunResult | GraphRunResult] = Field(default_factory=dict)
    error: ApiError | None = None


class RecordedEvent(BaseModel):
    """One replayable execution event (docs/07 section 6)."""

    sequence: int
    event_id: str
    timestamp: str
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
    # No longer read (see QueryRequest.profile); Phase 3 removes this field.
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
