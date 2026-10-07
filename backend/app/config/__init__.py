"""Retrieval and model-gateway settings.

Values come from the environment (see .env.example). Defaults match
docker-compose.yml for local development. CI never reads these: tests build
explicit configs with the deterministic fake adapters.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

from app.graph.config import DEFAULT_DATASET_DIR


@dataclass(frozen=True, slots=True)
class EmbeddingSettings:
    """Embedding model selection (docs/retrieval/embeddings.md)."""

    provider: str  # "ollama" | "hashing"
    model: str
    dimensions: int
    host: str


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
class RetrievalSettings:
    """Complete configuration for one standard RAG pipeline."""

    dataset_dir: str
    top_k: int
    embedding: EmbeddingSettings
    vector: VectorSettings
    context: ContextSettings
    rerank: RerankSettings
    generation: GenerationSettings


def _env_int(name: str, default: int) -> int:
    return int(os.environ.get(name, str(default)))


def _env_float(name: str, default: float) -> float:
    return float(os.environ.get(name, str(default)))


def from_env() -> RetrievalSettings:
    """Read settings from the environment with local-development defaults."""
    return RetrievalSettings(
        dataset_dir=os.environ.get("DATASET_DIR", str(DEFAULT_DATASET_DIR)),
        top_k=_env_int("RAG_TOP_K", 8),
        embedding=EmbeddingSettings(
            provider=os.environ.get("EMBEDDING_PROVIDER", "ollama"),
            model=os.environ.get("EMBEDDING_MODEL", "bge-m3"),
            dimensions=_env_int("EMBEDDING_DIMENSIONS", 1024),
            host=os.environ.get("OLLAMA_HOST", "http://localhost:11434"),
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
    )
