"""The one judge of context selection (docs/retrieval/reranking.md).

One reranker instance scores every candidate of every pipeline against the
raw question: A's hybrid hits, and in B and C the same document channel
plus the structured graph candidates, in one call per question. The
cross-encoder is the development and benchmark judge. The lexical reranker
is the deterministic CI judge: transparent query-token coverage of the
candidate text, nothing else. Both are text-only and pointwise, so the same
text scores the same in every pipeline and channel, and neither has a rule
that favours one pipeline.
"""

from __future__ import annotations

import os
from collections.abc import Iterable
from pathlib import Path
from typing import Protocol

from app.config import RetrievalSettings
from app.evidence import EvidenceChunk
from app.retrieval.standard.embeddings import _tokenise


class RerankError(RuntimeError):
    """Raised when the cross-encoder fails to load or score."""


class Reranker(Protocol):
    """Re-ranks retrieval candidates; one instance is shared by A, B and C."""

    model_name: str

    def rerank(self, question: str, candidates: list[EvidenceChunk]) -> list[EvidenceChunk]: ...


class CrossEncoderScorer(Protocol):
    """The slice of fastembed's ``TextCrossEncoder`` this module uses."""

    def rerank(self, query: str, documents: list[str]) -> Iterable[float]: ...


class LexicalReranker:
    """Scores query-token coverage of the candidate text; deterministic.

    ``score = |query tokens in text| / |query tokens|``; ties break on
    ``chunk_id``. The incoming rank plays no part, so a graph node judged on
    a record's exact text scores exactly what the record would.
    """

    def __init__(self) -> None:
        self.model_name = "lexical-overlap"

    def rerank(self, question: str, candidates: list[EvidenceChunk]) -> list[EvidenceChunk]:
        """Return candidates re-sorted by overlap with rerank_score set."""
        query_tokens = set(_tokenise(question))
        scored: list[tuple[float, EvidenceChunk]] = []
        for candidate in candidates:
            chunk_tokens = set(_tokenise(candidate.text))
            score = len(query_tokens & chunk_tokens) / len(query_tokens) if query_tokens else 0.0
            updated = candidate.model_copy(update={"rerank_score": round(score, 6)})
            scored.append((score, updated))
        scored.sort(key=lambda entry: (-entry[0], entry[1].chunk_id))
        return [
            ranked.model_copy(update={"rank": position})
            for position, (_, ranked) in enumerate(scored, start=1)
        ]


class CrossEncoderReranker:
    """Scores (question, candidate text) pairs with a multilingual cross-encoder.

    Every candidate it is given is scored, in one call; callers cap their
    channels before judging. Ties break on ``chunk_id``.
    """

    def __init__(self, model: str, *, encoder: CrossEncoderScorer | None = None) -> None:
        self.model_name = model
        if encoder is None:
            from fastembed.rerank.cross_encoder import TextCrossEncoder

            cache_dir = Path(os.environ.get("FASTEMBED_CACHE", "~/.cache/fastembed")).expanduser()
            try:
                encoder = TextCrossEncoder(model_name=model, cache_dir=str(cache_dir))
            except Exception as error:  # fastembed raises varied download and runtime errors
                raise RerankError(f"Cross-encoder {model} failed to load: {error}") from error
        self._encoder = encoder

    def rerank(self, question: str, candidates: list[EvidenceChunk]) -> list[EvidenceChunk]:
        """Return the candidates by cross-encoder score with rerank_score and rank set."""
        if not candidates:
            return []
        try:
            scores = list(self._encoder.rerank(question, [chunk.text for chunk in candidates]))
        except Exception as error:
            raise RerankError(f"Cross-encoder scoring failed: {error}") from error
        scored = sorted(
            (
                (float(score), chunk.model_copy(update={"rerank_score": float(score)}))
                for score, chunk in zip(scores, candidates, strict=True)
            ),
            key=lambda entry: (-entry[0], entry[1].chunk_id),
        )
        return [
            chunk.model_copy(update={"rank": rank}) for rank, (_, chunk) in enumerate(scored, 1)
        ]


def build_reranker(settings: RetrievalSettings) -> Reranker:
    """Build the single reranker shared by every pipeline."""
    rerank = settings.rerank
    if rerank.provider == "lexical":
        return LexicalReranker()
    if rerank.provider == "cross_encoder":
        from fastembed.rerank.cross_encoder import TextCrossEncoder

        supported = {entry["model"] for entry in TextCrossEncoder.list_supported_models()}
        if rerank.model not in supported:
            multilingual = sorted(
                name for name in supported if "multilingual" in name or "m3" in name
            )
            raise ValueError(
                f"Unknown cross-encoder model {rerank.model!r}; supported multilingual "
                f"models: {', '.join(multilingual)}"
            )
        return CrossEncoderReranker(rerank.model)
    raise ValueError(f"Unknown rerank provider: {rerank.provider!r}")
