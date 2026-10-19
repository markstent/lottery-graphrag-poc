"""Standard RAG pipeline (docs/retrieval/standard-rag.md).

    question -> dense + sparse embedding -> hybrid search (RRF) -> top-k
             -> reranking -> context assembly (shared budget and slots)
             -> LLM -> answer + citations

Every candidate and selected chunk is recorded with its scores; every stage
emits typed events. The baseline is never weakened: chunking comes from the
generation-time chunker, and reranking, budgeting and prompts are shared
contracts that the graph pipeline must match.
"""

from __future__ import annotations

from collections.abc import Sequence

from app.config import RetrievalSettings
from app.events import (
    RAG_CANDIDATE_RERANKED,
    RAG_CANDIDATE_RETRIEVED,
    RAG_CONTEXT_ASSEMBLED,
    RAG_EMBEDDING_COMPLETED,
    RAG_EMBEDDING_STARTED,
    RAG_EVIDENCE_DISCARDED,
    RAG_EVIDENCE_SELECTED,
    RAG_GENERATION_COMPLETED,
    RAG_GENERATION_STARTED,
    RAG_QUERY_RECEIVED,
    RAG_RERANK_STARTED,
    RAG_VECTOR_SEARCH_STARTED,
    EventEmitter,
    ListEventSink,
    RetrievalEvent,
    new_run_id,
)
from app.evidence import Citation, EvidenceChunk, RagAnswer, RagRunResult
from app.retrieval.standard.context import assemble_context
from app.retrieval.standard.corpus import hit_to_evidence
from app.retrieval.standard.embeddings import EmbeddingFunction
from app.retrieval.standard.generation import AnswerGenerator, parse_answer
from app.retrieval.standard.reranking import Reranker
from app.retrieval.standard.sparse import SparseEmbedder
from app.retrieval.standard.vector_store import VectorStore


class StandardRagPipeline:
    """Pipeline A: conventional RAG over the shared document vector index."""

    def __init__(
        self,
        *,
        embeddings: EmbeddingFunction,
        sparse: SparseEmbedder,
        store: VectorStore,
        generator: AnswerGenerator,
        settings: RetrievalSettings,
        reranker: Reranker,
        pipeline: str = "A",
        sink: ListEventSink | None = None,
    ) -> None:
        self.embeddings = embeddings
        self.sparse = sparse
        self.store = store
        self.generator = generator
        self.settings = settings
        self.reranker = reranker
        self.pipeline = pipeline
        self.sink = sink if sink is not None else ListEventSink()
        self.emitter = EventEmitter(pipeline, self.sink)

    @property
    def events(self) -> list[RetrievalEvent]:
        return self.sink.events

    def run(self, question: str, markets: Sequence[str] | None = None) -> RagRunResult:
        """Run one question; ``markets`` (full market ids) scopes retrieval."""
        if not question.strip():
            raise ValueError("Question must not be empty")
        scope = list(markets) if markets else None

        self.emitter.emit(RAG_QUERY_RECEIVED, question=question, markets=",".join(scope or []))

        self.emitter.emit(RAG_EMBEDDING_STARTED, model=self.embeddings.model_name)
        query_vector = self.embeddings.embed([question])[0]
        query_terms = self.sparse.embed_query(question)
        self.emitter.emit(
            RAG_EMBEDDING_COMPLETED, model=self.embeddings.model_name, dimensions=len(query_vector)
        )

        self.emitter.emit(RAG_VECTOR_SEARCH_STARTED, top_k=self.settings.top_k)
        hits = self.store.search(
            query_vector, query_terms, limit=self.settings.top_k, markets=scope
        )
        # similarity holds the fused (RRF) score of the hybrid search.
        candidates = [hit_to_evidence(hit, rank) for rank, hit in enumerate(hits, start=1)]
        for candidate in candidates:
            self.emitter.emit(
                RAG_CANDIDATE_RETRIEVED,
                chunk_id=candidate.chunk_id,
                document_id=candidate.document_id,
                similarity=candidate.similarity,
                dense_rank=candidate.dense_rank,
                sparse_rank=candidate.sparse_rank,
                rank=candidate.rank,
            )

        self.emitter.emit(
            RAG_RERANK_STARTED, candidates=len(candidates), model=self.reranker.model_name
        )
        candidates = self.reranker.rerank(question, candidates)
        for candidate in candidates:
            self.emitter.emit(
                RAG_CANDIDATE_RERANKED,
                chunk_id=candidate.chunk_id,
                similarity=candidate.similarity,
                rerank_score=candidate.rerank_score,
                rank=candidate.rank,
            )

        assembly = assemble_context([], candidates, self.settings.context)
        selected, discarded = assembly.document_selected, assembly.discarded
        for chunk in selected:
            self.emitter.emit(RAG_EVIDENCE_SELECTED, chunk_id=chunk.chunk_id, rank=chunk.rank)
        for chunk in discarded:
            self.emitter.emit(
                RAG_EVIDENCE_DISCARDED, chunk_id=chunk.chunk_id, reason=chunk.discard_reason
            )

        context_tokens = assembly.context_tokens
        self.emitter.emit(
            RAG_CONTEXT_ASSEMBLED,
            selected=len(selected),
            discarded=len(discarded),
            context_tokens=context_tokens,
            evidence_slots=self.settings.context.evidence_slots,
        )

        self.emitter.emit(RAG_GENERATION_STARTED, model=self.generator.model_name)
        output = self.generator.generate(question, selected)
        parsed = parse_answer(output.raw_text, block_count=len(selected))
        answer = RagAnswer(
            text=parsed.answer,
            verdict=parsed.verdict,
            cited_blocks=parsed.cited_blocks,
            raw_text=output.raw_text,
            model=self.generator.model_name,
            latency_ms=round(output.latency_ms, 1),
            context_tokens=context_tokens,
            citations=[self._citation(chunk) for chunk in selected],
            usage=output.usage,
        )
        self.emitter.emit(
            RAG_GENERATION_COMPLETED,
            model=self.generator.model_name,
            latency_ms=answer.latency_ms,
            context_tokens=context_tokens,
            verdict=answer.verdict,
            cited_blocks=len(answer.cited_blocks),
        )

        evidence = sorted([*selected, *discarded], key=lambda chunk: chunk.rank)
        return RagRunResult(
            run_id=new_run_id(),
            question=question,
            answer=answer,
            evidence=evidence,
            embedding_model=self.embeddings.model_name,
            generation_model=self.generator.model_name,
        )

    @staticmethod
    def _citation(chunk: EvidenceChunk) -> Citation:
        return Citation(
            chunk_id=chunk.chunk_id,
            document_id=chunk.document_id,
            title=chunk.title,
            source_system=chunk.source_system,
            source_record_id=chunk.document_id,
            market_id=chunk.market_id,
            language_code=chunk.language_code,
        )
