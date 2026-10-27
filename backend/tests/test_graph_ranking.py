"""Graph relevance order and evidence paths (method v0.3, proposal 4.1 and 4.3).

Every test runs on a fixed, hand-built traversal: no Neo4j, no model.
"""

from __future__ import annotations

import dataclasses
from typing import Any

import pytest
from app.config import (
    DEFAULT_RANKING_WEIGHTS,
    DEFAULT_REFERENCE_DATE,
    DEFAULT_RELATIONSHIP_TYPES,
    GraphConfig,
    GraphRagSettings,
)
from app.graph import statements
from app.graph.statements import RELATIONSHIP_ENDPOINTS, STATED_LINKS_LIMIT
from app.retrieval.graph.neo4j_adapter import GraphReader
from app.retrieval.graph.ranking import (
    ScoredNode,
    graph_relevance_order,
    holds_target,
)
from app.retrieval.graph.traversal import (
    NeighbourEdge,
    PathStep,
    StatedLinksError,
    StaticNeighbourProvider,
    TraversalResult,
    bounded_traversal,
    render_path,
    with_stated_links,
)


def node(node_id: str, label: str, hops: int, score: float) -> ScoredNode:
    return ScoredNode(
        node_id=node_id,
        node_label=label,
        hops=hops,
        path=[node_id],
        rel_type="SEED" if hops == 0 else "RELATED_TO",
        score=score,
        components={},
    )


def edge(from_id: str, rel_type: str, to_id: str, to_label: str) -> NeighbourEdge:
    return NeighbourEdge(from_id=from_id, rel_type=rel_type, to_id=to_id, to_label=to_label)


def ids(nodes: list[ScoredNode]) -> list[str]:
    return [n.node_id for n in nodes]


# A support case seed reaches two incidents; one incident states its market.
LABELS = {
    "SC_001": "SupportCase",
    "INC_001": "Incident",
    "INC_002": "Incident",
    "MKT_GR": "Market",
    "GAME_1": "Game",
}
EDGES = [
    edge("SC_001", "RELATED_TO", "INC_001", "Incident"),
    edge("SC_001", "RELATED_TO", "INC_002", "Incident"),
    edge("INC_001", "AFFECTS_MARKET", "MKT_GR", "Market"),
    edge("INC_002", "AFFECTS", "GAME_1", "Game"),
]


def test_seeds_first_then_target_holders_then_others() -> None:
    scored = [
        node("GAME_1", "Game", 2, 0.95),
        node("INC_002", "Incident", 1, 0.9),
        node("MKT_GR", "Market", 2, 0.5),
        node("INC_001", "Incident", 1, 0.4),
        node("SC_001", "SupportCase", 0, 0.3),
    ]
    ordered = graph_relevance_order(scored, LABELS, EDGES, frozenset({"Market"}))
    assert ids(ordered) == ["SC_001", "MKT_GR", "INC_001", "GAME_1", "INC_002"]
    assert [n.tier for n in ordered] == ["seed", "target", "target", "other", "other"]


def test_within_tier_composite_score_then_id() -> None:
    scored = [
        node("INC_B", "Incident", 1, 0.5),
        node("INC_A", "Incident", 1, 0.5),
        node("INC_C", "Incident", 1, 0.7),
        node("SC_2", "SupportCase", 0, 0.2),
        node("SC_1", "SupportCase", 0, 0.2),
    ]
    labels = {n.node_id: n.node_label for n in scored}
    ordered = graph_relevance_order(scored, labels, [], frozenset({"Incident"}))
    assert ids(ordered) == ["SC_1", "SC_2", "INC_C", "INC_A", "INC_B"]


def test_fallback_seed_counts_as_seed() -> None:
    # The vector-fallback seed (D-027) sits at hop 0 like a resolved seed,
    # and its low composite score does not move it below a target holder.
    scored = [
        node("INC_001", "Incident", 1, 0.99),
        node("INC_S007_GR", "Incident", 0, 0.01),
    ]
    labels = {"INC_001": "Incident", "INC_S007_GR": "Incident"}
    ordered = graph_relevance_order(scored, labels, [], frozenset({"Incident"}))
    assert ids(ordered) == ["INC_S007_GR", "INC_001"]
    assert ordered[0].tier == "seed"


def test_target_by_label_and_by_stated_relationship() -> None:
    market = frozenset({"Market"})
    # By label.
    assert holds_target("MKT_GR", LABELS, EDGES, market)
    # By its discovery edge: INC_001 was reached from SC_001, but the edge it
    # discovered (AFFECTS_MARKET to MKT_GR) is stated by its own record.
    assert holds_target("INC_001", LABELS, EDGES, market)
    # The Market node does not hold "Incident" through that same edge: the
    # schema states AFFECTS_MARKET from Incident to Market, not the reverse.
    assert not holds_target("MKT_GR", LABELS, EDGES, frozenset({"Incident"}))
    # A node with no stated link to a target does not hold it.
    assert not holds_target("INC_002", LABELS, EDGES, market)


def test_target_through_own_discovery_edge() -> None:
    # The Incident was discovered from the Market seed over AFFECTS_MARKET:
    # its own discovery edge states its market.
    labels = {"MKT_GR": "Market", "INC_001": "Incident"}
    edges = [edge("MKT_GR", "AFFECTS_MARKET", "INC_001", "Incident")]
    assert holds_target("INC_001", labels, edges, frozenset({"Market"}))
    assert not holds_target("MKT_GR", labels, edges, frozenset({"Incident"}))


def graph_settings(max_total_nodes: int = 200) -> GraphRagSettings:
    return GraphRagSettings(
        max_depth=2,
        max_nodes_per_hop=100,
        max_edges_per_node_type=4,
        max_total_nodes=max_total_nodes,
        relationship_types=DEFAULT_RELATIONSHIP_TYPES,
        ontology_expansion=False,
        ranking=DEFAULT_RANKING_WEIGHTS,
        reference_date=DEFAULT_REFERENCE_DATE,
    )


# The support case seed reaches its incident and its market in one hop each,
# so the walk records no edge between the incident and the market.
TRIANGLE_LABELS = {"SC_001": "SupportCase", "INC_001": "Incident", "MKT_GR": "Market"}


def triangle() -> StaticNeighbourProvider:
    return StaticNeighbourProvider(
        {
            "SC_001": [
                edge("SC_001", "RELATED_TO", "INC_001", "Incident"),
                edge("SC_001", "FROM_MARKET", "MKT_GR", "Market"),
            ],
            "INC_001": [edge("INC_001", "AFFECTS_MARKET", "MKT_GR", "Market")],
        },
        TRIANGLE_LABELS,
    )


def test_stated_link_to_a_target_reached_by_another_path_counts() -> None:
    walk = bounded_traversal(triangle(), ["SC_001"], graph_settings())
    assert walk.hops == {"SC_001": 0, "INC_001": 1, "MKT_GR": 1}
    market = frozenset({"Market"})
    assert not holds_target("INC_001", TRIANGLE_LABELS, walk.edges, market)

    linked = with_stated_links(triangle(), walk, graph_settings())
    # Nothing about the walk changes; only the stated links are added.
    assert dataclasses.replace(linked, stated_links=[]) == walk
    assert linked.stated_links == [
        edge("INC_001", "AFFECTS_MARKET", "MKT_GR", "Market"),
        edge("SC_001", "FROM_MARKET", "MKT_GR", "Market"),
        edge("SC_001", "RELATED_TO", "INC_001", "Incident"),
    ]
    assert holds_target("INC_001", TRIANGLE_LABELS, linked.stated_links, market)
    # The reverse direction still does not count.
    assert not holds_target("MKT_GR", TRIANGLE_LABELS, linked.stated_links, frozenset({"Incident"}))
    # The path line still shows how the node was reached.
    assert render_path(linked.steps_to("INC_001", TRIANGLE_LABELS)) == (
        "SC_001 -RELATED_TO-> INC_001"
    )


class RecordingProvider(StaticNeighbourProvider):
    def __init__(self, links: list[NeighbourEdge] | None = None) -> None:
        super().__init__({})
        self.calls: list[tuple[list[str], tuple[str, ...], int]] = []
        self.links = links or []

    def stated_links(
        self, ids: list[str], rel_types: tuple[str, ...], limit: int
    ) -> list[NeighbourEdge]:
        self.calls.append((ids, rel_types, limit))
        return self.links[:limit]


def test_empty_walk_issues_no_stated_links_query() -> None:
    provider = RecordingProvider()
    empty = TraversalResult()
    assert with_stated_links(provider, empty, graph_settings()) is empty
    assert provider.calls == []


def test_stated_links_query_reads_schema_types_only_with_its_bound() -> None:
    provider = RecordingProvider()
    with_stated_links(provider, L05, graph_settings())
    [(ids, rel_types, limit)] = provider.calls
    assert ids == L05.node_ids
    assert set(rel_types) == {rel for rel, _, _ in RELATIONSHIP_ENDPOINTS}
    assert limit == STATED_LINKS_LIMIT + 1


def test_stated_links_refuse_a_cut_result_and_too_many_nodes() -> None:
    many = [edge(f"A{i}", "AFFECTS", f"B{i}", "Game") for i in range(STATED_LINKS_LIMIT + 1)]
    with pytest.raises(StatedLinksError, match="would be cut"):
        with_stated_links(RecordingProvider(many), L05, graph_settings())
    with pytest.raises(StatedLinksError, match="total node limit"):
        with_stated_links(RecordingProvider(), L05, graph_settings(max_total_nodes=2))


def test_graph_reader_runs_the_central_stated_links_statement(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import neo4j

    captured: dict[str, Any] = {}
    row = {"from_id": "INC_001", "rel_type": "AFFECTS_MARKET", "to_id": "MKT_GR"}

    class FakeDriver:
        def execute_query(self, query: Any, params: Any, **kwargs: Any) -> Any:
            captured["text"] = query.text
            captured["params"] = params
            return type("Result", (), {"records": [{**row, "to_label": "Market"}]})()

    monkeypatch.setattr(
        neo4j.GraphDatabase, "driver", staticmethod(lambda uri, **kwargs: FakeDriver())
    )
    reader = GraphReader(GraphConfig("bolt://x", "u", "p", "d"))
    links = reader.stated_links(["INC_001", "MKT_GR"], ("AFFECTS_MARKET",), 7)
    assert links == [edge("INC_001", "AFFECTS_MARKET", "MKT_GR", "Market")]
    assert captured["text"] == statements.RETRIEVAL_STATED_LINKS
    assert captured["params"] == {
        "ids": ["INC_001", "MKT_GR"],
        "rel_types": ["AFFECTS_MARKET"],
        "limit": 7,
    }
    # Read-only, directed, bounded.
    text = statements.RETRIEVAL_STATED_LINKS
    assert "-[r]->" in text and "LIMIT $limit" in text
    assert not any(word in text for word in ("MERGE", "CREATE", "SET ", "DELETE"))


def test_empty_targets_give_seed_then_score_order() -> None:
    scored = [
        node("INC_002", "Incident", 1, 0.9),
        node("MKT_GR", "Market", 2, 0.5),
        node("INC_001", "Incident", 1, 0.9),
        node("SC_001", "SupportCase", 0, 0.3),
    ]
    ordered = graph_relevance_order(scored, LABELS, EDGES, frozenset())
    assert ids(ordered) == ["SC_001", "INC_001", "INC_002", "MKT_GR"]
    assert [n.tier for n in ordered] == ["seed", "other", "other", "other"]
    assert not holds_target("MKT_GR", LABELS, EDGES, frozenset())


def test_all_nodes_targets_give_seed_then_score_order() -> None:
    scored = [
        node("INC_002", "Incident", 1, 0.9),
        node("MKT_GR", "Market", 2, 0.5),
        node("GAME_1", "Game", 2, 0.6),
        node("INC_001", "Incident", 1, 0.9),
        node("SC_001", "SupportCase", 0, 0.3),
    ]
    targets = frozenset(LABELS.values())
    ordered = graph_relevance_order(scored, LABELS, EDGES, targets)
    assert ids(ordered) == ["SC_001", "INC_001", "INC_002", "GAME_1", "MKT_GR"]
    assert [n.tier for n in ordered] == ["seed", "target", "target", "target", "target"]


def test_order_returns_copies_and_keeps_scores() -> None:
    scored = [node("INC_001", "Incident", 1, 0.4), node("SC_001", "SupportCase", 0, 0.3)]
    ordered = graph_relevance_order(scored, LABELS, EDGES, frozenset({"Market"}))
    assert [n.tier for n in scored] == ["other", "other"]
    assert [(n.node_id, n.score) for n in ordered] == [("SC_001", 0.3), ("INC_001", 0.4)]


# The L05 shape (proposal 4.3): seed INC_037 reaches INC_024 through the
# platform version both incidents relate to.
L05_LABELS = {
    "INC_037": "Incident",
    "PLV_IDENTITY_2": "PlatformVersion",
    "INC_024": "Incident",
}
L05 = TraversalResult(
    node_ids=["INC_037", "PLV_IDENTITY_2", "INC_024"],
    edges=[
        edge("INC_037", "RELATED_TO_VERSION", "PLV_IDENTITY_2", "PlatformVersion"),
        edge("PLV_IDENTITY_2", "RELATED_TO_VERSION", "INC_024", "Incident"),
    ],
    hops={"INC_037": 0, "PLV_IDENTITY_2": 1, "INC_024": 2},
    parents={"PLV_IDENTITY_2": "INC_037", "INC_024": "PLV_IDENTITY_2"},
    relationships={"PLV_IDENTITY_2": "RELATED_TO_VERSION", "INC_024": "RELATED_TO_VERSION"},
    depth_reached=2,
)


def test_steps_and_render_path_with_direction() -> None:
    steps = L05.steps_to("INC_024", L05_LABELS)
    assert steps == [
        PathStep("INC_037", "RELATED_TO_VERSION", "PLV_IDENTITY_2", forward=True),
        PathStep("PLV_IDENTITY_2", "RELATED_TO_VERSION", "INC_024", forward=False),
    ]
    assert render_path(steps) == (
        "INC_037 -RELATED_TO_VERSION-> PLV_IDENTITY_2 <-RELATED_TO_VERSION- INC_024"
    )


def test_seed_has_no_steps() -> None:
    assert L05.steps_to("INC_037", L05_LABELS) == []
    assert render_path([]) == ""


def test_same_label_edge_renders_forward_as_walked() -> None:
    traversal = TraversalResult(
        node_ids=["GAME_2", "GAME_1"],
        edges=[edge("GAME_2", "SIMILAR_TO", "GAME_1", "Game")],
        hops={"GAME_2": 0, "GAME_1": 1},
        parents={"GAME_1": "GAME_2"},
        relationships={"GAME_1": "SIMILAR_TO"},
        depth_reached=1,
    )
    steps = traversal.steps_to("GAME_1", {"GAME_1": "Game", "GAME_2": "Game"})
    assert render_path(steps) == "GAME_2 -SIMILAR_TO-> GAME_1"
    # A node with no known label states nothing either way: drawn as walked.
    assert render_path(traversal.steps_to("GAME_1", {})) == "GAME_2 -SIMILAR_TO-> GAME_1"
