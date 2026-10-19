"""Bounded graph traversal (docs/02 section 11; AGENTS.md Neo4j Rules).

Traversal is a breadth-first walk with hard caps: depth, per-hop fan-out and
total nodes. Every traversed edge is returned so the pipeline can emit one
telemetry event each; parent links are kept so evidence paths can be
replayed and drawn.

The `NeighbourProvider` seam keeps the walk fully testable without Neo4j:
the Neo4j adapter runs one parameterised Cypher statement per hop (from
app.graph.statements), while tests use a static adjacency map.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Protocol

from app.config import GraphRagSettings

# Transparent relationship strengths, shared by traversal priority and
# evidence ranking. Document edges and incident-specific links outrank
# generic same-market or transactional associations; the ontology
# association (MAPS_TO) is the concept layer's evidence path (pipeline C)
# and sits at the generic-association level.
RELATIONSHIP_WEIGHTS: dict[str, float] = {
    "SEED": 1.0,
    "REFERENCES": 1.0,
    "HAS_CHUNK": 1.0,
    "RELATED_TO_VERSION": 0.9,
    "RELATED_TO_APP_VERSION": 0.9,
    "AFFECTS": 0.8,
    "USES_PAYMENT": 0.8,
    "PROVIDED_BY": 0.8,
    "CONCERNS": 0.7,
    "OF_TYPE": 0.7,
    "AFFECTS_MARKET": 0.6,
    "CATEGORISED_AS": 0.6,
    "HAS_MECHANIC": 0.6,
    "RUNS_ON": 0.6,
    "VERSION_OF": 0.6,
    "RELATED_TO": 0.5,
    "FROM_MARKET": 0.5,
    "INSTANCE_OF": 0.5,
    "MAPS_TO": 0.5,
    "BELONGS_TO": 0.4,
    "SIMILAR_TO": 0.4,
    "IS_A": 0.4,
    "AVAILABLE_IN": 0.4,
    "TARGETS": 0.4,
    "USES": 0.3,
}
DEFAULT_RELATIONSHIP_WEIGHT = 0.3


@dataclass(frozen=True, slots=True)
class NeighbourEdge:
    from_id: str
    rel_type: str
    to_id: str
    to_label: str


@dataclass(frozen=True, slots=True)
class TraversalResult:
    """Everything the walk touched, in discovery order."""

    node_ids: list[str] = field(default_factory=list)
    edges: list[NeighbourEdge] = field(default_factory=list)
    hops: dict[str, int] = field(default_factory=dict)  # node_id -> hop distance
    parents: dict[str, str] = field(default_factory=dict)  # node_id -> via node
    relationships: dict[str, str] = field(default_factory=dict)  # to_id -> rel_type
    # node_id -> minimum relationship weight along the discovered path
    # (bottleneck): evidence is as strong as its weakest link.
    path_strengths: dict[str, float] = field(default_factory=dict)
    depth_reached: int = 0

    def path_to(self, node_id: str) -> list[str]:
        """Seed-to-node path through parent links (for replay and drawing)."""
        path = [node_id]
        current = node_id
        while current in self.parents:
            current = self.parents[current]
            path.append(current)
        path.reverse()
        return path


class NeighbourProvider(Protocol):
    def neighbours(
        self,
        ids: list[str],
        rel_types: tuple[str, ...],
        per_type: int,
    ) -> list[NeighbourEdge]:
        """Edges from the given ids after per-type caps.

        Hop-level and total caps are applied by ``bounded_traversal``,
        which orders edges by relationship strength so a cut is never
        alphabetical.
        """
        ...

    def concept_bound(self, concept_id: str, limit: int) -> list[tuple[str, str]]:
        """Entities bound to one BusinessConcept via MAPS_TO (id, label)."""
        ...


class StaticNeighbourProvider:
    """Adjacency-map provider for tests and offline runs.

    Edges are indexed in both directions, matching the undirected
    ``(a)-[r]-(b)`` match the Neo4j adapter performs.
    """

    def __init__(self, adjacency: dict[str, list[NeighbourEdge]]) -> None:
        self._adjacency: dict[str, list[NeighbourEdge]] = {}
        for node_id, edges in adjacency.items():
            for edge in edges:
                self._adjacency.setdefault(node_id, []).append(edge)
                self._adjacency.setdefault(edge.to_id, []).append(
                    NeighbourEdge(
                        from_id=edge.to_id,
                        rel_type=edge.rel_type,
                        to_id=edge.from_id,
                        to_label=_label_of(adjacency, edge.from_id),
                    )
                )

    def neighbours(
        self,
        ids: list[str],
        rel_types: tuple[str, ...],
        per_type: int,
    ) -> list[NeighbourEdge]:
        edges: list[NeighbourEdge] = []
        for node_id in ids:
            taken_per_type: dict[str, int] = {}
            for edge in sorted(
                self._adjacency.get(node_id, []),
                key=lambda edge: (edge.rel_type, edge.to_id),
            ):
                if edge.rel_type not in rel_types:
                    continue
                if taken_per_type.get(edge.rel_type, 0) >= per_type:
                    continue
                taken_per_type[edge.rel_type] = taken_per_type.get(edge.rel_type, 0) + 1
                edges.append(edge)
        return edges

    def concept_bound(self, concept_id: str, limit: int) -> list[tuple[str, str]]:
        bound = [
            (edge.to_id, edge.to_label)
            for edge in self._adjacency.get(concept_id, [])
            if edge.rel_type == "MAPS_TO"
        ]
        return bound[:limit]


def _label_of(adjacency: dict[str, list[NeighbourEdge]], node_id: str) -> str:
    """Label recorded for a node on any edge that points at it."""
    for edges in adjacency.values():
        for edge in edges:
            if edge.to_id == node_id:
                return edge.to_label
    return ""


def bounded_traversal(
    provider: NeighbourProvider,
    seeds: list[str],
    settings: GraphRagSettings,
) -> TraversalResult:
    """Breadth-first traversal with hard caps; deterministic order.

    Each frontier node contributes at most ``max_edges_per_node_type``
    edges per relationship type (document edges uncapped: they are the
    retrieval targets with naturally small degree). When candidate edges
    exceed the hop-level node budget, they are explored in relationship
    strength order (same transparent table as evidence ranking), so a cut
    is never alphabetical and never silently favours id formats.
    """
    node_ids: list[str] = []
    edges: list[NeighbourEdge] = []
    hops: dict[str, int] = {}
    parents: dict[str, str] = {}
    relationships: dict[str, str] = {}
    strengths: dict[str, float] = {}
    for seed in dict.fromkeys(seeds):
        node_ids.append(seed)
        hops[seed] = 0
        strengths[seed] = 1.0

    frontier = list(dict.fromkeys(seeds))
    total = len(frontier)
    depth_reached = 0

    for depth in range(1, settings.max_depth + 1):
        if not frontier or total >= settings.max_total_nodes:
            break
        remaining_total = settings.max_total_nodes - total
        hop_budget = min(settings.max_nodes_per_hop, remaining_total)
        found = provider.neighbours(
            frontier,
            settings.relationship_types,
            settings.max_edges_per_node_type,
        )
        ordered = sorted(
            found,
            key=lambda edge: (
                -RELATIONSHIP_WEIGHTS.get(edge.rel_type, DEFAULT_RELATIONSHIP_WEIGHT),
                edge.to_id,
                edge.from_id,
            ),
        )

        next_frontier: list[str] = []
        taken = 0
        for edge in ordered:
            if edge.to_id in hops:
                continue
            node_ids.append(edge.to_id)
            edges.append(edge)
            hops[edge.to_id] = depth
            parents[edge.to_id] = edge.from_id
            relationships[edge.to_id] = edge.rel_type
            strengths[edge.to_id] = min(
                strengths.get(edge.from_id, 1.0),
                RELATIONSHIP_WEIGHTS.get(edge.rel_type, DEFAULT_RELATIONSHIP_WEIGHT),
            )
            next_frontier.append(edge.to_id)
            total += 1
            taken += 1
            if taken >= hop_budget or total >= settings.max_total_nodes:
                break

        depth_reached = depth
        frontier = next_frontier

    return TraversalResult(
        node_ids=node_ids,
        edges=edges,
        hops=hops,
        parents=parents,
        relationships=relationships,
        path_strengths=strengths,
        depth_reached=depth_reached,
    )


def expand_ontology(
    provider: NeighbourProvider,
    traversal: TraversalResult,
    settings: GraphRagSettings,
    concept_ids: list[str],
) -> tuple[TraversalResult, dict[str, int], list[NeighbourEdge]]:
    """First-class ontology expansion (pipeline C only).

    For each reached BusinessConcept, add its MAPS_TO-bound entities as
    traversal nodes one hop behind the concept, subject to the same total
    node cap. Returns the updated traversal, per-concept counts of newly
    injected entities (for telemetry), and the injected edges.
    """
    expansion_counts: dict[str, int] = {}
    new_edges: list[NeighbourEdge] = []
    node_ids = list(traversal.node_ids)
    edges = list(traversal.edges)
    hops = dict(traversal.hops)
    parents = dict(traversal.parents)
    relationships = dict(traversal.relationships)
    strengths = dict(traversal.path_strengths)

    for concept_id in concept_ids:
        if concept_id not in hops:
            continue
        limit = max(settings.max_total_nodes - len(node_ids), 0)
        if limit == 0:
            break
        bound = provider.concept_bound(concept_id, settings.max_nodes_per_hop)
        added = 0
        for entity_id, entity_label in bound:
            if entity_id in hops or added >= limit:
                continue
            edge = NeighbourEdge(
                from_id=concept_id, rel_type="MAPS_TO", to_id=entity_id, to_label=entity_label
            )
            node_ids.append(entity_id)
            edges.append(edge)
            new_edges.append(edge)
            hops[entity_id] = hops[concept_id] + 1
            parents[entity_id] = concept_id
            relationships[entity_id] = "MAPS_TO"
            strengths[entity_id] = min(
                strengths.get(concept_id, 1.0),
                RELATIONSHIP_WEIGHTS.get("MAPS_TO", DEFAULT_RELATIONSHIP_WEIGHT),
            )
            added += 1
        if added:
            expansion_counts[concept_id] = added

    return (
        TraversalResult(
            node_ids=node_ids,
            edges=edges,
            hops=hops,
            parents=parents,
            relationships=relationships,
            path_strengths=strengths,
            depth_reached=max(
                [traversal.depth_reached, *[hops[node] for node in node_ids]], default=0
            ),
        ),
        expansion_counts,
        new_edges,
    )


def load_static_provider_from_rows(
    rows: list[tuple[str, str, str, str]],
) -> StaticNeighbourProvider:
    """Build a static provider from (from_id, rel_type, to_id, to_label) rows."""
    adjacency: dict[str, list[NeighbourEdge]] = {}
    for from_id, rel_type, to_id, to_label in rows:
        adjacency.setdefault(from_id, []).append(
            NeighbourEdge(from_id=from_id, rel_type=rel_type, to_id=to_id, to_label=to_label)
        )
    return StaticNeighbourProvider(adjacency)


def clock_ms() -> float:
    """Indirection for tests that want deterministic timings."""
    import time

    return time.monotonic() * 1000.0


TraversalEmit = Callable[[str, dict[str, object]], None]
