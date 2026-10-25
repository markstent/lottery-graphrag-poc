"""Standard RAG tests (docs/reference/08 Phase 8): retrieval correctness, context
limits and deterministic fake-model integration."""

from __future__ import annotations

import dataclasses
import json
import re
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
    EventEmitter,
    ListEventSink,
)
from app.evidence import EvidenceChunk
from app.retrieval.standard import index as index_module
from app.retrieval.standard.context import estimate_tokens, select_context
from app.retrieval.standard.corpus import CorpusChunk, load_corpus
from app.retrieval.standard.embeddings import HashingEmbedder
from app.retrieval.standard.fusion import reciprocal_rank_fusion
from app.retrieval.standard.generation import FakeAnswerGenerator
from app.retrieval.standard.pipeline import StandardRagPipeline
from app.retrieval.standard.reranking import LexicalReranker, build_reranker
from app.retrieval.standard.sparse import HashingSparseEmbedder
from app.retrieval.standard.vector_store import InMemoryVectorStore

from tests.test_graph_rag import event_trace


def make_settings(**overrides: object) -> RetrievalSettings:
    values: dict[str, object] = {
        "dataset_dir": "unused",
        "top_k": 4,
        "embedding": EmbeddingSettings(
            provider="hashing", model="hashing-256", dimensions=256, host=""
        ),
        "vector": VectorSettings(url="", collection="test"),
        "context": ContextSettings(budget_tokens=200, dedupe_threshold=0.85),
        "rerank": RerankSettings(provider="lexical", model="unused"),
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
    sparse = HashingSparseEmbedder()
    index_module.index_corpus(store, embeddings, sparse, corpus)
    return StandardRagPipeline(
        embeddings=embeddings,
        sparse=sparse,
        store=store,
        generator=FakeAnswerGenerator(),
        settings=settings,
        reranker=build_reranker(settings),
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
        pipeline = build_pipeline(make_corpus())
        result = pipeline.run("checkout regression in Greece")

        reranked = [chunk for chunk in result.evidence if chunk.rerank_score is not None]
        assert reranked, "reranking must record scores"
        assert len(reranked) == len(result.evidence)
        scores = [chunk.rerank_score for chunk in reranked if chunk.rerank_score is not None]
        assert scores == sorted(scores, reverse=True)

    def test_lexical_judge_scores_overlap_only_with_a_chunk_id_tie_break(self) -> None:
        def candidate(chunk_id: str, text: str, rank: int) -> EvidenceChunk:
            return dataclasses.replace(make_corpus()[0], chunk_id=chunk_id, text=text).to_evidence(
                similarity=0.03, rank=rank
            )

        reranked = LexicalReranker().rerank(
            "checkout regression",
            [
                candidate("FIRST", "unrelated text", 1),
                candidate("THIRD", "checkout only", 2),
                candidate("SECOND", "checkout regression", 3),
                candidate("ALSO", "checkout again", 4),
            ],
        )
        # Overlap alone decides; the incoming rank plays no part, and equal
        # overlap orders by chunk id, so the same text scores the same in
        # every pipeline and channel.
        assert [(c.chunk_id, c.rerank_score, c.rank) for c in reranked] == [
            ("SECOND", 1.0, 1),
            ("ALSO", 0.5, 2),
            ("THIRD", 0.5, 3),
            ("FIRST", 0.0, 4),
        ]
        assert LexicalReranker().model_name == "lexical-overlap"

    def test_evidence_and_events_carry_channel_ranks(self) -> None:
        pipeline = build_pipeline(make_corpus())
        result = pipeline.run("Greece checkout regression payment platform")
        top = result.evidence[0]
        assert top.chunk_id == "CHNK_PAY_00"
        assert top.dense_rank == 1 and top.sparse_rank == 1
        retrieved = [e for e in pipeline.events if e.event_type == RAG_CANDIDATE_RETRIEVED]
        assert retrieved[0].payload["dense_rank"] == 1
        assert retrieved[0].payload["sparse_rank"] == 1

    def test_hit_absent_from_corpus_still_becomes_evidence(self) -> None:
        pipeline = build_pipeline(make_corpus())
        extra = dataclasses.replace(
            make_corpus()[0], chunk_id="CHNK_EXTRA_00", document_id="DOC_EXTRA"
        )
        index_module.index_corpus(pipeline.store, pipeline.embeddings, pipeline.sparse, [extra])
        result = pipeline.run("Greece checkout regression payment platform")
        assert "CHNK_EXTRA_00" in {chunk.chunk_id for chunk in result.evidence}

    def test_every_candidate_is_reranked_and_recorded(self) -> None:
        pipeline = build_pipeline(make_corpus())
        result = pipeline.run("checkout regression in Greece")
        assert all(chunk.rerank_score is not None for chunk in result.evidence)

    @pytest.mark.parametrize("markets", [None, ["MKT_GR"]])
    def test_deterministic_runs_produce_identical_results(self, markets: list[str] | None) -> None:
        """Two runs give the same telemetry, outcomes and answer, event for event."""
        runs = []
        for _ in range(2):
            pipeline = build_pipeline(make_corpus())
            result = pipeline.run("checkout regression in Greece", markets=markets)
            runs.append(
                (
                    event_trace(pipeline.events),
                    [(c.chunk_id, c.selected, c.discard_reason) for c in result.evidence],
                    result.answer.raw_text,
                )
            )
        assert runs[0] == runs[1]
        assert any(event_type == RAG_EVIDENCE_SELECTED for event_type, _, _ in runs[0][0])

    def test_empty_question_rejected(self) -> None:
        pipeline = build_pipeline(make_corpus())
        with pytest.raises(ValueError, match="empty"):
            pipeline.run("   ")


class TestMarketScope:
    def test_scoped_run_keeps_only_matching_market_documents(self) -> None:
        pipeline = build_pipeline(make_corpus())
        result = pipeline.run("checkout regression in Greece", markets=["MKT_GR"])

        ids = {chunk.chunk_id for chunk in result.evidence}
        assert ids == {"CHNK_PAY_00"}
        assert result.evidence[0].rank == 1

    def test_scoped_run_keeps_shared_market_less_evidence(self) -> None:
        shared = dataclasses.replace(
            make_corpus()[0], chunk_id="CHNK_SHARED_00", document_id="DOC_SHARED", market_id=""
        )
        pipeline = build_pipeline([*make_corpus(), shared])
        result = pipeline.run("checkout regression in Greece", markets=["MKT_GR"])
        assert {chunk.chunk_id for chunk in result.evidence} == {"CHNK_PAY_00", "CHNK_SHARED_00"}

    def test_empty_scope_means_all_markets(self) -> None:
        pipeline = build_pipeline(make_corpus())
        result = pipeline.run("checkout regression in Greece", markets=[])

        assert len(result.evidence) == 3

    def test_scope_is_recorded_on_the_query_event(self) -> None:
        pipeline = build_pipeline(make_corpus())
        pipeline.run("checkout regression in Greece", markets=["MKT_GR", "MKT_UK"])

        assert pipeline.events[0].event_type == RAG_QUERY_RECEIVED
        assert pipeline.events[0].payload["markets"] == "MKT_GR,MKT_UK"


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
        selected, discarded = select_context(candidates, budget_tokens=1000, graph_slots=0)

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

    def test_load_corpus_maps_missing_market_to_empty(self, tmp_path: Path) -> None:
        documents = pa.table(
            {
                "document_id": pa.array(["DOC_1"]),
                "document_type": pa.array(["POLICY"]),
                "market_id": pa.array([None], type=pa.string()),
                "language_code": pa.array(["en"]),
                "title": pa.array(["Group Policy"]),
                "source_system_code": pa.array(["document_store"]),
                "valid_from": pa.array([None], type=pa.timestamp("us")),
                "valid_to": pa.array([None], type=pa.timestamp("us")),
            }
        )
        chunks = pa.table(
            {
                "chunk_id": pa.array(["CHNK_1_00"]),
                "document_id": pa.array(["DOC_1"]),
                "chunk_index": pa.array([0], type=pa.int32()),
                "text": pa.array(["group policy"]),
            }
        )
        pq.write_table(documents, tmp_path / "documents.parquet")
        pq.write_table(chunks, tmp_path / "document_chunks.parquet")

        assert [chunk.market_id for chunk in load_corpus(tmp_path)] == [""]


class TestHybridVectorStore:
    TEXTS = (
        "payment checkout failure in Greece",
        "retail terminal outage in Prague",
        "Στιγμιαίο Λαχείο κανόνες",
    )

    def filled_store(self, payloads: list[dict[str, object]]) -> InMemoryVectorStore:
        store = InMemoryVectorStore()
        store.upsert(
            [f"c{i}" for i in range(len(self.TEXTS))],
            HashingEmbedder(64).embed(list(self.TEXTS)),
            HashingSparseEmbedder().embed_documents(list(self.TEXTS)),
            payloads,
        )
        return store

    def test_in_memory_hybrid_search_fuses_dense_and_sparse(self) -> None:
        store = self.filled_store([{"market_id": "MKT_GR", "kind": "chunk"}] * 3)
        query = "Στιγμιαίο Λαχείο"
        hits = store.search(
            HashingEmbedder(64).embed([query])[0],
            HashingSparseEmbedder().embed_query(query),
            limit=3,
        )
        assert hits[0].id == "c2"
        assert hits[0].sparse_rank == 1
        assert hits[0].dense_rank == 1
        expected = reciprocal_rank_fusion([["c2"], ["c2"]])[0][1]
        assert hits[0].score == pytest.approx(expected)
        assert [hit.score for hit in hits] == sorted((hit.score for hit in hits), reverse=True)

    def test_kind_filter_restricts_to_records(self) -> None:
        store = self.filled_store(
            [
                {"market_id": "MKT_GR", "kind": "chunk"},
                {"market_id": "MKT_CZ", "kind": "record"},
                {"market_id": "", "kind": "record"},
            ]
        )
        query = "payment checkout failure"
        dense = HashingEmbedder(64).embed([query])[0]
        sparse = HashingSparseEmbedder().embed_query(query)
        hits = store.search(dense, sparse, limit=3, kinds=["record"])
        assert {hit.id for hit in hits} == {"c1", "c2"}
        assert all(hit.payload["kind"] == "record" for hit in hits)
        # A market scope admits the scoped markets plus shared (market-less) evidence.
        scoped = store.search(dense, sparse, limit=3, markets=["MKT_CZ"], kinds=["record"])
        assert {hit.id for hit in scoped} == {"c1", "c2"}
        other = store.search(dense, sparse, limit=3, markets=["MKT_GR"], kinds=["record"])
        assert [hit.id for hit in other] == ["c2"]

    def test_build_index_refuses_dense_only_collection(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        class DenseOnlyStore(InMemoryVectorStore):
            def collection_info(self) -> dict[str, object]:
                return {"vectors": ["dense"], "sparse_vectors": [], "points": 0}

        store = DenseOnlyStore()
        monkeypatch.setattr(index_module, "build_store", lambda *_args: store)
        monkeypatch.setattr(index_module, "load_corpus", lambda _dir: make_corpus())
        monkeypatch.setattr(index_module, "serialise_records", lambda _dir: [])
        with pytest.raises(RuntimeError, match="collection lacks a sparse vector"):
            index_module.build_index(make_settings(), rebuild=False)
        assert store.count() == 0


def test_build_index_manifest_records_models_and_serialiser_version(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.retrieval.standard.records import RECORD_SERIALISER_VERSION

    monkeypatch.setattr(index_module, "load_corpus", lambda _dir: make_corpus())
    monkeypatch.setattr(index_module, "serialise_records", lambda _dir: [])
    manifest = index_module.build_index(make_settings(dataset_dir=str(tmp_path)))
    assert manifest["record_serialiser_version"] == RECORD_SERIALISER_VERSION
    assert manifest["sparse_model"] == "hashing-sparse-1048576"
    written = json.loads((tmp_path / "vector-index.json").read_text())
    assert written == manifest


def test_emitter_stamps_event_id_and_utc_timestamp() -> None:
    sink = ListEventSink()
    emitter = EventEmitter(pipeline="A", sink=sink)
    first, second = emitter.emit("x.one"), emitter.emit("x.two")
    assert re.fullmatch(r"[0-9a-f]{32}", first.event_id)
    assert first.event_id != second.event_id
    assert first.timestamp.endswith("+00:00")
    assert first.as_dict()["event_id"] == first.event_id
    assert first.as_dict()["timestamp"] == first.timestamp
