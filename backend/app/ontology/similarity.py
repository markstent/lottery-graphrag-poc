"""Concept-based cross-market game similarity."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

METHOD = "ontology_similarity_v2"
FAMILY_WEIGHT = 0.4
CATEGORY_WEIGHT = 0.2
MECHANIC_WEIGHT = 0.4
SCORE_PLACES = 3


@dataclass(frozen=True, slots=True)
class GameConcepts:
    """A game expressed purely in ontology concepts."""

    game_id: str
    market_id: str
    family_concept: str
    category_concept: str
    mechanic_concepts: frozenset[str]


@dataclass(frozen=True, slots=True)
class SimilarEdge:
    """A directed similarity link from one game to an equivalent game in another market."""

    a_id: str
    b_id: str
    score: float
    method: str = METHOD


def concept_similarity(a: GameConcepts, b: GameConcepts) -> float:
    """Family match 0.4, category match 0.2, plus 0.4 times the Jaccard index of mechanics."""
    score = 0.0
    if a.family_concept == b.family_concept:
        score += FAMILY_WEIGHT
    if a.category_concept == b.category_concept:
        score += CATEGORY_WEIGHT
    union = a.mechanic_concepts | b.mechanic_concepts
    if union:
        score += MECHANIC_WEIGHT * len(a.mechanic_concepts & b.mechanic_concepts) / len(union)
    return round(score, SCORE_PLACES)


def cross_market_similar(games: Sequence[GameConcepts], top_k: int = 3) -> list[SimilarEdge]:
    """For each game, its `top_k` most similar games in other markets, ordered by (a, -score, b)."""
    edges: list[SimilarEdge] = []
    for a in games:
        candidates = [
            SimilarEdge(a.game_id, b.game_id, score)
            for b in games
            if b.market_id != a.market_id and (score := concept_similarity(a, b)) > 0
        ]
        candidates.sort(key=lambda e: (-e.score, e.b_id))
        edges.extend(candidates[:top_k])
    return sorted(edges, key=lambda e: (e.a_id, -e.score, e.b_id))
