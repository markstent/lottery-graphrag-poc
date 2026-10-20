"""Request and response models for the versioned public API.

Contracts follow docs/07-api-event-spec.md. Evidence DTOs reuse the typed
domain models in app.evidence directly: they are the retrieval layer's own
public record (provenance included) and are already Pydantic.
"""

from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, JsonValue, field_validator, model_validator

from app.api.errors import ApiErrorBody
from app.datasets.master_data import MARKETS
from app.evidence import GraphRunResult, RagRunResult

PipelineId = Literal["A", "B", "C"]
QueryStatus = Literal["queued", "running", "completed", "failed", "cancelled"]
PipelineStatus = Literal["pending", "running", "completed", "failed", "cancelled", "skipped"]
RunKind = Literal["live", "recorded"]
# Whether a run's question has an answer key: a bank question has, an ad hoc one has none.
AnswerKey = Literal["none", "available"]
# Where a run stands with its answer key: ad hoc, cancelled and failed runs
# are not scored; a completed bank question is pending until it is scored
# or its scoring fails.
ScoreStatus = Literal["not_applicable", "pending", "scored", "failed"]
LiveScoreLabel = Literal["scored against the answer key"]
LIVE_SCORE_LABEL: LiveScoreLabel = "scored against the answer key"

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

    # Required for an ad hoc question. A bank question runs with its own
    # text, so with ``benchmark_instance_id`` it may be left out; when it is
    # sent it must equal the instance's text (checked against the bank).
    question: str | None = Field(default=None, min_length=1, max_length=2000)
    configurations: list[PipelineId] = Field(default=["A", "B", "C"], min_length=1, max_length=3)
    # Optional retrieval scope: market codes ("UK") or full ids ("MKT_UK"),
    # normalised to full ids. Empty means all markets. The scope applies
    # identically to every requested pipeline (retrieval fairness).
    market_scope: list[str] = Field(default_factory=list, max_length=4)
    # An instance of the presentation world's frozen bank: the run asks its
    # text and is scored against its answer key once the run has completed.
    benchmark_instance_id: str | None = Field(default=None, min_length=1, max_length=200)

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

    @model_validator(mode="after")
    def _question_or_instance(self) -> Self:
        if self.question is None and self.benchmark_instance_id is None:
            raise ValueError("question is required unless benchmark_instance_id is given")
        return self


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


class LivePipelineScore(BaseModel):
    """One pipeline's deterministic scores on a live bank question; None
    where the instance does not define the metric."""

    answer: float | None
    evidence_f1: float | None
    anchor_resolution: float | None
    failure_class: str | None


class LiveScore(BaseModel):
    """A completed bank question's live answers scored against its answer
    key by the deterministic scorers (never the judge, spec 10a.1)."""

    instance_id: str
    label: LiveScoreLabel = LIVE_SCORE_LABEL
    per_pipeline: dict[str, LivePipelineScore]


class QueryResults(RunSummary):
    """Response for GET /api/v1/queries/{run_id}: the summary plus every
    stored pipeline result, readable as soon as each pipeline finishes.

    ``answer_key`` says whether the question has one: "none" for an ad hoc
    question, which is never scored. ``score_status`` says where the score
    stands: "not_applicable" for an ad hoc question and for a run that was
    cancelled or failed, "pending" for a completed bank question until its
    score is written (just after the final status), then "scored" with
    ``score`` set, or "failed" when scoring failed.
    """

    results: dict[str, RagRunResult | GraphRunResult] = Field(default_factory=dict)
    benchmark_instance_id: str | None = None
    answer_key: AnswerKey = "none"
    score_status: ScoreStatus = "not_applicable"
    # Why a failed scoring failed when known: "interrupted" when the server
    # stopped before the score was written (recorded at the next start-up).
    score_failure: Literal["interrupted"] | None = None
    score: LiveScore | None = None


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
    """A demo question: one instance of the presentation world's frozen bank.

    Pipeline-visible fields only: the text every pipeline receives, never
    the expected answer, checks or claims. ``market_scope`` is empty (all
    markets): the bank defines no scope of its own.
    """

    instance_id: str
    question_id: str
    text: str
    stratum: str
    market_scope: list[str]


class BenchmarkSummary(BaseModel):
    """Response for GET /api/v1/benchmarks/latest and /benchmarks/{run_id}.

    ``summary`` is the run's ``summary.json`` (schema 2), passed through
    unchanged: the only benchmark source the API publishes. ``run_kind``
    and ``label`` are copied out of it so a client can tell a smoke or
    sweep run from an official result without reading the summary.
    """

    run_id: str
    run_kind: str
    label: str | None
    summary: dict[str, Any]


class BenchmarkRunOut(BaseModel):
    """One published run in GET /api/v1/benchmarks, from its ``summary.json``:
    ``selection`` is the part of the bank it scored, ``worlds`` its seeds."""

    run_id: str
    run_kind: str
    label: str | None
    started_at: str
    selection: dict[str, Any]
    worlds: list[int]


class PipelineScore(BaseModel):
    """One pipeline's means over the scored repeats of one question; None
    where no scored repeat defines the metric."""

    answer: float | None
    evidence_f1: float | None


class QuestionOut(BaseModel):
    """One bank question for the Help screen (GET /api/v1/benchmarks/questions).

    ``hidden_truth`` is the planted scenario's truth for H5 questions, else
    None. ``scores`` are per pipeline from the chosen run, None when that run
    did not score this question or no run exists.
    """

    question_id: str
    instance_id: str
    text: str
    tests: str
    stratum: str
    scenario_id: str | None
    ontology_dependent: bool
    expected_answer: str
    hidden_truth: str | None
    scores: dict[str, PipelineScore] | None


class BenchmarkStart(BaseModel):
    """Request for POST /api/v1/benchmarks; the seeds, strata and kind are
    checked against the harness's own before a job starts."""

    model_config = ConfigDict(extra="forbid")

    kind: Literal["smoke", "official"]
    seeds: list[int] = Field(min_length=1)
    repeats: int = Field(ge=1)
    strata: list[str] | None = Field(default=None, min_length=1)
    limit: int | None = Field(default=None, ge=1)


JobStatus = Literal["running", "completed", "failed", "cancelled"]


class JobProgress(BaseModel):
    """The world a job is running and how far through its instances it is."""

    world_seed: int
    instances_done: int
    instances_total: int


class BenchmarkJob(BaseModel):
    """A benchmark job (POST /api/v1/benchmarks, GET /benchmarks/jobs/{job_id}).

    ``run_id`` names the published run once the job completed; ``progress``
    is None until the first world reaches its first instance; ``error`` is
    the curated envelope of a failed job.
    """

    job_id: str
    status: JobStatus
    run_id: str | None = None
    error: ApiErrorBody | None = None
    progress: JobProgress | None = None


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
    # "world": the world's own _data_dictionary.json, written by its
    # generator; "registry": the code's schema registry (no file).
    dictionary_source: Literal["world", "registry"]


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

    ``graph_node_id`` is the id ingestion gives the row's node
    (``app.graph.node_rows.NODE_TABLES``); None with ``edges`` empty when the
    table creates no nodes. For a world the graph does not hold, ``edges``
    is None and ``graph_error`` is ``OTHER_WORLD``; when the graph cannot be
    read, the node id is kept, ``edges`` is None and ``graph_error`` is
    ``GRAPH_QUERY_ERROR``.
    """

    table: str
    row: dict[str, JsonValue]
    graph_node_id: str | None
    edges: list[EdgeSummary] | None
    graph_error: Literal["GRAPH_QUERY_ERROR", "OTHER_WORLD"] | None = None


# -- Graph: schema, ingestion statistics, nodes and neighbours -----------------

# Neighbour page size: a larger limit is a 422, never a clamp.
NEIGHBOURS_LIMIT_DEFAULT = 25
NEIGHBOURS_LIMIT_MAX = 100


class RelTypeOut(BaseModel):
    """One relationship type between the labels it joins."""

    type: str
    from_label: str
    to_label: str


class GraphSchema(BaseModel):
    """Response for GET /graph/schema: the graph model and the traversal
    settings pipelines B and C run with."""

    labels: list[str]
    relationship_types: list[RelTypeOut]
    # Relationship types each graph pipeline may traverse, keyed B and C.
    allow_list: dict[str, list[str]]
    # Evidence-ranking weights, the same for B and C.
    weights: dict[str, float]
    # Traversal caps, the same for B and C.
    caps: dict[str, int]
    label_version: str


class GraphStats(BaseModel):
    """Response for GET /graph/stats, read from the active dataset's
    ``_graph_stats.json``: what its ingestion pushed, not a live count."""

    nodes_by_label: dict[str, int]
    relationships_by_type: dict[str, int]
    ingestion_version: str
    source: Literal["ingestion"]


class ProvenanceOut(BaseModel):
    """The warehouse row a graph node was built from."""

    table: str
    row_id: str
    dataset_id: str


class NodeOut(BaseModel):
    """One graph node; ``provenance`` is None for a node no source table
    maps to (PrizeType, BusinessConcept)."""

    node_id: str
    labels: list[str]
    properties: dict[str, JsonValue]
    provenance: ProvenanceOut | None


class NeighbourOut(BaseModel):
    """One relationship from the node and the node at its other end."""

    rel_type: str
    direction: Literal["out", "in"]
    node: NodeOut


class Neighbours(BaseModel):
    """Response for GET /graph/nodes/{node_id}/neighbours; ``truncated``
    says the node has more neighbours than ``limit``."""

    node_id: str
    items: list[NeighbourOut]
    truncated: bool


class ConceptOut(BaseModel):
    """One ontology concept. ``labels`` and ``synonyms`` are keyed by
    language, ``binding_counts`` by market id; codes shared by every market
    (channels, incident types) count under ``shared``. ``relationships`` are
    the relationship types the concept takes part in, derived from ingestion
    (``IS_A`` with a parent or child, ``MAPS_TO`` with a bound code)."""

    concept_id: str
    parent_id: str | None
    labels: dict[str, str]
    synonyms: dict[str, list[str]]
    relationships: list[str]
    binding_counts: dict[str, int]


class OntologyOut(BaseModel):
    version: str
    concepts: list[ConceptOut]


class MemberOut(BaseModel):
    """A local code bound to a concept; ``name`` is its local display name
    when the term table has one."""

    kind: str
    code: str
    market_id: str | None
    name: str | None


class ScenarioOut(BaseModel):
    """A catalogue scenario and whether the active dataset planted it. Carries
    configuration only: never the truth ledger."""

    scenario_id: str
    scenario_type: str
    title: str
    planted: bool
    planted_rows: dict[str, int]
    strength: float | None
    noise_level: str | None


class ModelOut(BaseModel):
    """One configured model. ``reachable`` is null for a model that runs in
    process and has not been loaded."""

    provider: str
    model: str
    reachable: bool | None
    detail: str


class ModelsOut(BaseModel):
    embedding: ModelOut
    sparse: ModelOut
    rerank: ModelOut
    generation: ModelOut
