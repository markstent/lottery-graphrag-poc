"""Retrieval and model-gateway settings.

Values come from the environment (see .env.example). Defaults match
docker-compose.yml for local development. CI never reads these: tests build
explicit configs with the deterministic fake adapters.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

from app.graph.config import DEFAULT_DATASET_DIR
from app.graph.statements import ONTOLOGY_RELATIONSHIP_TYPES


@dataclass(frozen=True, slots=True)
class EmbeddingSettings:
    """Embedding model selection (docs/retrieval/embeddings.md)."""

    provider: str  # "ollama" | "hashing"
    model: str
    dimensions: int
    host: str
    sparse_provider: str = "fastembed"  # "fastembed" | "hashing"
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


@dataclass(frozen=True, slots=True)
class RerankSettings:
    """Reranking is optional and applied fairly (docs/retrieval/reranking.md)."""

    enabled: bool
    lexical_weight: float


@dataclass(frozen=True, slots=True)
class GenerationSettings:
    """Answer generation through the LiteLLM-compatible gateway (ADR-003)."""

    provider: str  # "fake" | "litellm"
    model: str
    temperature: float
    api_base: str | None


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
    max_evidence_nodes: int
    relationship_types: tuple[str, ...]
    ontology_expansion: bool
    ranking: RankingWeights

    def without_ontology(self) -> GraphRagSettings:
        """Pipeline B view: same limits, no ontology relationships."""
        return GraphRagSettings(
            max_depth=self.max_depth,
            max_nodes_per_hop=self.max_nodes_per_hop,
            max_edges_per_node_type=self.max_edges_per_node_type,
            max_total_nodes=self.max_total_nodes,
            max_evidence_nodes=self.max_evidence_nodes,
            relationship_types=tuple(
                rel for rel in self.relationship_types if rel not in ONTOLOGY_RELATIONSHIP_TYPES
            ),
            ontology_expansion=False,
            ranking=self.ranking,
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
            max_evidence_nodes=12,
            relationship_types=DEFAULT_RELATIONSHIP_TYPES,
            ontology_expansion=True,
            ranking=DEFAULT_RANKING_WEIGHTS,
        )
    )


def _env_int(name: str, default: int) -> int:
    return int(os.environ.get(name, str(default)))


def _env_float(name: str, default: float) -> float:
    return float(os.environ.get(name, str(default)))


def from_env() -> RetrievalSettings:
    """Read settings from the environment with local-development defaults."""
    embedding_provider = os.environ.get("EMBEDDING_PROVIDER", "ollama")
    return RetrievalSettings(
        dataset_dir=os.environ.get("DATASET_DIR", str(DEFAULT_DATASET_DIR)),
        top_k=_env_int("RAG_TOP_K", 8),
        embedding=EmbeddingSettings(
            provider=embedding_provider,
            model=os.environ.get("EMBEDDING_MODEL", "bge-m3"),
            dimensions=_env_int("EMBEDDING_DIMENSIONS", 1024),
            host=os.environ.get("OLLAMA_HOST", "http://localhost:11434"),
            sparse_provider=os.environ.get(
                "SPARSE_PROVIDER", "hashing" if embedding_provider == "hashing" else "fastembed"
            ),
            sparse_model=os.environ.get("SPARSE_MODEL", "Qdrant/bm25"),
        ),
        vector=VectorSettings(
            url=os.environ.get("QDRANT_URL", "http://localhost:6333"),
            collection=os.environ.get("QDRANT_COLLECTION", "semantic_context_lab"),
        ),
        context=ContextSettings(
            budget_tokens=_env_int("RAG_CONTEXT_TOKEN_BUDGET", 2000),
            dedupe_threshold=_env_float("RAG_DEDUPE_THRESHOLD", 0.85),
        ),
        rerank=RerankSettings(
            enabled=os.environ.get("RAG_RERANK_ENABLED", "1") == "1",
            lexical_weight=_env_float("RAG_RERANK_LEXICAL_WEIGHT", 0.3),
        ),
        generation=GenerationSettings(
            provider=os.environ.get("GENERATION_PROVIDER", "fake"),
            model=os.environ.get("GENERATION_MODEL", "fake-answer-v1"),
            temperature=_env_float("GENERATION_TEMPERATURE", 0.0),
            api_base=os.environ.get("GENERATION_API_BASE"),
        ),
        graph=GraphRagSettings(
            max_depth=_env_int("GRAPH_DEPTH", 2),
            max_nodes_per_hop=_env_int("GRAPH_MAX_NODES_PER_HOP", 100),
            max_edges_per_node_type=_env_int("GRAPH_MAX_EDGES_PER_NODE_TYPE", 4),
            max_total_nodes=_env_int("GRAPH_MAX_TOTAL_NODES", 200),
            max_evidence_nodes=_env_int("GRAPH_MAX_EVIDENCE_NODES", 12),
            relationship_types=DEFAULT_RELATIONSHIP_TYPES,
            ontology_expansion=os.environ.get("GRAPH_ONTOLOGY", "1") == "1",
            ranking=DEFAULT_RANKING_WEIGHTS,
        ),
    )
