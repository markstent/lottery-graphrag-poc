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
    kind: str = Field(default="chunk", description="chunk (document text) | record (table row)")
    record_table: str | None = Field(default=None, description="Source table when kind is record")

    similarity: float = Field(description="Vector similarity at retrieval time")
    rank: int = Field(description="Position after ranking (1-based)")
    discovered_via: str = Field(
        default="vector",
        description=(
            "How the chunk entered the candidate set: "
            "vector | graph_traversal | vector+graph_traversal"
        ),
    )
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


class GraphEvidence(BaseModel):
    """One graph node candidate with its transparent ranking outcome.

    Structured nodes additionally carry authoritative facts read from the
    warehouse Parquet layer (the graph guides, Parquet states facts).
    """

    node_id: str
    node_label: str
    hops: int
    path: list[str]
    rel_type: str
    score: float
    components: dict[str, float]
    selected: bool = False
    discard_reason: str | None = None
    authoritative: dict[str, str] | None = Field(
        default=None, description="Authoritative structured-layer facts for this node"
    )


class GraphRunResult(BaseModel):
    """Complete record of one graph-enhanced execution (pipeline B or C)."""

    run_id: str
    question: str
    answer: RagAnswer
    node_evidence: list[GraphEvidence]
    document_evidence: list[EvidenceChunk]
    ontology_concepts: list[str]
    embedding_model: str
    generation_model: str
