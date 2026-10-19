"""Reciprocal rank fusion for hybrid (dense + sparse) retrieval."""

from __future__ import annotations

# Matches Qdrant's server-side Fusion.RRF so the in-memory store and Qdrant
# rank identically. Qdrant 1.14.1 scores 1 / (position + 2) with a 0-based
# position (lib/segment/src/common/reciprocal_rank_fusion.rs, RFF_RANKING_K =
# 2.0), which is 1 / (rank + 1) with the 1-based rank used here. Verified
# against the running server: tests/test_vector_store_qdrant.py.
RRF_K = 1


def reciprocal_rank_fusion(rankings: list[list[str]], k: int = RRF_K) -> list[tuple[str, float]]:
    """Fuse ranked id lists; score is the sum of 1 / (k + rank), rank 1-based.

    Returns every id seen in any ranking, sorted by score descending then id.
    """
    scores: dict[str, float] = {}
    for ranking in rankings:
        for rank, item_id in enumerate(ranking, start=1):
            scores[item_id] = scores.get(item_id, 0.0) + 1.0 / (k + rank)
    return sorted(scores.items(), key=lambda pair: (-pair[1], pair[0]))
