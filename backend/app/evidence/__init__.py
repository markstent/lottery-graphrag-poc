"""Evidence object model shared by retrieval pipelines.

Evidence is what the pipelines record about every candidate and selected
chunk: provenance, scores and the selected/discarded outcome
(docs/retrieval/evidence-ranking.md, docs/retrieval/reranking.md).
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class EvidenceChunk(BaseModel):
    """One retrieved chunk with its provenance and ranking outcome."""

    chunk_id: str
    document_id: str
    chunk_index: int
    text: str
    title: str
    document_type: str
    market_id: str
    language_code: str
    source_system: str
    valid_from: str | None = None
    valid_to: str | None = None

    similarity: float = Field(description="Vector similarity at retrieval time")
    rank: int = Field(description="Position after ranking (1-based)")
    rerank_score: float | None = Field(
        default=None, description="Reranker score when reranking is enabled"
    )
    selected: bool = False
    discard_reason: str | None = Field(
        default=None,
        description="Why the chunk was not selected: context_budget | duplicate | below_rank",
    )


class Citation(BaseModel):
    """A citation rendered under an answer; every citation is inspectable."""

    chunk_id: str
    document_id: str
    title: str
    source_system: str
    source_record_id: str
    market_id: str
    language_code: str


class RagAnswer(BaseModel):
    """Generated answer plus its cost and grounded citations."""

    text: str
    model: str
    latency_ms: float
    context_tokens: int
    citations: list[Citation]


class RagRunResult(BaseModel):
    """Complete record of one standard RAG execution."""

    run_id: str
    question: str
    answer: RagAnswer
    evidence: list[EvidenceChunk]
    embedding_model: str
    generation_model: str
