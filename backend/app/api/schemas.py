"""Request and response models for the versioned public API.

Contracts follow docs/reference/07-api-event-spec.md. Evidence DTOs reuse the typed
domain models in app.evidence directly: they are the retrieval layer's own
public record (provenance included) and are already Pydantic.
"""

from http import HTTPStatus
from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, JsonValue, field_validator, model_validator

from app.api.errors import ApiErrorBody
from app.api.event_schemas import RecordedEvent
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

# Run history page size (docs/reference/07): a larger limit is a 422, never a clamp.
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
    """Request for POST /api/v1/queries (docs/reference/07 section 4).

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


class UnavailableOut(BaseModel):
    """A bank question the world could not ground, and why."""

    question_id: str
    reason: str


class InstanceCounts(BaseModel):
    """Scored instances per stratum key and overall: in all, and per world seed."""

    total: dict[str, int]
    per_world: dict[str, dict[str, int]]


class MetricCell(BaseModel):
    """One pipeline's mean of one metric over a stratum: ``n`` instances,
    ``repeats`` scored repeats; the mean is None where no repeat defines it."""

    mean: float | None
    n: int
    repeats: int


class ComparisonCell(BaseModel):
    """One paired comparison of a stratum and metric: the mean difference with
    its clustered 95 percent interval, and the test where one was run."""

    stratum: str
    metric: str
    comparison: str
    n: int
    clusters: int
    mean: float | None
    low: float | None
    high: float | None
    p: float | None
    p_holm: float | None
    in_family: bool
    reason: str


class SplitCell(BaseModel):
    """A cell of the ontology-dependent split: a comparison of B and C
    over one group of instances, never tested (``in_family`` is false)."""

    group: str
    metric: str
    comparison: str
    n: int
    clusters: int
    mean: float | None
    low: float | None
    high: float | None
    p: float | None
    p_holm: float | None
    in_family: bool
    reason: str


class AgreementOut(BaseModel):
    """Three-level agreement of the judge's correctness with the answer
    level (method v0.3) over ``n`` judged repeats, and the linearly
    weighted kappa; None where it is undefined."""

    n: int
    agreement: float | None
    weighted_kappa: float | None


class AgreementSplitOut(BaseModel):
    """Agreement over the answers that answered and those that abstained."""

    answered: AgreementOut
    abstained: AgreementOut


class JudgeAgreementOut(BaseModel):
    overall: AgreementSplitOut
    pipelines: dict[str, AgreementSplitOut]


class ThresholdAgreementOut(BaseModel):
    """Agreement as runs before method v0.3 recorded it: judge correctness 2
    against an answer score of at least 0.5, with Cohen's kappa."""

    n: int
    agreement: float | None
    kappa: float | None


class ThresholdJudgeAgreementOut(BaseModel):
    overall: ThresholdAgreementOut
    pipelines: dict[str, ThresholdAgreementOut]


class FailuresOut(BaseModel):
    """Per pipeline: scored repeats, generation and judge failures, and the
    repeats per failure class."""

    repeats: dict[str, int]
    generation: dict[str, int]
    judge: dict[str, int]
    classes: dict[str, dict[str, int]]


class SelectionOut(BaseModel):
    """The part of the bank a run scored."""

    strata: list[str] | None
    limit: int | None
    # Logical questions a run was limited to; absent in runs made before it was recorded.
    questions: list[str] | None = None


class ReproducibilityOut(BaseModel):
    """What the run and each world recorded. Mappings, not models: older runs
    lack fields, and the Results screen shows unknown keys by name."""

    run: dict[str, JsonValue]
    worlds: list[dict[str, JsonValue]]


class SummaryOut(BaseModel):
    """A run's ``summary.json``, every key the harness writes: schema 2 for a
    run of method v0.2 (such as v0.2.0), schema 3 for method v0.3, whose
    comparisons add C_vs_A cells and test evidence recall.

    A key added later is ignored, so an older client keeps reading.
    """

    model_config = ConfigDict(extra="ignore")

    schema_version: Literal["2", "3"]
    run_kind: str
    label: str | None
    bank_version: str
    worlds: list[int]
    instances: InstanceCounts
    unavailable: dict[str, list[UnavailableOut]]
    anchor_resolution_basis: dict[str, str]
    metrics: dict[str, dict[str, dict[str, MetricCell]]]
    comparisons: list[ComparisonCell]
    ontology_split: list[SplitCell] | None = None
    headlines: list[str]
    # A run published before method v0.3 (such as v0.2.0) keeps its threshold agreement.
    judge_agreement: JudgeAgreementOut | ThresholdJudgeAgreementOut | None
    failures: FailuresOut
    selection: SelectionOut
    reproducibility: ReproducibilityOut


class BenchmarkSummary(BaseModel):
    """Response for GET /api/v1/benchmarks/latest and /benchmarks/{run_id}.

    ``summary`` is the run's ``summary.json`` (schema 2 or 3), typed: the only
    benchmark source the API publishes. ``run_kind`` and ``label`` are
    copied out of it so a client can tell a smoke or sweep run from an
    official result without reading the summary.
    """

    run_id: str
    run_kind: str
    label: str | None
    summary: SummaryOut


class BenchmarkRunOut(BaseModel):
    """One published run in GET /api/v1/benchmarks, from its ``summary.json``:
    ``selection`` is the part of the bank it scored, ``worlds`` its seeds."""

    run_id: str
    run_kind: str
    label: str | None
    started_at: str
    selection: dict[str, Any]
    worlds: list[int]
    headlines: list[str]


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


class InstancePipelineOut(BaseModel):
    """One pipeline's scores on one instance: each metric is the mean over its
    successful repeats (None where none defines it), from the run's results."""

    repeats: int
    # Repeats whose generation failed, so no score exists; not the "generation_failure" class.
    unscored_repeats: int
    answer: float | None
    evidence_f1: float | None
    evidence_recall: float | None
    evidence_precision: float | None
    efficiency_per_1k: float | None
    citation_accuracy: float | None
    latency_ms: float | None
    context_tokens: float | None
    judge_correctness: float | None
    judge_completeness: float | None
    judge_faithfulness: float | None
    judge_citation_accuracy: float | None
    judge_abstention: float | None
    failure_classes: dict[str, int]


class InstanceResultOut(BaseModel):
    """One scored bank instance of a run (GET /api/v1/benchmarks/{run_id}/instances).

    Carries the question and the scores only: never the expected answer,
    the claims or checks, or any answer text.
    """

    instance_id: str
    question_id: str
    world_seed: int
    stratum: str
    sub_stratum: str | None
    ontology_dependent: bool
    text: str
    pipelines: dict[str, InstancePipelineOut]


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
    worlds_done: int
    worlds_total: int


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
    # The source table of each label built from one (not PrizeType or
    # BusinessConcept), so a label can be followed to its rows.
    node_tables: dict[str, str]
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
    definition: str
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
    """``judge`` is the benchmark judge model; null when none is configured
    (the offline judge of a smoke run is not a model)."""

    embedding: ModelOut
    sparse: ModelOut
    rerank: ModelOut
    generation: ModelOut
    judge: ModelOut | None


class ErrorEnvelope(BaseModel):
    """The body of every non-2xx response: ``{"error": {...}}``."""

    error: ApiErrorBody


def error_responses(*statuses: int) -> dict[int | str, dict[str, Any]]:
    """The OpenAPI ``responses`` of a route's failures, each the error envelope.

    A 500 is always possible, so it is always included. Declaring 422 here
    replaces FastAPI's default ``HTTPValidationError``, which this API never sends.
    """
    return {
        status: {"model": ErrorEnvelope, "description": HTTPStatus(status).phrase}
        for status in sorted({*statuses, 500})
    }
