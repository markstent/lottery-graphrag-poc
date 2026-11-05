"""Graph routes: schema, ingestion stats, nodes with provenance and bounded
neighbours, and which world the graph holds (Phase 4 Task 10).

The routes run on the tiny generated world under a temporary dataset root.
Graph reads go through a fake reader offline. The live test reads the
already-ingested dev-seed2026 graph, only with GRAPH_E2E=1 and LIVE_WORLD_E2E=1
(it fails, never skips, when the graph or its statistics are missing), and never
writes it.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any, ClassVar

import app.api.graph_model as graph_model
import pytest
from app.api.graph_world import WORLD_CHECK_TTL_S, GraphWorldCheck
from app.config import DEFAULT_DATASET_DIR, LABEL_VERSION, GraphConfig
from app.datasets.config import GenerationConfig
from app.datasets.parquet import write_world
from app.datasets.schema import TABLE_SCHEMAS
from app.datasets.world import build_world
from app.graph import statements
from app.graph.fingerprint import graph_world_matches
from app.graph.ingest import GRAPH_STATS_FILE
from app.graph.reader import load_dataset
from app.graph.relationship_rows import build_relationship_rows
from app.main import create_app
from app.ontology.loader import load_ontology
from fastapi.testclient import TestClient
from neo4j.exceptions import ServiceUnavailable
from neo4j.time import Date

from tests import live as gate

# Nothing listens on the discard port, so the driver fails fast.
UNREACHABLE_GRAPH = GraphConfig(
    uri="bolt://127.0.0.1:9", user="neo4j", password="unused", database="neo4j", timeout_s=1.0
)
TINY_NODES = {"Market": 4, "Player": 200, "PrizeType": 5}
TINY_STATS = {
    "ingestion_version": "ing-20261020T080000Z",
    "label_version": "v2",
    "ontology_version": "2.0.0",
    "nodes": TINY_NODES,
    "relationships": [
        {"type": "BELONGS_TO", "from": "Player", "to": "PlayerSegment", "count": 400},
        {"type": "BELONGS_TO", "from": "Game", "to": "GameFamily", "count": 20},
        {"type": "SIMILAR_TO", "from": "Game", "to": "Game", "count": 6},
    ],
}
SEED = "PLAYER_GR_000001"


def expected_node_total() -> int:
    return sum(TINY_NODES.values())


@pytest.fixture(scope="module")
def dataset_root(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """tiny (active, with graph statistics) and bare (no statistics)."""
    root = tmp_path_factory.mktemp("graph-datasets")
    world = build_world(GenerationConfig(profile="tiny", world_seed=42))
    for name in ("tiny", "bare"):
        write_world(root / name, TABLE_SCHEMAS, world.tables)
        (root / name / "_manifest.json").write_text(json.dumps(world.manifest))
    (root / "tiny" / GRAPH_STATS_FILE).write_text(json.dumps(TINY_STATS))
    return root


def _player(index: int) -> dict[str, Any]:
    return {"id": f"PLAYER_GR_{index:06d}", "source_record_id": f"PLAYER_GR_{index:06d}"}


class FakeGraph:
    """Stands in for the Neo4j reader: the seed player has 30 neighbours.

    ``counts`` is what the live graph holds per label; by default the tiny
    world's statistics, so the graph holds the active world.
    """

    counts: ClassVar[dict[str, int]] = dict(TINY_NODES)
    calls: ClassVar[list[tuple[Any, ...]]] = []
    nodes: ClassVar[dict[str, tuple[list[str], dict[str, Any]]]] = {
        SEED: (
            ["Player"],
            {
                **_player(1),
                "market_id": "MKT_GR",
                "registration_date": Date(2025, 3, 24),
                "source_table": "players",
            },
        ),
        "PTYPE_JACKPOT": (
            ["PrizeType"],
            {"id": "PTYPE_JACKPOT", "source_record_id": "PTYPE_JACKPOT"},
        ),
        "CONCEPT_DRAW_GAME": (["BusinessConcept"], {"id": "CONCEPT_DRAW_GAME"}),
    }

    summaries: ClassVar[dict[str, list[tuple[str, str, int]]]] = {
        SEED: [("BELONGS_TO", "out", 1), ("FROM_MARKET", "out", 1), ("USES", "out", 28)],
        "CONCEPT_DRAW_GAME": [("MAPS_TO", "in", 6)],
    }

    def __init__(self, _config: GraphConfig) -> None:
        pass

    def label_counts(self) -> dict[str, int]:
        FakeGraph.calls.append(("label_counts",))
        return {label: FakeGraph.counts.get(label, 0) for label in statements.NODE_LABELS}

    def node(self, node_id: str) -> list[tuple[list[str], dict[str, Any]]]:
        FakeGraph.calls.append(("node", node_id))
        found = FakeGraph.nodes.get(node_id)
        return [found] if found is not None else []

    def node_neighbours(
        self, node_id: str, rel_type: str | None, limit: int
    ) -> list[tuple[str, str, list[str], dict[str, Any]]]:
        FakeGraph.calls.append(("node_neighbours", node_id, rel_type, limit))
        if node_id != SEED:
            return []
        edges = [("USES", "out", ["Device"], {"id": f"DEV_{i:03d}"}) for i in range(28)]
        edges += [
            ("FROM_MARKET", "out", ["Market"], {"id": "MKT_GR", "source_record_id": "MKT_GR"})
        ]
        edges += [("BELONGS_TO", "out", ["PlayerSegment"], {"id": "SEG_GR_VIP"})]
        matching = [edge for edge in edges if rel_type is None or edge[0] == rel_type]
        return sorted(matching, key=lambda edge: (edge[0], edge[1], edge[3]["id"]))[:limit]

    def edge_summary(self, label: str, node_id: str) -> list[tuple[str, str, int]]:
        FakeGraph.calls.append(("edge_summary", label, node_id))
        return FakeGraph.summaries.get(node_id, [])

    def close(self) -> None:
        pass


@pytest.fixture()
def fake_graph(monkeypatch: pytest.MonkeyPatch) -> type[FakeGraph]:
    FakeGraph.calls = []
    FakeGraph.counts = dict(TINY_NODES)
    monkeypatch.setattr(graph_model, "GraphReader", FakeGraph)
    return FakeGraph


@pytest.fixture()
def client(dataset_root: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("DATASET_DIR", str(dataset_root / "tiny"))
    with TestClient(create_app(graph_config=UNREACHABLE_GRAPH)) as test_client:
        yield test_client


@pytest.fixture()
def client_without_graph(client: TestClient) -> TestClient:
    return client


@pytest.fixture()
def client_with_fake_graph_of_degree_30(
    client: TestClient, fake_graph: type[FakeGraph]
) -> TestClient:
    return client


def error_of(response: Any) -> dict[str, Any]:
    error: dict[str, Any] = response.json()["error"]
    return error


# -- schema -------------------------------------------------------------------


def test_schema_shows_the_b_and_c_allow_lists(client: TestClient) -> None:
    schema = client.get("/api/v1/graph/schema").json()
    assert set(schema["allow_list"]) == {"B", "C"}
    assert "SIMILAR_TO" in schema["allow_list"]["C"]
    assert "SIMILAR_TO" not in schema["allow_list"]["B"]
    assert set(schema["allow_list"]["C"]) - set(schema["allow_list"]["B"]) == set(
        statements.ONTOLOGY_RELATIONSHIP_TYPES
    )


def test_schema_names_the_source_table_of_each_label_built_from_one(client: TestClient) -> None:
    tables = client.get("/api/v1/graph/schema").json()["node_tables"]
    assert tables["Game"] == "games"
    assert tables["DocumentChunk"] == "document_chunks"
    assert "BusinessConcept" not in tables
    assert "PrizeType" not in tables


def test_schema_names_labels_typed_relationships_weights_and_caps(client: TestClient) -> None:
    schema = client.get("/api/v1/graph/schema").json()
    assert schema["labels"] == list(statements.NODE_LABELS)
    assert schema["label_version"] == LABEL_VERSION
    assert {"type": "SIMILAR_TO", "from_label": "Game", "to_label": "Game"} in schema[
        "relationship_types"
    ]
    assert {rel["type"] for rel in schema["relationship_types"]} == set(
        statements.RELATIONSHIP_TYPES
    )
    assert schema["weights"] == {
        "graph_distance": 0.25,
        "relationship_type": 0.25,
        "semantic_relevance": 0.35,
        "temporal_validity": 0.15,
    }
    assert set(schema["caps"]) == {
        "max_depth",
        "max_nodes_per_hop",
        "max_edges_per_node_type",
        "max_total_nodes",
    }
    assert all(isinstance(cap, int) and cap > 0 for cap in schema["caps"].values())


def test_relationship_endpoints_are_every_triple_ingestion_builds(tiny_dataset: Path) -> None:
    built = build_relationship_rows(load_dataset(tiny_dataset), load_ontology())
    assert set(statements.RELATIONSHIP_ENDPOINTS) == set(built)
    assert len(set(statements.RELATIONSHIP_ENDPOINTS)) == len(statements.RELATIONSHIP_ENDPOINTS)
    # Every endpoint's type is a registered relationship type, and every
    # registered type has an endpoint.
    endpoint_types = {kind for kind, _start, _end in statements.RELATIONSHIP_ENDPOINTS}
    assert endpoint_types <= set(statements.RELATIONSHIP_TYPES)
    assert set(statements.RELATIONSHIP_TYPES) <= endpoint_types


# -- stats --------------------------------------------------------------------


def test_stats_work_without_neo4j(client_without_graph: TestClient) -> None:
    stats = client_without_graph.get("/api/v1/graph/stats").json()
    assert sum(stats["nodes_by_label"].values()) == expected_node_total()
    assert stats["ingestion_version"]


def test_stats_sum_relationships_per_type_and_name_the_ingestion(client: TestClient) -> None:
    stats = client.get("/api/v1/graph/stats").json()
    assert stats["nodes_by_label"] == TINY_NODES
    assert stats["relationships_by_type"] == {"BELONGS_TO": 420, "SIMILAR_TO": 6}
    assert stats["ingestion_version"] == f"{LABEL_VERSION}/ing-20261020T080000Z"
    assert stats["source"] == "ingestion"


def test_stats_of_a_dataset_never_ingested_are_not_found(
    dataset_root: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("DATASET_DIR", str(dataset_root / "bare"))
    with TestClient(create_app(graph_config=UNREACHABLE_GRAPH)) as bare:
        response = bare.get("/api/v1/graph/stats")
    assert response.status_code == 404
    assert error_of(response)["error_code"] == "NOT_FOUND"
    assert "statistics" in error_of(response)["message"]


# -- nodes --------------------------------------------------------------------


def test_node_carries_its_properties_and_provenance(
    client: TestClient, fake_graph: type[FakeGraph]
) -> None:
    node = client.get(f"/api/v1/graph/nodes/{SEED}").json()
    assert node["node_id"] == SEED and node["labels"] == ["Player"]
    assert node["properties"]["registration_date"] == "2025-03-24"
    assert node["provenance"] == {"table": "players", "row_id": SEED, "dataset_id": "tiny"}


def test_node_reports_its_link_counts(client: TestClient, fake_graph: type[FakeGraph]) -> None:
    node = client.get(f"/api/v1/graph/nodes/{SEED}").json()
    assert node["edges"] == [
        {"type": "BELONGS_TO", "direction": "out", "count": 1},
        {"type": "FROM_MARKET", "direction": "out", "count": 1},
        {"type": "USES", "direction": "out", "count": 28},
    ]
    assert ("edge_summary", "Player", SEED) in FakeGraph.calls


def test_concept_node_reports_link_counts(client: TestClient, fake_graph: type[FakeGraph]) -> None:
    node = client.get("/api/v1/graph/nodes/CONCEPT_DRAW_GAME").json()
    assert node["provenance"] is None
    assert node["edges"] == [{"type": "MAPS_TO", "direction": "in", "count": 6}]


@pytest.mark.parametrize("node_id", ["PTYPE_JACKPOT", "CONCEPT_DRAW_GAME"])
def test_node_without_a_source_table_has_no_provenance(
    client: TestClient, fake_graph: type[FakeGraph], node_id: str
) -> None:
    assert client.get(f"/api/v1/graph/nodes/{node_id}").json()["provenance"] is None


def test_unknown_node_is_not_found(client: TestClient, fake_graph: type[FakeGraph]) -> None:
    response = client.get("/api/v1/graph/nodes/PLAYER_XX_999999")
    assert response.status_code == 404 and error_of(response)["error_code"] == "NOT_FOUND"
    neighbours = client.get("/api/v1/graph/nodes/PLAYER_XX_999999/neighbours")
    assert neighbours.status_code == 404


@pytest.mark.parametrize(
    "path", [f"/api/v1/graph/nodes/{SEED}", f"/api/v1/graph/nodes/{SEED}/neighbours"]
)
def test_node_reads_are_refused_while_a_benchmark_holds_the_graph(
    client: TestClient, fake_graph: type[FakeGraph], path: str
) -> None:
    """A cached match is never served while a benchmark job has another world loaded."""
    assert client.get(path).status_code == 200  # the match is now cached
    lease = client.app.state.graph_lease  # type: ignore[attr-defined]
    hold = lease.take_benchmark()
    try:
        response = client.get(path)
    finally:
        hold.release()
    assert response.status_code == 409
    assert error_of(response) == {
        "error_code": "CONFLICT",
        "message": "a benchmark run is using the graph; try again when it finishes",
        "retryable": True,
    }
    assert client.get(path).status_code == 200


def test_stats_and_schema_read_files_while_a_benchmark_holds_the_graph(
    client: TestClient,
) -> None:
    lease = client.app.state.graph_lease  # type: ignore[attr-defined]
    hold = lease.take_benchmark()
    try:
        assert client.get("/api/v1/graph/stats").status_code == 200
        assert client.get("/api/v1/graph/schema").status_code == 200
    finally:
        hold.release()


def test_node_read_fails_as_a_graph_query_error_when_neo4j_is_down(client: TestClient) -> None:
    response = client.get(f"/api/v1/graph/nodes/{SEED}")
    assert response.status_code == 503
    error = error_of(response)
    assert error["error_code"] == "GRAPH_QUERY_ERROR" and error["retryable"] is True
    assert "127.0.0.1" not in error["message"]


# -- neighbours ---------------------------------------------------------------


def test_neighbours_are_bounded_and_report_truncation(
    client_with_fake_graph_of_degree_30: TestClient,
) -> None:
    body = client_with_fake_graph_of_degree_30.get(
        f"/api/v1/graph/nodes/{SEED}/neighbours?limit=25"
    ).json()
    assert len(body["items"]) == 25 and body["truncated"] is True
    assert ("node_neighbours", SEED, None, 26) in FakeGraph.calls


def test_neighbours_default_to_25_and_carry_each_node(
    client: TestClient, fake_graph: type[FakeGraph]
) -> None:
    body = client.get(f"/api/v1/graph/nodes/{SEED}/neighbours").json()
    assert body["node_id"] == SEED and len(body["items"]) == 25 and body["truncated"] is True
    first = body["items"][0]
    assert first["rel_type"] == "BELONGS_TO" and first["direction"] == "out"
    assert first["node"]["labels"] == ["PlayerSegment"]
    market = body["items"][1]["node"]
    assert market["provenance"] == {"table": "markets", "row_id": "MKT_GR", "dataset_id": "tiny"}


def test_neighbours_within_the_limit_are_not_truncated(
    client: TestClient, fake_graph: type[FakeGraph]
) -> None:
    body = client.get(f"/api/v1/graph/nodes/{SEED}/neighbours?limit=100").json()
    assert len(body["items"]) == 30 and body["truncated"] is False


def test_neighbours_filter_by_relationship_type(
    client: TestClient, fake_graph: type[FakeGraph]
) -> None:
    body = client.get(f"/api/v1/graph/nodes/{SEED}/neighbours?type=FROM_MARKET").json()
    assert [item["node"]["node_id"] for item in body["items"]] == ["MKT_GR"]
    assert body["truncated"] is False


def test_neighbour_limit_above_the_maximum_is_refused(client: TestClient) -> None:
    assert client.get("/api/v1/graph/nodes/X/neighbours?limit=101").status_code == 422
    assert client.get("/api/v1/graph/nodes/X/neighbours?limit=0").status_code == 422


def test_unknown_relationship_type_is_refused_before_any_graph_read(
    client: TestClient, fake_graph: type[FakeGraph]
) -> None:
    response = client.get(f"/api/v1/graph/nodes/{SEED}/neighbours?type=KNOWS")
    assert response.status_code == 422
    assert error_of(response)["error_code"] == "VALIDATION_ERROR"
    assert fake_graph.calls == []


# -- which world the graph holds ----------------------------------------------


def test_node_routes_refuse_a_graph_holding_another_world(
    client: TestClient, fake_graph: type[FakeGraph]
) -> None:
    fake_graph.counts = {**TINY_NODES, "Player": 10_000}
    for path in (f"/api/v1/graph/nodes/{SEED}", f"/api/v1/graph/nodes/{SEED}/neighbours"):
        response = client.get(path)
        assert response.status_code == 409
        assert error_of(response) == {
            "error_code": "CONFLICT",
            "message": "the graph holds a different world than the active dataset",
            "retryable": False,
        }
    assert not any(call[0] in ("node", "node_neighbours") for call in fake_graph.calls)


class CountingGraph:
    def __init__(self, counts: dict[str, int]) -> None:
        self.counts = counts
        self.reads = 0

    def label_counts(self) -> dict[str, int]:
        self.reads += 1
        return {label: self.counts.get(label, 0) for label in statements.NODE_LABELS}


def test_graph_world_matches_compares_live_counts_with_the_statistics(
    dataset_root: Path,
) -> None:
    tiny = dataset_root / "tiny"
    assert graph_world_matches(CountingGraph(dict(TINY_NODES)), tiny) is True
    assert graph_world_matches(CountingGraph({**TINY_NODES, "Player": 199}), tiny) is False
    assert graph_world_matches(CountingGraph({**TINY_NODES, "Game": 20}), tiny) is False


def test_graph_world_is_unknown_without_statistics(dataset_root: Path) -> None:
    graph = CountingGraph(dict(TINY_NODES))
    assert graph_world_matches(graph, dataset_root / "bare") is None
    assert GraphWorldCheck()(graph, dataset_root / "bare") is None
    assert graph.reads == 0


def test_graph_world_check_is_cached_for_30_seconds(dataset_root: Path) -> None:
    now = [100.0]
    check = GraphWorldCheck(clock=lambda: now[0])
    graph = CountingGraph(dict(TINY_NODES))
    assert check(graph, dataset_root / "tiny") is True
    graph.counts = {}
    now[0] += WORLD_CHECK_TTL_S - 1
    assert check(graph, dataset_root / "tiny") is True and graph.reads == 1
    now[0] += 1
    assert check(graph, dataset_root / "tiny") is False and graph.reads == 2


def test_graph_world_check_does_not_cache_a_failed_read(dataset_root: Path) -> None:
    class Failing(CountingGraph):
        def label_counts(self) -> dict[str, int]:
            self.reads += 1
            raise ServiceUnavailable("down")

    check = GraphWorldCheck(clock=lambda: 0.0)
    failing = Failing({})
    for _ in range(2):
        with pytest.raises(ServiceUnavailable):
            check(failing, dataset_root / "tiny")
    assert failing.reads == 2


# -- live ---------------------------------------------------------------------


def test_live_graph_schema_node_and_neighbours(monkeypatch: pytest.MonkeyPatch) -> None:
    """Live, read-only: the ingested dev-seed2026 graph, never wiped or written."""
    gate.skip_without(gate.GRAPH, gate.WORLD)
    gate.require_paths(DEFAULT_DATASET_DIR / GRAPH_STATS_FILE)
    graph = gate.require_neo4j()
    monkeypatch.setenv("DATASET_DIR", str(DEFAULT_DATASET_DIR))
    with TestClient(create_app(graph_config=graph)) as live:
        stats = live.get("/api/v1/graph/stats").json()
        node = live.get(f"/api/v1/graph/nodes/{SEED}")
        assert node.status_code != 409, "Neo4j holds another world than dev-seed2026"
        body = live.get(f"/api/v1/graph/nodes/{SEED}/neighbours?limit=3").json()
        segments = live.get(f"/api/v1/graph/nodes/{SEED}/neighbours?type=BELONGS_TO").json()
    assert stats["nodes_by_label"]["Player"] > 0
    assert node.status_code == 200
    assert node.json()["provenance"] == {
        "table": "players",
        "row_id": SEED,
        "dataset_id": DEFAULT_DATASET_DIR.name,
    }
    assert 0 < len(body["items"]) <= 3
    keys = [
        (item["rel_type"], item["direction"], item["node"]["node_id"]) for item in body["items"]
    ]
    assert keys == sorted(keys)
    # A player belongs to a value segment and an engagement segment.
    assert [item["node"]["labels"] for item in segments["items"]] == [["PlayerSegment"]] * 2
    assert segments["truncated"] is False
