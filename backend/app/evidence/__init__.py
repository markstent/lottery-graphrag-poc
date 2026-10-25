"""Evidence object model shared by retrieval pipelines.

Evidence is what the pipelines record about every candidate and selected
chunk: provenance, scores and the selected/discarded outcome
(docs/reference/retrieval/evidence-ranking.md, docs/reference/retrieval/reranking.md).
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
    kind: str = Field(
        default="chunk",
        description="chunk (document text) | record (table row) | node (graph block)",
    )
    record_table: str | None = Field(
        default=None,
        description="Source table when kind is record, or of a graph node's authoritative row",
    )

    similarity: float = Field(
        description=(
            "Score within the candidate's channel: for chunks and records the fused "
            "reciprocal-rank score of the dense and sparse channels (not a cosine); "
            "for graph nodes the graph composite score"
        )
    )
    dense_rank: int | None = Field(
        default=None, description="1-based rank in the dense channel; None if absent or unknown"
    )
    sparse_rank: int | None = Field(
        default=None, description="1-based rank in the sparse channel; None if absent or unknown"
    )
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
        description=(
            "Why the chunk was not selected: context_budget | slot_limit | duplicate"
            " | superseded_by_structured_fact"
        ),
    )


class Citation(BaseModel):
    """A citation rendered under an answer; every citation is inspectable."""

    chunk_id: str
    document_id: str
    title: str
    source_system: str
    source_record_id: str
    record_table: str | None = Field(
        default=None, description="Source table of a record block or graph node; None for documents"
    )
    market_id: str
    language_code: str


class RagAnswer(BaseModel):
    """Generated answer plus its cost and grounded citations.

    `citations` lists every block shown to the model in prompt order (the
    selected evidence in judge order, whatever its kind), so
    `cited_blocks[i]` refers to `citations[cited_blocks[i] - 1]`.
    """

    text: str = Field(description="Parsed prose answer; what the evaluator scores")
    verdict: str = Field(description="One-line verdict; empty when the model gave none")
    cited_blocks: list[int] = Field(
        description="1-based context blocks the answer cites, in first-seen order"
    )
    raw_text: str = Field(description="Model output verbatim")
    model: str
    latency_ms: float
    context_tokens: int
    citations: list[Citation]
    usage: dict[str, int] | None = Field(
        default=None, description="Gateway token counts when the provider reports them"
    )


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
    rerank_score: float | None = Field(
        default=None, description="Shared reranker score; None when the node was never judged"
    )
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
