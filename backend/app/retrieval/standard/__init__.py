"""Standard RAG pipeline (docs/retrieval/standard-rag.md).

Modules:

- corpus: loads generation-time chunks joined with document provenance
- embeddings: multilingual model adapter plus deterministic fake
- vector_store: shared Qdrant layer plus in-memory fake
- reranking: optional transparent reranker
- context: token budget selection with duplicate filtering
- generation: answer gateway (fake for CI, LiteLLM for real runs)
- index: vector index builder CLI
- pipeline: the end-to-end pipeline with full telemetry
"""

from __future__ import annotations

from app.retrieval.standard.pipeline import StandardRagPipeline

__all__ = ["StandardRagPipeline"]
