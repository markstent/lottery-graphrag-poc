"""Request and response models for the versioned public API.

Contracts follow docs/07-api-event-spec.md. Evidence DTOs reuse the typed
domain models in app.evidence directly: they are the retrieval layer's own
public record (provenance included) and are already Pydantic.
"""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue, field_validator

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


class Check(BaseModel):
    """One readiness check: whether it passed and a curated detail, never a
    service address or raw driver or provider text."""

    ok: bool
    detail: str


class Readiness(BaseModel):
    """Response for GET /api/v1/health/ready: 200 when ready, else 503."""

    ready: bool
    checks: dict[str, Check]


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


# -- Data Model: datasets, dictionary, rows and records -----------------------

# Sample-row page size: a larger limit is a 422, never a clamp.
ROWS_LIMIT_DEFAULT = 50
ROWS_LIMIT_MAX = 200


class DatasetSummary(BaseModel):
    """One generated world as GET /datasets lists it; ``active`` marks the
    world the lab serves (``DATASET_DIR``)."""

    dataset_id: str
    generator_version: str
    world_seed: int
    scenario_seed: int
    profile: str
    row_counts: dict[str, int]
    active: bool


class TableProvenance(BaseModel):
    """Where a table's rows come from, as the world's manifest records it."""

    source_system: str
    source_table: str


class IndexStatus(BaseModel):
    """The vector index built over a world, from its index manifest."""

    collection: str
    points: int
    serialiser_version: str
    built_at: str


class DatasetDetail(BaseModel):
    """Response for GET /datasets/{dataset_id}; ``index_status`` is None
    when no persistent index was built over the world."""

    summary: DatasetSummary
    provenance: dict[str, TableProvenance]
    index_status: IndexStatus | None


class ColumnOut(BaseModel):
    """One column; ``description`` is None where the schema registry has none."""

    name: str
    type: str
    description: str | None


class ForeignKeyOut(BaseModel):
    """``column`` references ``table.ref_column`` (the parent's primary key)."""

    column: str
    table: str
    ref_column: str


class TableSchemaOut(BaseModel):
    """One table of the data dictionary (GET /datasets/{dataset_id}/dictionary)."""

    table: str
    source_system: str
    primary_key: str
    columns: list[ColumnOut]
    foreign_keys: list[ForeignKeyOut]
    provenance: TableProvenance | None


class RowPage(BaseModel):
    """One page of sample rows, ordered by the primary key; ``total`` counts
    every row matching the same filter."""

    table: str
    offset: int
    limit: int
    total: int
    rows: list[dict[str, JsonValue]]


class EdgeSummary(BaseModel):
    """How many relationships of one type meet a node in one direction."""

    type: str
    direction: Literal["out", "in"]
    count: int


class RecordOut(BaseModel):
    """One warehouse row and the graph node it maps to.

    ``graph_node_id`` is None when the table has no graph label or the world
    is not the one the graph holds. When the graph cannot be read, the row
    is still returned with ``edges`` None and ``graph_error`` set.
    """

    table: str
    row: dict[str, JsonValue]
    graph_node_id: str | None
    edges: list[EdgeSummary] | None
    graph_error: Literal["GRAPH_QUERY_ERROR"] | None = None
