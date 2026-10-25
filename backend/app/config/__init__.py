"""The one settings module: repository anchors, retrieval, graph and API settings.

Values come from the environment (see .env.example). Defaults match
docker-compose.yml for local development. CI never reads the retrieval
settings: tests build explicit configs with the deterministic fake adapters.
"""

from __future__ import annotations

import math
import os
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path

from app.datasets.config import WINDOW_DAYS, WINDOW_START
from app.graph.statements import ONTOLOGY_RELATIONSHIP_TYPES
from app.models.gateway import parse_reasoning_for_model

# Repository layout anchors data at the repository root (ADR-006), independent
# of the process working directory.
REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_OUTPUT_DIR = REPO_ROOT / "data" / "generated"
DEFAULT_DATASET_DIR = DEFAULT_OUTPUT_DIR / "dev-seed2026"

# Version of the graph's node labels and relationship types, recorded on
# ingestion and with every benchmark run as `graph_label_version`.
LABEL_VERSION = "v2"

# End of the synthetic dataset window: the default "today" for record validity.
DEFAULT_REFERENCE_DATE = WINDOW_START + timedelta(days=WINDOW_DAYS)


@dataclass(frozen=True, slots=True)
class EmbeddingSettings:
    """Embedding model selection (docs/reference/retrieval/embeddings.md)."""

    provider: str  # "ollama" | "hashing"
    model: str
    dimensions: int
    host: str
    # "fastembed" | "hashing"; None follows `provider` (hashing -> hashing,
    # anything else -> fastembed), resolved by build_sparse_embedder.
    sparse_provider: str | None = None
    sparse_model: str = "Qdrant/bm25"


@dataclass(frozen=True, slots=True)
class VectorSettings:
    """Shared vector layer (ADR-002): one collection for A/B/C."""

    url: str
    collection: str


# The rule that picks the evidence items placed in context, as built: one
# re-ranker over every candidate, then the first `evidence_slots` that fit the
# budget. A run records it, so runs made under different rules never compare
# or resume as one experiment; change this value with the rule.
SELECTION_RULE = "shared-reranker-12-slots"


@dataclass(frozen=True, slots=True)
class ContextSettings:
    """Context budget (docs/reference/retrieval/context-budgeting.md)."""

    budget_tokens: int
    dedupe_threshold: float
    # Evidence items (structured graph blocks plus document chunks) any
    # pipeline may place in context: the same count for A, B and C.
    evidence_slots: int = 12


@dataclass(frozen=True, slots=True)
class RerankSettings:
    """One reranker shared by every pipeline (docs/reference/retrieval/reranking.md)."""

    provider: str  # "lexical" | "cross_encoder"
    model: str  # cross-encoder model (fastembed)


@dataclass(frozen=True, slots=True)
class GenerationSettings:
    """Answer generation through the LiteLLM-compatible gateway (ADR-003)."""

    provider: str  # "fake" | "litellm"
    model: str
    temperature: float
    api_base: str | None
    max_tokens: int = 1200
    # Recorded with every benchmark run; an official run requires the family.
    model_family: str | None = None
    quantisation: str | None = None
    # "default" or "off" (app.models.gateway.REASONING_MODES); recorded with every run.
    reasoning: str = "default"
    timeout_s: float = 120.0  # one gateway call


@dataclass(frozen=True, slots=True)
class RankingWeights:
    """Transparent evidence-ranking signals (docs/reference/retrieval/evidence-ranking.md).

    The score is a weighted sum of normalised components; every component is
    recorded per candidate so no hidden rule favours one pipeline.
    """

    graph_distance: float  # closer to seeds ranks higher
    relationship_type: float  # stronger relationship types rank higher
    semantic_relevance: float  # shared embedding model, question vs node text
    temporal_validity: float  # currently-valid evidence ranks higher


@dataclass(frozen=True, slots=True)
class GraphRagSettings:
    """Bounded graph traversal and evidence settings (docs/reference/02 section 11).

    Traversal limits are hard caps: depth, per-hop fan-out, per-node
    per-relationship-type edges and total nodes. Pipeline B excludes
    ontology relationships; pipeline C includes them plus concept expansion.
    """

    max_depth: int
    max_nodes_per_hop: int
    max_edges_per_node_type: int
    max_total_nodes: int
    relationship_types: tuple[str, ...]
    ontology_expansion: bool
    ranking: RankingWeights
    # Records whose validity ended before this date rank as superseded.
    reference_date: date
    # Node labels traversal never follows or records. Documents belong to the
    # document channel for every pipeline (design G1; AGENTS.md graph
    # augmentation principle). Fixed design (D-026), so no environment
    # variable sets it; it is recorded with every benchmark run.
    excluded_labels: tuple[str, ...] = ("Document",)

    def without_ontology(self) -> GraphRagSettings:
        """Pipeline B view: same limits, no ontology relationships."""
        return GraphRagSettings(
            max_depth=self.max_depth,
            max_nodes_per_hop=self.max_nodes_per_hop,
            max_edges_per_node_type=self.max_edges_per_node_type,
            max_total_nodes=self.max_total_nodes,
            relationship_types=tuple(
                rel for rel in self.relationship_types if rel not in ONTOLOGY_RELATIONSHIP_TYPES
            ),
            ontology_expansion=False,
            ranking=self.ranking,
            reference_date=self.reference_date,
            excluded_labels=self.excluded_labels,
        )


# Relationship allow-list for retrieval traversal: the structured-record
# subgraph. Documents and chunks are excluded on purpose: the vector layer
# owns document retrieval for every pipeline (ADR-002, retrieval fairness),
# and document edges would flood traversal budget with leaf nodes whose
# content the shared corpus already provides (HAS_CHUNK, REFERENCES).
# Player transactional aggregates (PLAYS, EXPOSED_TO, AVAILABLE_VIA,
# PROMOTES, HAS_DRAW, DEPLOYED_TO) are also excluded: they would flood
# traversal with thousands of neighbours. HAS_MECHANIC is included: its 23
# low-fan-out edges open the Game -> GameMechanic -> MAPS_TO -> concept
# path that lets the ontology reach a game's mechanics. USES and USES_PAYMENT
# are included for every question and bounded by the per-type and per-hop
# caps. Quantitative facts stay in the structured layer (AGENTS.md Graph
# Augmentation Principle); the graph guides, it does not enumerate.
DEFAULT_RELATIONSHIP_TYPES: tuple[str, ...] = (
    "AFFECTS",
    "AFFECTS_MARKET",
    "AVAILABLE_IN",
    "BELONGS_TO",
    "CATEGORISED_AS",
    "CONCERNS",
    "FROM_MARKET",
    "HAS_MECHANIC",
    "INSTANCE_OF",
    "IS_A",
    "MAPS_TO",
    "OF_TYPE",
    "PROVIDED_BY",
    "RELATED_TO",
    "RELATED_TO_APP_VERSION",
    "RELATED_TO_VERSION",
    "RUNS_ON",
    "SIMILAR_TO",
    "TARGETS",
    "USES",
    "USES_PAYMENT",
    "VERSION_OF",
)

DEFAULT_RANKING_WEIGHTS = RankingWeights(
    graph_distance=0.25,
    relationship_type=0.25,
    semantic_relevance=0.35,
    temporal_validity=0.15,
)


@dataclass(frozen=True, slots=True)
class RetrievalSettings:
    """Complete configuration for one standard RAG pipeline."""

    dataset_dir: str
    top_k: int
    embedding: EmbeddingSettings
    vector: VectorSettings
    context: ContextSettings
    rerank: RerankSettings
    generation: GenerationSettings
    # Used only by the graph pipelines (B/C); the standard pipeline ignores
    # it, so a default keeps standard-RAG configuration unchanged.
    graph: GraphRagSettings = field(
        default_factory=lambda: GraphRagSettings(
            max_depth=2,
            max_nodes_per_hop=100,
            max_edges_per_node_type=4,
            max_total_nodes=200,
            relationship_types=DEFAULT_RELATIONSHIP_TYPES,
            ontology_expansion=True,
            ranking=DEFAULT_RANKING_WEIGHTS,
            reference_date=DEFAULT_REFERENCE_DATE,
        )
    )


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name, str(default))
    try:
        return int(raw)
    except ValueError:
        raise ValueError(f"{name} must be an integer, got {raw!r}") from None


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name, str(default))
    try:
        return float(raw)
    except ValueError:
        raise ValueError(f"{name} must be a number, got {raw!r}") from None


FAKE_JUDGE_MODEL = "fake-judge-v1"


@dataclass(frozen=True, slots=True)
class JudgeSettings:
    """The judge model; ``provider`` is "fake" or "litellm"."""

    provider: str
    model: str
    model_family: str | None
    api_base: str | None
    temperature: float
    # "default" or "off" (app.models.gateway.REASONING_MODES).
    reasoning: str = "default"


def judge_settings_from_env() -> JudgeSettings:
    """Read the JUDGE_* variables (see .env.example); empty means unset."""
    model = os.environ.get("JUDGE_MODEL", FAKE_JUDGE_MODEL)
    provider = os.environ.get("JUDGE_PROVIDER", "fake")
    return JudgeSettings(
        provider=provider,
        model=model,
        model_family=os.environ.get("JUDGE_MODEL_FAMILY") or None,
        api_base=os.environ.get("JUDGE_API_BASE") or None,
        temperature=_env_float("JUDGE_TEMPERATURE", 0.0)
        if os.environ.get("JUDGE_TEMPERATURE")
        else 0.0,
        reasoning=parse_reasoning_for_model(
            os.environ.get("JUDGE_REASONING") or "default", "JUDGE_REASONING", provider, model
        ),
    )


def from_env() -> RetrievalSettings:
    """Read settings from the environment with local-development defaults."""
    default_rerank_provider = (
        "lexical" if os.environ.get("EMBEDDING_PROVIDER") == "hashing" else "cross_encoder"
    )
    generation_model = os.environ.get("GENERATION_MODEL", "fake-answer-v1")
    generation_provider = os.environ.get("GENERATION_PROVIDER", "fake")
    return RetrievalSettings(
        dataset_dir=os.environ.get("DATASET_DIR", str(DEFAULT_DATASET_DIR)),
        top_k=_env_int("RAG_TOP_K", 40),
        embedding=EmbeddingSettings(
            provider=os.environ.get("EMBEDDING_PROVIDER", "ollama"),
            model=os.environ.get("EMBEDDING_MODEL", "bge-m3"),
            dimensions=_env_int("EMBEDDING_DIMENSIONS", 1024),
            host=os.environ.get("OLLAMA_HOST", "http://localhost:11434"),
            sparse_provider=os.environ.get("SPARSE_PROVIDER") or None,
            sparse_model=os.environ.get("SPARSE_MODEL", "Qdrant/bm25"),
        ),
        vector=VectorSettings(
            url=os.environ.get("QDRANT_URL", "http://localhost:6333"),
            collection=os.environ.get("QDRANT_COLLECTION", "semantic_context_lab"),
        ),
        context=ContextSettings(
            budget_tokens=_env_int("RAG_CONTEXT_TOKEN_BUDGET", 2000),
            dedupe_threshold=_env_float("RAG_DEDUPE_THRESHOLD", 0.85),
            evidence_slots=_env_int("RAG_EVIDENCE_SLOTS", 12),
        ),
        rerank=RerankSettings(
            provider=os.environ.get("RERANK_PROVIDER", default_rerank_provider),
            model=os.environ.get("RERANK_MODEL", "BAAI/bge-reranker-v2-m3"),
        ),
        generation=GenerationSettings(
            provider=generation_provider,
            model=generation_model,
            temperature=_env_float("GENERATION_TEMPERATURE", 0.0),
            api_base=os.environ.get("GENERATION_API_BASE"),
            max_tokens=_env_int("GENERATION_MAX_TOKENS", 1200),
            model_family=os.environ.get("GENERATION_MODEL_FAMILY") or None,
            quantisation=os.environ.get("GENERATION_MODEL_QUANTISATION") or None,
            reasoning=parse_reasoning_for_model(
                os.environ.get("GENERATION_REASONING") or "default",
                "GENERATION_REASONING",
                generation_provider,
                generation_model,
            ),
            timeout_s=_env_float("GENERATION_TIMEOUT_S", 120.0),
        ),
        graph=GraphRagSettings(
            max_depth=_env_int("GRAPH_DEPTH", 2),
            max_nodes_per_hop=_env_int("GRAPH_MAX_NODES_PER_HOP", 100),
            max_edges_per_node_type=_env_int("GRAPH_MAX_EDGES_PER_NODE_TYPE", 4),
            max_total_nodes=_env_int("GRAPH_MAX_TOTAL_NODES", 200),
            relationship_types=DEFAULT_RELATIONSHIP_TYPES,
            # The lab sets concept expansion on for C and off for B
            # (bc_graph_settings); there is no switch for it.
            ontology_expansion=True,
            ranking=DEFAULT_RANKING_WEIGHTS,
            reference_date=date.fromisoformat(
                os.environ.get("GRAPH_REFERENCE_DATE") or DEFAULT_REFERENCE_DATE.isoformat()
            ),
        ),
    )


@dataclass(frozen=True, slots=True)
class GraphConfig:
    """Connection settings for one Neo4j instance."""

    uri: str
    user: str
    password: str
    database: str
    timeout_s: float = 10.0  # connection and per-query timeout

    @classmethod
    def from_env(cls) -> GraphConfig:
        """Neo4j settings from the environment with local-development defaults."""
        return cls(
            uri=os.environ.get("NEO4J_URI", "bolt://localhost:7687"),
            user=os.environ.get("NEO4J_USER", "neo4j"),
            password=os.environ.get("NEO4J_PASSWORD", "devpassword"),
            database=os.environ.get("NEO4J_DATABASE", "neo4j"),
            timeout_s=_env_float("NEO4J_TIMEOUT_S", 10.0),
        )


@dataclass(frozen=True, slots=True)
class ApiSettings:
    """Presentation API settings (docs/reference/07-api-event-spec.md)."""

    cors_origins: tuple[str, ...]
    db_path: Path
    run_retention: int  # runs kept in the run store
    sse_heartbeat_s: float
    benchmark_dir: Path  # where the benchmark CLI writes runs
    log_level: str = "INFO"


def _positive_int(name: str, default: int) -> int:
    raw = os.environ.get(name) or str(default)
    try:
        value = int(raw)
    except ValueError:
        raise ValueError(f"{name} must be a positive integer, got {raw!r}") from None
    if value <= 0:
        raise ValueError(f"{name} must be a positive integer, got {raw!r}")
    return value


def _positive_float(name: str, default: float) -> float:
    raw = os.environ.get(name) or str(default)
    try:
        value = float(raw)
    except ValueError:
        raise ValueError(f"{name} must be a positive number, got {raw!r}") from None
    if not (math.isfinite(value) and value > 0):
        raise ValueError(f"{name} must be a positive number, got {raw!r}")
    return value


def _log_level() -> str:
    raw = (os.environ.get("LOG_LEVEL") or "INFO").upper()
    if raw not in ("DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"):
        raise ValueError(f"LOG_LEVEL must be DEBUG, INFO, WARNING, ERROR or CRITICAL, got {raw!r}")
    return raw


def api_from_env() -> ApiSettings:
    """API settings from the environment; invalid values raise ``ValueError``."""
    origins = os.environ.get("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
    return ApiSettings(
        cors_origins=tuple(origin.strip() for origin in origins.split(",") if origin.strip()),
        db_path=Path(os.environ.get("APP_DB_PATH") or REPO_ROOT / "data" / "app.db"),
        run_retention=_positive_int("RUN_RETENTION", 500),
        sse_heartbeat_s=_positive_float("SSE_HEARTBEAT_S", 15.0),
        benchmark_dir=Path(
            os.environ.get("BENCHMARK_DIR") or REPO_ROOT / "data" / "evaluation" / "runs"
        ),
        log_level=_log_level(),
    )
