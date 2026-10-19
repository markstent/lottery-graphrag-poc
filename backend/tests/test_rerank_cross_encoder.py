"""Cross-encoder reranker and the shared reranker builder."""

from __future__ import annotations

import dataclasses
import os

import pytest
from app.config import RerankSettings
from app.evidence import EvidenceChunk
from app.retrieval.standard.reranking import (
    CrossEncoderReranker,
    LexicalReranker,
    build_reranker,
)

from tests.test_standard_rag import make_corpus, make_settings

DEFAULT_MODEL = "BAAI/bge-reranker-v2-m3"


def chunk(chunk_id: str, text: str, rank: int = 1) -> EvidenceChunk:
    return dataclasses.replace(make_corpus()[0], chunk_id=chunk_id, text=text).to_evidence(
        similarity=0.03, rank=rank
    )


class FakeCrossEncoder:
    """Scores a document by its length so tests control the ordering."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, list[str]]] = []

    def rerank(self, query: str, documents: list[str]) -> list[float]:
        self.calls.append((query, list(documents)))
        return [float(len(document)) for document in documents]


def reranker_with(fake: FakeCrossEncoder, candidates: int = 40) -> CrossEncoderReranker:
    return CrossEncoderReranker(DEFAULT_MODEL, candidates=candidates, encoder=fake)


def test_builder_rejects_unknown_model() -> None:
    settings = make_settings(
        rerank=RerankSettings(
            provider="cross_encoder", model="nope", lexical_weight=0.3, candidates=40
        )
    )
    with pytest.raises(ValueError, match="supported"):
        build_reranker(settings)


def test_builder_rejects_unknown_provider() -> None:
    settings = make_settings(
        rerank=RerankSettings(provider="nope", model="x", lexical_weight=0.3, candidates=40)
    )
    with pytest.raises(ValueError, match="provider"):
        build_reranker(settings)


def test_builder_lexical_provider() -> None:
    settings = make_settings(
        rerank=RerankSettings(
            provider="lexical", model=DEFAULT_MODEL, lexical_weight=0.4, candidates=40
        )
    )
    reranker = build_reranker(settings)
    assert isinstance(reranker, LexicalReranker)
    assert reranker.model_name == "lexical(w=0.4)"


def test_cross_encoder_scores_in_one_call_and_orders_by_score_then_chunk_id() -> None:
    fake = FakeCrossEncoder()
    out = reranker_with(fake).rerank(
        "q", [chunk("a", "xx", 1), chunk("c", "xxxx", 2), chunk("b", "xxxx", 3)]
    )
    assert fake.calls == [("q", ["xx", "xxxx", "xxxx"])]
    assert [(c.chunk_id, c.rerank_score, c.rank) for c in out] == [
        ("b", 4.0, 1),
        ("c", 4.0, 2),
        ("a", 2.0, 3),
    ]


def test_cross_encoder_scores_only_top_candidates_and_keeps_the_rest_in_order() -> None:
    fake = FakeCrossEncoder()
    out = reranker_with(fake, candidates=2).rerank(
        "q",
        [chunk("a", "x", 1), chunk("b", "xxx", 2), chunk("c", "xxxxxxxx", 3), chunk("d", "xx", 4)],
    )
    assert fake.calls == [("q", ["x", "xxx"])]
    assert [(c.chunk_id, c.rerank_score, c.rank) for c in out] == [
        ("b", 3.0, 1),
        ("a", 1.0, 2),
        ("c", None, 3),
        ("d", None, 4),
    ]


def test_cross_encoder_empty_candidates() -> None:
    fake = FakeCrossEncoder()
    assert reranker_with(fake).rerank("q", []) == []
    assert fake.calls == []


@pytest.mark.skipif(os.environ.get("RERANK_E2E") != "1", reason="downloads a model")
def test_cross_encoder_ranks_relevant_passage_first() -> None:
    reranker = build_reranker(
        make_settings(
            rerank=RerankSettings(
                provider="cross_encoder",
                model=DEFAULT_MODEL,
                lexical_weight=0.3,
                candidates=40,
            )
        )
    )
    out = reranker.rerank(
        "payment checkout failure",
        [
            chunk("a", "retail terminal outage", 1),
            chunk("b", "payment checkout failures on the app", 2),
        ],
    )
    assert out[0].chunk_id == "b" and out[0].rank == 1
