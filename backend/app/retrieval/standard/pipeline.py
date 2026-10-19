"""Standard RAG pipeline (docs/retrieval/standard-rag.md).

    question -> embedding -> vector search -> top-k
             -> optional reranking -> context budget selection
             -> LLM -> answer + citations

Every candidate and selected chunk is recorded with its scores; every stage
emits typed events. The baseline is never weakened: chunking comes from the
generation-time chunker, and reranking, budgeting and prompts are shared
contracts that the graph pipeline must match.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol

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
from app.retrieval.standard.context import estimate_tokens, select_context
from app.retrieval.standard.corpus import CorpusChunk
from app.retrieval.standard.embeddings import EmbeddingFunction
from app.retrieval.standard.generation import AnswerGenerator
from app.retrieval.standard.reranking import LexicalReranker
from app.retrieval.standard.vector_store import VectorStore


class Reranker(Protocol):
    def rerank(self, question: str, candidates: list[EvidenceChunk]) -> list[EvidenceChunk]: ...


class StandardRagPipeline:
    """Pipeline A: conventional RAG over the shared document vector index."""

    def __init__(
        self,
        *,
        embeddings: EmbeddingFunction,
        store: VectorStore,
        generator: AnswerGenerator,
        settings: RetrievalSettings,
        reranker: Reranker | None = None,
        pipeline: str = "A",
        sink: ListEventSink | None = None,
    ) -> None:
        self.embeddings = embeddings
        self.store = store
        self.generator = generator
        self.settings = settings
        self.reranker: Reranker | None = (
            reranker
            if reranker is not None
            else (
                LexicalReranker(settings.rerank.lexical_weight) if settings.rerank.enabled else None
            )
        )
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
        self.emitter.emit(
            RAG_EMBEDDING_COMPLETED, model=self.embeddings.model_name, dimensions=len(query_vector)
        )

        self.emitter.emit(RAG_VECTOR_SEARCH_STARTED, top_k=self.settings.top_k)
        hits = self.store.search(query_vector, limit=self.settings.top_k, markets=scope)
        candidates = [
            self._payload_to_evidence(point_id, similarity, payload, rank)
            for rank, (point_id, similarity, payload) in enumerate(hits, start=1)
        ]
        for candidate in candidates:
            self.emitter.emit(
                RAG_CANDIDATE_RETRIEVED,
                chunk_id=candidate.chunk_id,
                document_id=candidate.document_id,
                similarity=candidate.similarity,
                rank=candidate.rank,
            )

        if self.reranker is not None:
            self.emitter.emit(RAG_RERANK_STARTED, candidates=len(candidates))
            candidates = self.reranker.rerank(question, candidates)
            for candidate in candidates:
                self.emitter.emit(
                    RAG_CANDIDATE_RERANKED,
                    chunk_id=candidate.chunk_id,
                    similarity=candidate.similarity,
                    rerank_score=candidate.rerank_score,
                    rank=candidate.rank,
                )

        selected, discarded = select_context(
            candidates,
            budget_tokens=self.settings.context.budget_tokens,
            dedupe_threshold=self.settings.context.dedupe_threshold,
        )
        for chunk in selected:
            self.emitter.emit(RAG_EVIDENCE_SELECTED, chunk_id=chunk.chunk_id, rank=chunk.rank)
        for chunk in discarded:
            self.emitter.emit(
                RAG_EVIDENCE_DISCARDED, chunk_id=chunk.chunk_id, reason=chunk.discard_reason
            )

        context_tokens = sum(estimate_tokens(chunk.text) for chunk in selected)
        self.emitter.emit(
            RAG_CONTEXT_ASSEMBLED,
            selected=len(selected),
            discarded=len(discarded),
            context_tokens=context_tokens,
        )

        self.emitter.emit(RAG_GENERATION_STARTED, model=self.generator.model_name)
        answer_text, latency_ms = self.generator.generate(question, selected)
        answer = RagAnswer(
            text=answer_text,
            model=self.generator.model_name,
            latency_ms=round(latency_ms, 1),
            context_tokens=context_tokens,
            citations=[self._citation(chunk) for chunk in selected],
        )
        self.emitter.emit(
            RAG_GENERATION_COMPLETED,
            model=self.generator.model_name,
            latency_ms=answer.latency_ms,
            context_tokens=context_tokens,
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

    def _payload_to_evidence(
        self, point_id: str, similarity: float, payload: dict[str, object], rank: int
    ) -> EvidenceChunk:
        chunk = CorpusChunk(
            chunk_id=str(payload.get("chunk_id", point_id)),
            document_id=str(payload.get("document_id", "")),
            chunk_index=int(str(payload.get("chunk_index", 0))),
            text=str(payload.get("text", "")),
            title=str(payload.get("title", "")),
            document_type=str(payload.get("document_type", "")),
            market_id=str(payload.get("market_id", "")),
            language_code=str(payload.get("language_code", "")),
            source_system=str(payload.get("source_system", "")),
            valid_from=_optional_text(payload.get("valid_from")),
            valid_to=_optional_text(payload.get("valid_to")),
            kind=str(payload.get("kind", "chunk")),
            record_table=_optional_text(payload.get("record_table")),
        )
        return chunk.to_evidence(similarity=similarity, rank=rank)

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


def _optional_text(value: object) -> str | None:
    if value is None or value == "" or value == "None":
        return None
    return str(value)
