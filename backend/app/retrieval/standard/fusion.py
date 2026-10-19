"""Reciprocal rank fusion for hybrid (dense + sparse) retrieval."""

from __future__ import annotations

# Standard RRF constant from Cormack et al. (2009); damps the weight of top ranks.
RRF_K = 60


def reciprocal_rank_fusion(rankings: list[list[str]], k: int = RRF_K) -> list[tuple[str, float]]:
    """Fuse ranked id lists; score is the sum of 1 / (k + rank), rank 1-based.

    Returns every id seen in any ranking, sorted by score descending then id.
    """
    scores: dict[str, float] = {}
    for ranking in rankings:
        for rank, item_id in enumerate(ranking, start=1):
            scores[item_id] = scores.get(item_id, 0.0) + 1.0 / (k + rank)
    return sorted(scores.items(), key=lambda pair: (-pair[1], pair[0]))
