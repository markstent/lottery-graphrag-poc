"""Retrieval and model-gateway settings.

Values come from the environment (see .env.example). Defaults match
docker-compose.yml for local development. CI never reads these: tests build
explicit configs with the deterministic fake adapters.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import date, timedelta

from app.datasets.config import WINDOW_DAYS, WINDOW_START
from app.graph.config import DEFAULT_DATASET_DIR
from app.graph.statements import ONTOLOGY_RELATIONSHIP_TYPES

# End of the synthetic dataset window: the default "today" for record validity.
DEFAULT_REFERENCE_DATE = WINDOW_START + timedelta(days=WINDOW_DAYS)


@dataclass(frozen=True, slots=True)
class EmbeddingSettings:
    """Embedding model selection (docs/retrieval/embeddings.md)."""

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


@dataclass(frozen=True, slots=True)
class ContextSettings:
    """Context budget (docs/retrieval/context-budgeting.md)."""

    budget_tokens: int
    dedupe_threshold: float
    # Evidence items (structured graph blocks plus document chunks) any
    # pipeline may place in context: the same count for A, B and C.
    evidence_slots: int = 12


@dataclass(frozen=True, slots=True)
class RerankSettings:
    """One reranker shared by every pipeline (docs/retrieval/reranking.md)."""

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


@dataclass(frozen=True, slots=True)
class RankingWeights:
    """Transparent evidence-ranking signals (docs/retrieval/evidence-ranking.md).

    The score is a weighted sum of normalised components; every component is
    recorded per candidate so no hidden rule favours one pipeline.
    """

    graph_distance: float  # closer to seeds ranks higher
    relationship_type: float  # stronger relationship types rank higher
    semantic_relevance: float  # shared embedding model, question vs node text
    temporal_validity: float  # currently-valid evidence ranks higher


@dataclass(frozen=True, slots=True)
class GraphRagSettings:
    """Bounded graph traversal and evidence settings (docs/02 section 11).

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
    return int(os.environ.get(name, str(default)))


def _env_float(name: str, default: float) -> float:
    return float(os.environ.get(name, str(default)))


def from_env() -> RetrievalSettings:
    """Read settings from the environment with local-development defaults."""
    default_rerank_provider = (
        "lexical" if os.environ.get("EMBEDDING_PROVIDER") == "hashing" else "cross_encoder"
    )
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
            provider=os.environ.get("GENERATION_PROVIDER", "fake"),
            model=os.environ.get("GENERATION_MODEL", "fake-answer-v1"),
            temperature=_env_float("GENERATION_TEMPERATURE", 0.0),
            api_base=os.environ.get("GENERATION_API_BASE"),
            max_tokens=_env_int("GENERATION_MAX_TOKENS", 1200),
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
