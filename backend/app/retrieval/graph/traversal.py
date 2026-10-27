"""Bounded graph traversal (docs/reference/02 section 11; AGENTS.md Neo4j Rules).

Traversal is a breadth-first walk with hard caps: depth, per-hop fan-out and
total nodes. Every traversed edge is returned so the pipeline can emit one
telemetry event each; parent links are kept so evidence paths can be
replayed and drawn.

The `NeighbourProvider` seam keeps the walk fully testable without Neo4j:
the Neo4j adapter runs one parameterised Cypher statement per hop (from
app.graph.statements), while tests use a static adjacency map.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field, replace
from itertools import pairwise
from typing import Protocol

from app.config import GraphRagSettings
from app.graph.statements import RELATIONSHIP_ENDPOINTS, STATED_LINKS_LIMIT

# (relationship type, source label, target label) as the graph schema states
# them: the source node's own record states the link.
STATED_ENDPOINTS: frozenset[tuple[str, str, str]] = frozenset(RELATIONSHIP_ENDPOINTS)
STATED_REL_TYPES: tuple[str, ...] = tuple(sorted({rel for rel, _, _ in RELATIONSHIP_ENDPOINTS}))

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
    # Every schema-stated relationship between two reached nodes, in its
    # stored direction (``with_stated_links``); empty until fetched. The
    # walk's ``edges`` are only its discovery edges (a spanning tree).
    stated_links: list[NeighbourEdge] = field(default_factory=list)

    def path_to(self, node_id: str) -> list[str]:
        """Seed-to-node path through parent links (for replay and drawing)."""
        path = [node_id]
        current = node_id
        while current in self.parents:
            current = self.parents[current]
            path.append(current)
        path.reverse()
        return path

    def steps_to(self, node_id: str, labels: Mapping[str, str]) -> list[PathStep]:
        """Seed-to-node discovery path as directed steps (empty for a seed).

        Each step is written in walk order; ``forward`` says whether the
        schema states the relationship in that direction. A step is shown
        against the walk only when the schema states the reverse and not
        the walked direction, so an edge between two nodes of one label
        (``SIMILAR_TO``, ``IS_A``) reads forward as walked.
        """
        path = self.path_to(node_id)
        steps: list[PathStep] = []
        for from_id, to_id in pairwise(path):
            rel_type = self.relationships[to_id]
            from_label = labels.get(from_id, "")
            to_label = labels.get(to_id, "")
            forward = (rel_type, from_label, to_label) in STATED_ENDPOINTS or (
                rel_type,
                to_label,
                from_label,
            ) not in STATED_ENDPOINTS
            steps.append(PathStep(from_id, rel_type, to_id, forward=forward))
        return steps


@dataclass(frozen=True, slots=True)
class PathStep:
    """One walked edge of an evidence path, in walk order."""

    from_id: str
    rel_type: str
    to_id: str
    # False only when the schema states rel_type from to_id's label to
    # from_id's and not the walked way: the link is drawn against the walk.
    forward: bool


def render_path(steps: Sequence[PathStep]) -> str:
    """One-line evidence path, for example
    ``INC_037 -RELATED_TO_VERSION-> PLV_IDENTITY_2 <-RELATED_TO_VERSION- INC_024``.
    Empty for a seed (no steps)."""
    if not steps:
        return ""
    parts = [steps[0].from_id]
    for step in steps:
        arrow = f"-{step.rel_type}->" if step.forward else f"<-{step.rel_type}-"
        parts.append(f"{arrow} {step.to_id}")
    return " ".join(parts)


class NeighbourProvider(Protocol):
    def neighbours(
        self,
        ids: list[str],
        rel_types: tuple[str, ...],
        per_type: int,
        excluded_labels: tuple[str, ...],
    ) -> list[NeighbourEdge]:
        """Edges from the given ids after per-type caps.

        Targets with an excluded label are dropped before the per-type cap,
        so they never take a permitted neighbour's place. Hop-level and
        total caps are applied by ``bounded_traversal``, which orders edges
        by relationship strength so a cut is never alphabetical.
        """
        ...

    def concept_bound(
        self, concept_id: str, limit: int, excluded_labels: tuple[str, ...]
    ) -> list[tuple[str, str]]:
        """Entities bound to one BusinessConcept via MAPS_TO (id, label),
        excluded labels dropped before the limit."""
        ...

    def stated_links(
        self, ids: list[str], rel_types: tuple[str, ...], limit: int
    ) -> list[NeighbourEdge]:
        """Relationships of the given types whose two ends are both in
        ``ids``, in stored direction, ordered by (from, type, to), at most
        ``limit`` rows. Reads relationships only: never adds a node."""
        ...


class StaticNeighbourProvider:
    """Adjacency-map provider for tests and offline runs.

    Edges are indexed in both directions, matching the undirected
    ``(a)-[r]-(b)`` match the Neo4j adapter performs. A reverse edge's
    target label is the node's entry in ``labels`` when given, else the
    label on the first edge that points at the node ("" when none does).
    """

    def __init__(
        self,
        adjacency: dict[str, list[NeighbourEdge]],
        labels: Mapping[str, str] | None = None,
    ) -> None:
        known: dict[str, str] = dict(labels or {})
        for edges in adjacency.values():
            for edge in edges:
                known.setdefault(edge.to_id, edge.to_label)
        self._stored = [edge for edges in adjacency.values() for edge in edges]
        self._adjacency: dict[str, list[NeighbourEdge]] = {}
        for node_id, edges in adjacency.items():
            for edge in edges:
                self._adjacency.setdefault(node_id, []).append(edge)
                self._adjacency.setdefault(edge.to_id, []).append(
                    NeighbourEdge(
                        from_id=edge.to_id,
                        rel_type=edge.rel_type,
                        to_id=edge.from_id,
                        to_label=known.get(edge.from_id, ""),
                    )
                )

    def neighbours(
        self,
        ids: list[str],
        rel_types: tuple[str, ...],
        per_type: int,
        excluded_labels: tuple[str, ...],
    ) -> list[NeighbourEdge]:
        edges: list[NeighbourEdge] = []
        for node_id in ids:
            taken_per_type: dict[str, int] = {}
            for edge in sorted(
                self._adjacency.get(node_id, []),
                key=lambda edge: (edge.rel_type, edge.to_id),
            ):
                if edge.rel_type not in rel_types or edge.to_label in excluded_labels:
                    continue
                if taken_per_type.get(edge.rel_type, 0) >= per_type:
                    continue
                taken_per_type[edge.rel_type] = taken_per_type.get(edge.rel_type, 0) + 1
                edges.append(edge)
        return edges

    def concept_bound(
        self, concept_id: str, limit: int, excluded_labels: tuple[str, ...]
    ) -> list[tuple[str, str]]:
        bound = [
            (edge.to_id, edge.to_label)
            for edge in self._adjacency.get(concept_id, [])
            if edge.rel_type == "MAPS_TO" and edge.to_label not in excluded_labels
        ]
        return bound[:limit]

    def stated_links(
        self, ids: list[str], rel_types: tuple[str, ...], limit: int
    ) -> list[NeighbourEdge]:
        among = set(ids)
        links = [
            edge
            for edge in self._stored
            if edge.rel_type in rel_types and edge.from_id in among and edge.to_id in among
        ]
        links.sort(key=lambda edge: (edge.from_id, edge.rel_type, edge.to_id))
        return links[:limit]


def bounded_traversal(
    provider: NeighbourProvider,
    seeds: list[str],
    settings: GraphRagSettings,
) -> TraversalResult:
    """Breadth-first traversal with hard caps; deterministic order.

    Each frontier node contributes at most ``max_edges_per_node_type``
    edges per relationship type. Edges whose target label is in
    ``excluded_labels`` are neither followed nor recorded: the provider
    drops them before its per-type cap. When candidate edges
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
            settings.excluded_labels,
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


class StatedLinksError(RuntimeError):
    """The stated-links read was refused: too many nodes, or a cut result."""


def with_stated_links(
    provider: NeighbourProvider,
    traversal: TraversalResult,
    settings: GraphRagSettings,
) -> TraversalResult:
    """The traversal with every schema-stated link among its reached nodes.

    Run after the walk (and after ontology expansion in pipeline C). It reads
    relationships whose types are in the schema's RELATIONSHIP_ENDPOINTS and
    whose two ends were both reached, so it adds no node and leaves the walk,
    its paths and its limits untouched. Bound: the ids are at most
    ``settings.max_total_nodes``; the rows at most ``STATED_LINKS_LIMIT``,
    and a result over that limit is refused rather than silently cut. With
    no reached node no query is issued.
    """
    if not traversal.node_ids:
        return traversal
    if len(traversal.node_ids) > settings.max_total_nodes:
        raise StatedLinksError(
            f"{len(traversal.node_ids)} reached nodes exceed the total node limit "
            f"{settings.max_total_nodes}"
        )
    links = provider.stated_links(
        list(traversal.node_ids), STATED_REL_TYPES, STATED_LINKS_LIMIT + 1
    )
    if len(links) > STATED_LINKS_LIMIT:
        raise StatedLinksError(
            f"more than {STATED_LINKS_LIMIT} stated links among {len(traversal.node_ids)} "
            "reached nodes; the result would be cut"
        )
    return replace(traversal, stated_links=links)


BoundRelevance = Callable[[list[tuple[str, str]]], list[float]]
"""Semantic relevance of bound (entity id, label) candidates to the question, in order."""


def expand_ontology(
    provider: NeighbourProvider,
    traversal: TraversalResult,
    settings: GraphRagSettings,
    concept_ids: list[str],
    semantic: BoundRelevance,
) -> tuple[TraversalResult, dict[str, int], list[NeighbourEdge]]:
    """First-class ontology expansion (pipeline C only).

    For each reached BusinessConcept, add its most relevant MAPS_TO-bound
    entities as traversal nodes one hop behind the concept: at most
    ``max_edges_per_node_type`` per concept, ordered by ``semantic``
    relevance to the (expanded) question, ties by id, subject to the same
    total node cap. Entities already reached are not candidates.
    Entities with an excluded label are not candidates either. Returns
    the updated traversal, per-concept counts of newly injected entities
    (for telemetry), and the injected edges.
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
        limit = min(
            settings.max_edges_per_node_type, max(settings.max_total_nodes - len(node_ids), 0)
        )
        if limit == 0:
            break
        candidates = [
            (entity_id, entity_label)
            for entity_id, entity_label in provider.concept_bound(
                concept_id, settings.max_nodes_per_hop, settings.excluded_labels
            )
            if entity_id not in hops
        ]
        if not candidates:
            continue
        scores = semantic(candidates)
        ranked = sorted(
            zip(candidates, scores, strict=True), key=lambda pair: (-pair[1], pair[0][0])
        )
        for (entity_id, entity_label), _score in ranked[:limit]:
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
        expansion_counts[concept_id] = min(limit, len(ranked))

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


TraversalEmit = Callable[[str, dict[str, object]], None]
