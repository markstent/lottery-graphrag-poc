"""Standard RAG tests (docs/08 Phase 8): retrieval correctness, context
limits and deterministic fake-model integration."""

from __future__ import annotations

import dataclasses
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq
import pytest
from app.config import (
    ContextSettings,
    EmbeddingSettings,
    GenerationSettings,
    RerankSettings,
    RetrievalSettings,
    VectorSettings,
)
from app.events import (
    RAG_CANDIDATE_RETRIEVED,
    RAG_CONTEXT_ASSEMBLED,
    RAG_EMBEDDING_COMPLETED,
    RAG_EMBEDDING_STARTED,
    RAG_EVIDENCE_DISCARDED,
    RAG_EVIDENCE_SELECTED,
    RAG_GENERATION_COMPLETED,
    RAG_GENERATION_STARTED,
    RAG_QUERY_RECEIVED,
    RAG_VECTOR_SEARCH_STARTED,
)
from app.evidence import EvidenceChunk
from app.retrieval.standard.context import estimate_tokens, select_context
from app.retrieval.standard.corpus import CorpusChunk, load_corpus
from app.retrieval.standard.embeddings import HashingEmbedder
from app.retrieval.standard.generation import FakeAnswerGenerator
from app.retrieval.standard.pipeline import StandardRagPipeline
from app.retrieval.standard.vector_store import InMemoryVectorStore


def make_settings(**overrides: object) -> RetrievalSettings:
    values: dict[str, object] = {
        "dataset_dir": "unused",
        "top_k": 4,
        "embedding": EmbeddingSettings(
            provider="hashing", model="hashing-256", dimensions=256, host=""
        ),
        "vector": VectorSettings(url="", collection="test"),
        "context": ContextSettings(budget_tokens=200, dedupe_threshold=0.85),
        "rerank": RerankSettings(enabled=False, lexical_weight=0.3),
        "generation": GenerationSettings(
            provider="fake", model="fake-answer-v1", temperature=0.0, api_base=None
        ),
    }
    values.update(overrides)
    return RetrievalSettings(**values)  # type: ignore[arg-type]


def make_corpus() -> list[CorpusChunk]:
    return [
        CorpusChunk(
            chunk_id="CHNK_PAY_00",
            document_id="DOC_PAY",
            chunk_index=0,
            text=(
                "Greece checkout regression: the payment platform update broke digital "
                "ticket purchase completion for five days in May. Incident INC_S007_GR "
                "records the failure and the recovery."
            ),
            title="Payments Incident Report",
            document_type="INCIDENT",
            market_id="MKT_GR",
            language_code="en",
            source_system="document_store",
            valid_from="2026-05-21 00:00:00",
            valid_to=None,
        ),
        CorpusChunk(
            chunk_id="CHNK_MARKETING_00",
            document_id="DOC_MKT",
            chunk_index=0,
            text="A spring marketing campaign promoted digital tickets across retail channels.",
            title="Campaign Brief",
            document_type="CAMPAIGN",
            market_id="MKT_UK",
            language_code="en",
            source_system="document_store",
            valid_from="2026-03-01 00:00:00",
            valid_to=None,
        ),
        CorpusChunk(
            chunk_id="CHNK_RULES_00",
            document_id="DOC_RULES",
            chunk_index=0,
            text="Game rules describe draw times and prize tiers for the national game.",
            title="Game Rules",
            document_type="GAME_RULES",
            market_id="MKT_CZ",
            language_code="cs",
            source_system="document_store",
            valid_from="2026-01-01 00:00:00",
            valid_to=None,
        ),
    ]


def build_pipeline(
    corpus: list[CorpusChunk], settings: RetrievalSettings | None = None
) -> StandardRagPipeline:
    settings = settings or make_settings()
    embeddings = HashingEmbedder(dimensions=settings.embedding.dimensions)
    store = InMemoryVectorStore()
    store.upsert(
        ids=[chunk.chunk_id for chunk in corpus],
        vectors=embeddings.embed([chunk.text for chunk in corpus]),
        payloads=[chunk.to_payload() for chunk in corpus],
    )
    return StandardRagPipeline(
        embeddings=embeddings,
        store=store,
        generator=FakeAnswerGenerator(),
        settings=settings,
    )


class TestRetrievalCorrectness:
    def test_relevant_document_ranks_first_and_is_selected(self) -> None:
        pipeline = build_pipeline(make_corpus())
        result = pipeline.run("Why did Greek digital ticket purchase completion fail?")

        top = result.evidence[0]
        assert top.chunk_id == "CHNK_PAY_00"
        assert top.selected is True
        assert top.rank == 1
        assert top.similarity > 0.0

    def test_citations_match_selected_evidence(self) -> None:
        pipeline = build_pipeline(make_corpus())
        result = pipeline.run("checkout regression in Greece")

        selected_ids = {chunk.chunk_id for chunk in result.evidence if chunk.selected}
        cited_ids = {citation.chunk_id for citation in result.answer.citations}
        assert cited_ids == selected_ids
        assert result.answer.context_tokens == sum(
            estimate_tokens(chunk.text) for chunk in result.evidence if chunk.selected
        )

    def test_all_candidates_recorded_with_scores(self) -> None:
        pipeline = build_pipeline(make_corpus())
        result = pipeline.run("checkout regression in Greece")

        assert len(result.evidence) == 3
        assert all(chunk.similarity >= 0.0 for chunk in result.evidence)
        assert [chunk.rank for chunk in result.evidence] == [1, 2, 3]

    def test_reranker_sets_scores_and_reorders(self) -> None:
        settings = make_settings(rerank=RerankSettings(enabled=True, lexical_weight=0.5))
        pipeline = build_pipeline(make_corpus(), settings)
        result = pipeline.run("checkout regression in Greece")

        reranked = [chunk for chunk in result.evidence if chunk.rerank_score is not None]
        assert reranked, "reranking must record scores"
        scores = [chunk.rerank_score for chunk in result.evidence]
        assert scores == sorted(scores, reverse=True)

    def test_reranker_disabled_keeps_similarity_order(self) -> None:
        pipeline = build_pipeline(make_corpus())  # rerank disabled by default
        result = pipeline.run("checkout regression in Greece")
        assert all(chunk.rerank_score is None for chunk in result.evidence)

    def test_deterministic_runs_produce_identical_results(self) -> None:
        first = build_pipeline(make_corpus()).run("checkout regression in Greece")
        second = build_pipeline(make_corpus()).run("checkout regression in Greece")

        assert first.answer.text == second.answer.text
        assert [chunk.chunk_id for chunk in first.evidence] == [
            chunk.chunk_id for chunk in second.evidence
        ]
        assert [chunk.selected for chunk in first.evidence] == [
            chunk.selected for chunk in second.evidence
        ]

    def test_empty_question_rejected(self) -> None:
        pipeline = build_pipeline(make_corpus())
        with pytest.raises(ValueError, match="empty"):
            pipeline.run("   ")


class TestContextLimits:
    def test_budget_limits_selected_context(self) -> None:
        settings = make_settings(context=ContextSettings(budget_tokens=60, dedupe_threshold=0.85))
        pipeline = build_pipeline(make_corpus(), settings)
        result = pipeline.run("checkout regression in Greece")

        assert result.answer.context_tokens <= 60
        discarded = [chunk for chunk in result.evidence if not chunk.selected]
        assert discarded, "a tight budget must discard something"
        assert all(chunk.discard_reason == "context_budget" for chunk in discarded)

    def test_duplicates_are_filtered(self) -> None:
        corpus = make_corpus()

        def candidate(chunk: CorpusChunk, rank: int, similarity: float) -> EvidenceChunk:
            return chunk.to_evidence(similarity=similarity, rank=rank)

        twin = dataclasses.replace(corpus[0], chunk_id="CHNK_PAY_01", chunk_index=1)
        candidates = [
            candidate(corpus[0], 1, 0.9),
            candidate(twin, 2, 0.85),
            candidate(corpus[1], 3, 0.4),
        ]
        selected, discarded = select_context(candidates, budget_tokens=1000)

        assert [chunk.chunk_id for chunk in selected] == ["CHNK_PAY_00", "CHNK_MARKETING_00"]
        assert [chunk.discard_reason for chunk in discarded] == ["duplicate"]

    def test_discarded_chunks_carry_reasons(self) -> None:
        settings = make_settings(context=ContextSettings(budget_tokens=40, dedupe_threshold=0.85))
        pipeline = build_pipeline(make_corpus(), settings)
        result = pipeline.run("checkout regression in Greece")
        for chunk in result.evidence:
            if not chunk.selected:
                assert chunk.discard_reason in {"context_budget", "duplicate"}


class TestTelemetry:
    def test_event_sequence_is_complete_and_ordered(self) -> None:
        pipeline = build_pipeline(make_corpus())
        pipeline.run("checkout regression in Greece")

        event_types = [event.event_type for event in pipeline.events]
        assert event_types[0] == RAG_QUERY_RECEIVED
        assert event_types[1] == RAG_EMBEDDING_STARTED
        assert RAG_EMBEDDING_COMPLETED in event_types
        assert RAG_VECTOR_SEARCH_STARTED in event_types
        assert event_types.count(RAG_CANDIDATE_RETRIEVED) == 3
        assert event_types.count(RAG_EVIDENCE_SELECTED) >= 1
        assert RAG_CONTEXT_ASSEMBLED in event_types
        assert RAG_GENERATION_STARTED in event_types
        assert event_types[-1] == RAG_GENERATION_COMPLETED

    def test_selection_and_discard_events_agree_with_evidence(self) -> None:
        pipeline = build_pipeline(make_corpus(), make_settings(top_k=3))
        result = pipeline.run("checkout regression in Greece")

        selected_events = {
            event.payload["chunk_id"]
            for event in pipeline.events
            if event.event_type == RAG_EVIDENCE_SELECTED
        }
        discarded_events = {
            event.payload["chunk_id"]
            for event in pipeline.events
            if event.event_type == RAG_EVIDENCE_DISCARDED
        }
        evidence_selected = {chunk.chunk_id for chunk in result.evidence if chunk.selected}
        assert selected_events == evidence_selected
        assert selected_events | discarded_events == {chunk.chunk_id for chunk in result.evidence}

    def test_fake_generator_answer_is_deterministic(self) -> None:
        pipeline = build_pipeline(make_corpus())
        result = pipeline.run("checkout regression in Greece")
        assert result.answer.text.startswith("[fake-model]")
        assert "Payments Incident Report" in result.answer.text
        assert result.answer.model == "fake-answer-v1"


class TestEmbeddings:
    def test_deterministic_and_normalised(self) -> None:
        embedder = HashingEmbedder(dimensions=64)
        first = embedder.embed(["checkout regression"])
        second = embedder.embed(["checkout regression"])
        assert first == second
        for vector in first:
            assert len(vector) == 64
            assert abs(sum(value * value for value in vector) - 1.0) < 1e-9

    def test_multilingual_tokens_produce_distinct_vectors(self) -> None:
        embedder = HashingEmbedder(dimensions=64)
        greek = embedder.embed(["σύνοψη παρατηρήσεων"])[0]
        czech = embedder.embed(["souhrn pozorování"])[0]
        assert greek != czech

    def test_different_texts_differ(self) -> None:
        embedder = HashingEmbedder(dimensions=64)
        vectors = embedder.embed(["payments incident", "game rules"])
        assert vectors[0] != vectors[1]


class TestContextSelection:
    def test_estimate_tokens_positive(self) -> None:
        assert estimate_tokens("") == 1
        assert estimate_tokens("abcd" * 10) == 10


class TestCorpusLoader:
    def test_load_corpus_joins_documents(self, tmp_path: Path) -> None:
        documents = pa.table(
            {
                "document_id": pa.array(["DOC_1"]),
                "document_type": pa.array(["INCIDENT"]),
                "market_id": pa.array(["MKT_GR"]),
                "language_code": pa.array(["en"]),
                "title": pa.array(["Incident Report"]),
                "created_at": pa.array([1], type=pa.timestamp("us")),
                "valid_from": pa.array([1], type=pa.timestamp("us")),
                "valid_to": pa.array([None], type=pa.timestamp("us")),
                "source_system_code": pa.array(["document_store"]),
                "source_record_id": pa.array([None]),
                "body": pa.array(["body text"]),
            }
        )
        chunks = pa.table(
            {
                "chunk_id": pa.array(["CHNK_1_00", "CHNK_1_01"]),
                "document_id": pa.array(["DOC_1", "DOC_1"]),
                "chunk_index": pa.array([0, 1], type=pa.int32()),
                "text": pa.array(["first chunk", "second chunk"]),
                "token_count": pa.array([2, 2], type=pa.int32()),
                "embedding_version": pa.array([None, None]),
            }
        )
        pq.write_table(documents, tmp_path / "documents.parquet")
        pq.write_table(chunks, tmp_path / "document_chunks.parquet")

        corpus = load_corpus(tmp_path)
        assert [chunk.chunk_id for chunk in corpus] == ["CHNK_1_00", "CHNK_1_01"]
        first = corpus[0]
        assert first.title == "Incident Report"
        assert first.source_system == "document_store"
        assert first.valid_to is None
        payload = first.to_payload()
        assert payload["text"] == "first chunk"

        evidence: EvidenceChunk = first.to_evidence(similarity=0.5, rank=1)
        assert evidence.rank == 1
        assert evidence.selected is False
