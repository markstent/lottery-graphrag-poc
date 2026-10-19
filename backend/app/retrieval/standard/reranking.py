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

from app.evidence import EvidenceChunk
from app.retrieval.standard.embeddings import _tokenise


class LexicalReranker:
    """Blends ``1 / incoming rank`` with lexical overlap; deterministic.

    ``score = (1 - w) * (1 / rank_in) + w * overlap``.
    """

    def __init__(self, lexical_weight: float = 0.3) -> None:
        if not 0.0 <= lexical_weight <= 1.0:
            raise ValueError(f"lexical_weight must be in [0, 1], got {lexical_weight}")
        self.lexical_weight = lexical_weight

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
