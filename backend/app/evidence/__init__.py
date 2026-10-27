"""Evidence object model shared by retrieval pipelines.

Evidence is what the pipelines record about every candidate and selected
chunk: provenance, scores and the selected/discarded outcome
(docs/reference/retrieval/evidence-ranking.md, docs/reference/retrieval/reranking.md).
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

# Graph relevance tiers (method v0.3, D-083), in order: the seeds, the nodes
# that hold a type the question asks about, then every other node.
GraphTier = Literal["seed", "target", "other"]


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
    rank: int = Field(
        description=(
            "1-based position in its channel: cross-encoder order for chunks and records,"
            " graph relevance order for graph nodes"
        )
    )
    graph_path: str | None = Field(
        default=None,
        description=(
            "A graph node's walked path from its seed, one line"
            " (INC_1 -AFFECTS-> GAME_1); None for a seed and for documents"
        ),
    )
    graph_seed: str | None = Field(
        default=None,
        description=(
            "The seed id a graph node's walked path starts at; set exactly when graph_path is"
        ),
    )
    facts_heading: str | None = Field(
        default=None,
        description=(
            "Heading of a record's compact facts (Incident INC_024), for a record block"
            " and a graph node with one; None for documents and nodes without a record block"
        ),
    )
    facts: list[tuple[str, str]] = Field(
        default_factory=list,
        description="A record's compact facts as (name, value), in prompt order",
    )
    discovered_via: str = Field(
        default="vector",
        description=(
            "How the chunk entered the candidate set: "
            "vector | graph_traversal | vector+graph_traversal"
        ),
    )
    rerank_score: float | None = Field(
        default=None,
        description="Cross-encoder score of a chunk or record; None for graph nodes",
    )
    selected: bool = False
    discard_reason: str | None = Field(
        default=None,
        description=(
            "Why the chunk was not selected: context_budget | duplicate | same_record"
            " (its row is already selected through the other channel)"
        ),
    )

    @model_validator(mode="after")
    def _path_has_its_seed(self) -> EvidenceChunk:
        if (self.graph_path is None) != (self.graph_seed is None):
            raise ValueError(f"{self.chunk_id}: graph_seed must be set exactly when graph_path is")
        return self


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
    selection's order, whatever its kind), so
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
    tier: GraphTier | None = Field(
        default=None,
        description="Graph relevance tier; None for a node refused before the graph order",
    )
    graph_rank: int | None = Field(
        default=None,
        description="1-based position in the graph channel; None when refused before the order",
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
