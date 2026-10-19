"""Reciprocal rank fusion for hybrid (dense + sparse) retrieval."""

from __future__ import annotations

# The published RRF default (Cormack, Clarke and Buettcher, 2009). Every
# store fuses on the client with this function, so the in-memory store and
# Qdrant rank identically by construction.
RRF_K = 60


def reciprocal_rank_fusion(rankings: list[list[str]], k: int = RRF_K) -> list[tuple[str, float]]:
    """Fuse ranked id lists; score is the sum of 1 / (k + rank), rank 1-based.

    ``rankings[0]`` is the dense channel. Returns every id seen in any
    ranking, ordered by score descending, then dense rank ascending (ids
    absent from the dense channel last), then id ascending, so equal scores
    always fuse in the same order.
    """
    scores: dict[str, float] = {}
    for ranking in rankings:
        for rank, item_id in enumerate(ranking, start=1):
            scores[item_id] = scores.get(item_id, 0.0) + 1.0 / (k + rank)
    dense = rankings[0] if rankings else []
    dense_ranks = {item_id: rank for rank, item_id in enumerate(dense, start=1)}
    absent = len(dense) + 1
    return sorted(
        scores.items(),
        key=lambda pair: (-pair[1], dense_ranks.get(pair[0], absent), pair[0]),
    )
