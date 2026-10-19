"""Optional reranking (docs/retrieval/reranking.md).

The default reranker blends the candidate's incoming retrieval rank with
transparent lexical overlap (query-token coverage). It blends on rank, not on
the raw retrieval score: since hybrid retrieval that score is a fused
reciprocal-rank score whose scale depends on how many channels returned the
chunk, so it is not comparable with overlap. It is deliberately simple and
inspectable: no hidden hand-tuned rule that favours one pipeline. If reranking is enabled
for the baseline, the graph pipeline gets an equivalent candidate-ranking
opportunity (Phase 9).
"""

from __future__ import annotations

import os
from collections.abc import Iterable
from pathlib import Path
from typing import Protocol

from app.config import RetrievalSettings
from app.evidence import EvidenceChunk
from app.retrieval.standard.embeddings import _tokenise


class Reranker(Protocol):
    """Re-ranks retrieval candidates; one instance is shared by A, B and C."""

    model_name: str

    def rerank(self, question: str, candidates: list[EvidenceChunk]) -> list[EvidenceChunk]: ...


class CrossEncoderScorer(Protocol):
    """The slice of fastembed's ``TextCrossEncoder`` this module uses."""

    def rerank(self, query: str, documents: list[str]) -> Iterable[float]: ...


class LexicalReranker:
    """Blends ``1 / incoming rank`` with lexical overlap; deterministic.

    ``score = (1 - w) * (1 / rank_in) + w * overlap``.
    """

    def __init__(self, lexical_weight: float = 0.3) -> None:
        if not 0.0 <= lexical_weight <= 1.0:
            raise ValueError(f"lexical_weight must be in [0, 1], got {lexical_weight}")
        self.lexical_weight = lexical_weight
        self.model_name = f"lexical(w={lexical_weight})"

    def rerank(self, question: str, candidates: list[EvidenceChunk]) -> list[EvidenceChunk]:
        """Return candidates re-sorted by blended score with rerank_score set."""
        query_tokens = set(_tokenise(question))
        scored: list[tuple[float, EvidenceChunk]] = []
        for candidate in candidates:
            chunk_tokens = set(_tokenise(candidate.text))
            overlap = len(query_tokens & chunk_tokens) / len(query_tokens) if query_tokens else 0.0
            score = (1.0 - self.lexical_weight) / candidate.rank + self.lexical_weight * overlap
            updated = candidate.model_copy(update={"rerank_score": round(score, 6)})
            scored.append((score, updated))
        scored.sort(key=lambda entry: (-entry[0], entry[1].chunk_id))
        return [
            ranked.model_copy(update={"rank": position})
            for position, (_, ranked) in enumerate(scored, start=1)
        ]


class CrossEncoderReranker:
    """Scores (question, chunk text) pairs with a multilingual cross-encoder.

    Only the top ``candidates`` incoming candidates are scored, in one call;
    the rest keep their incoming order after them with no ``rerank_score``,
    so telemetry still lists every candidate. Ties break on ``chunk_id``.
    """

    def __init__(
        self, model: str, *, candidates: int = 40, encoder: CrossEncoderScorer | None = None
    ) -> None:
        if candidates < 1:
            raise ValueError(f"candidates must be >= 1, got {candidates}")
        self.model_name = model
        self.candidates = candidates
        if encoder is None:
            from fastembed.rerank.cross_encoder import TextCrossEncoder

            cache_dir = Path(os.environ.get("FASTEMBED_CACHE", "~/.cache/fastembed")).expanduser()
            encoder = TextCrossEncoder(model_name=model, cache_dir=str(cache_dir))
        self._encoder = encoder

    def rerank(self, question: str, candidates: list[EvidenceChunk]) -> list[EvidenceChunk]:
        """Return scored candidates by score then the unscored tail."""
        head, tail = candidates[: self.candidates], candidates[self.candidates :]
        if not head:
            return []
        scores = list(self._encoder.rerank(question, [chunk.text for chunk in head]))
        scored = sorted(
            (
                (float(score), chunk.model_copy(update={"rerank_score": float(score)}))
                for score, chunk in zip(scores, head, strict=True)
            ),
            key=lambda entry: (-entry[0], entry[1].chunk_id),
        )
        ordered = [chunk for _, chunk in scored] + tail
        return [chunk.model_copy(update={"rank": rank}) for rank, chunk in enumerate(ordered, 1)]


def build_reranker(settings: RetrievalSettings) -> Reranker:
    """Build the single reranker shared by every pipeline."""
    rerank = settings.rerank
    if rerank.provider == "lexical":
        return LexicalReranker(rerank.lexical_weight)
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
        return CrossEncoderReranker(rerank.model, candidates=rerank.candidates)
    raise ValueError(f"Unknown rerank provider: {rerank.provider!r}")
