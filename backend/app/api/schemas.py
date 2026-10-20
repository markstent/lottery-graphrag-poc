"""Request and response models for the versioned public API.

Contracts follow docs/07-api-event-spec.md. Evidence DTOs reuse the typed
domain models in app.evidence directly: they are the retrieval layer's own
public record (provenance included) and are already Pydantic.
"""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.api.errors import ApiErrorBody
from app.datasets.master_data import MARKETS
from app.evidence import GraphRunResult, RagRunResult

PipelineId = Literal["A", "B", "C"]
QueryStatus = Literal["queued", "running", "completed", "failed", "cancelled"]
PipelineStatus = Literal["pending", "running", "completed", "failed", "cancelled", "skipped"]
RunKind = Literal["live", "recorded"]

# Run history page size (docs/07): a larger limit is a 422, never a clamp.
HISTORY_LIMIT_DEFAULT = 20
HISTORY_LIMIT_MAX = 100

# Canonical market codes from the synthetic world's master data (UK, GR, AT, CZ).
MARKET_CODES = frozenset(code for _market_id, code, *_rest in MARKETS)


class HealthResponse(BaseModel):
    """Response for GET /api/v1/health."""

    status: Literal["ok"]
    version: str


class QueryRequest(BaseModel):
    """Request for POST /api/v1/queries (docs/07 section 4).

    Unknown fields are refused, so a client still sending the retired
    ``profile`` gets a 422 rather than a silently ignored field.
    """

    model_config = ConfigDict(extra="forbid")

    question: str = Field(min_length=1, max_length=2000)
    configurations: list[PipelineId] = Field(default=["A", "B", "C"], min_length=1, max_length=3)
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
    """Response for POST /api/v1/queries: the run is queued for its worker."""

    run_id: str
    status: QueryStatus = "queued"
    results_url: str
    events_url: str


class RunSummary(BaseModel):
    """One run as history lists it, and the response of POST .../cancel."""

    run_id: str
    kind: RunKind
    question: str
    status: QueryStatus
    configurations: list[PipelineId]
    market_scope: list[str]
    pipeline_status: dict[str, PipelineStatus]
    created_at: str
    finished_at: str | None
    error: ApiErrorBody | None


class RunHistory(BaseModel):
    """Response for GET /api/v1/queries: newest first; ``next_before`` is the
    ``before`` value of the next page, or None on the last page."""

    runs: list[RunSummary]
    next_before: str | None


class QueryResults(RunSummary):
    """Response for GET /api/v1/queries/{run_id}: the summary plus every
    stored pipeline result, readable as soon as each pipeline finishes."""

    results: dict[str, RagRunResult | GraphRunResult] = Field(default_factory=dict)


class RecordedEvent(BaseModel):
    """One execution event: the envelope shared by replay and the stream
    (docs/07 section 6). ``pipeline`` is ``run`` for run lifecycle events."""

    event_id: str
    timestamp: str
    run_id: str
    pipeline: str
    event_type: str
    t_ms: float
    payload: dict[str, Any]
    sequence: int


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
    configurations: list[PipelineId] = ["A", "B", "C"]
    # Published benchmark question whose evaluator scores the Results
    # surface may show alongside a live run; None when no published result
    # corresponds to this question.
    benchmark_question_id: str | None = None


class BenchmarkSummary(BaseModel):
    """Response for GET /api/v1/benchmarks/latest.

    ``summary`` is the run's ``summary.json`` (schema 2), passed through
    unchanged: the only benchmark source the API publishes. ``run_kind``
    and ``label`` are copied out of it so a client can tell a smoke or
    sweep run from an official result without reading the summary.
    """

    run_id: str
    run_kind: str
    label: str | None
    summary: dict[str, Any]
