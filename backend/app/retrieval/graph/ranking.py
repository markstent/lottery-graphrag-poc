"""Transparent graph evidence ranking (docs/reference/retrieval/evidence-ranking.md).

Score components (all normalised, all recorded per candidate):

- graph_distance:    1 / (1 + hops / 2) from the nearest seed; gentle decay
                     because bounded depth caps the walk at 2 hops
- relationship_type: bottleneck relationship weight along the discovered
                     path (evidence is as strong as its weakest link),
                     using the fixed transparent weight table
- semantic_relevance: cosine between the question and the node text using
  the shared embedding model (same model as pipeline A)
- temporal_validity: 1.0 when the record has no end date or its window ends
                     on or after the reference date; 0.3 when superseded

No hand-tuned rule exists to favour graph results: weights are configured,
visible in every event payload, and shared by both graph pipelines.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from app.config import RankingWeights
from app.retrieval.graph.source_lookup import NODE_SOURCES
from app.retrieval.graph.traversal import (
    DEFAULT_RELATIONSHIP_WEIGHT,
    RELATIONSHIP_WEIGHTS,
    TraversalResult,
)
from app.retrieval.standard.embeddings import EmbeddingFunction

# Node labels that carry authoritative structured facts (every label with a
# source table in NODE_SOURCES). Documents are
# deliberately absent: they are retrieved from the shared vector layer,
# whose chunk payloads already carry their metadata and validity window.
STRUCTURED_LABELS = frozenset(NODE_SOURCES)

# Temporal component of a record whose validity window has ended.
SUPERSEDED_VALIDITY = 0.3


@dataclass(frozen=True, slots=True)
class ScoredNode:
    node_id: str
    node_label: str
    hops: int
    path: list[str]
    rel_type: str
    score: float
    components: dict[str, float]


def score_nodes(
    traversal: TraversalResult,
    labels: dict[str, str],
    semantic: dict[str, float],
    weights: RankingWeights,
    validity: dict[str, date | None],
    reference: date,
) -> list[ScoredNode]:
    """Rank traversal nodes (seeds included at distance 0).

    Distance decays gently (1 / (1 + hops / 2)): traversal depth is capped
    at 2, so a 2-hop causally-connected record must not be buried under
    1-hop contextual fan-out. The relationship component is the bottleneck
    strength of the whole discovered path (evidence is as strong as its
    weakest link), not just the final edge.
    """
    scored: list[ScoredNode] = []
    for node_id in traversal.node_ids:
        hops = traversal.hops.get(node_id, 0)
        rel_type = traversal.relationships.get(node_id, "SEED")
        node_label = labels.get(node_id, "")
        distance_component = 1.0 / (1.0 + hops / 2.0)
        relationship_component = traversal.path_strengths.get(
            node_id, RELATIONSHIP_WEIGHTS.get(rel_type, DEFAULT_RELATIONSHIP_WEIGHT)
        )
        semantic_component = semantic.get(node_id, 0.0)
        temporal_component = temporal_validity(validity.get(node_id), reference)
        score = (
            weights.graph_distance * distance_component
            + weights.relationship_type * relationship_component
            + weights.semantic_relevance * semantic_component
            + weights.temporal_validity * temporal_component
        )
        scored.append(
            ScoredNode(
                node_id=node_id,
                node_label=node_label,
                hops=hops,
                path=traversal.path_to(node_id),
                rel_type=rel_type,
                score=round(score, 6),
                components={
                    "graph_distance": round(distance_component, 6),
                    "relationship_type": round(relationship_component, 6),
                    "semantic_relevance": round(semantic_component, 6),
                    "temporal_validity": round(temporal_component, 6),
                },
            )
        )
    scored.sort(key=lambda node: (-node.score, node.node_id))
    return scored


def temporal_validity(valid_to: date | None, reference: date) -> float:
    """1.0 for a record with no end date or one ending on or after the
    reference date; 0.3 for a superseded record."""
    return 1.0 if valid_to is None or valid_to >= reference else SUPERSEDED_VALIDITY


def semantic_scores(
    question: str,
    node_texts: dict[str, str],
    embed: EmbeddingFunction,
) -> dict[str, float]:
    """Cosine similarity between question and node texts via the shared
    embedding model (pipeline A uses the same model: fairness).

    Computed as the plain dot product, which is the cosine only because
    every ``EmbeddingFunction`` returns unit vectors (its contract;
    ``OllamaEmbedder`` normalises, docs/reference/retrieval/embeddings.md).
    """
    if not node_texts:
        return {}
    ids = list(node_texts)
    vectors = embed.embed([question, *(node_texts[node_id] for node_id in ids)])
    query = vectors[0]
    scores: dict[str, float] = {}
    for node_id, vector in zip(ids, vectors[1:], strict=True):
        cosine = sum(a * b for a, b in zip(query, vector, strict=True))  # unit vectors
        scores[node_id] = round(max(0.0, cosine), 6)
    return scores
