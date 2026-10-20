"""Data Model routes: datasets, the data dictionary, sample rows and records
with their graph node (Phase 4 Task 9).

The routes run on the tiny generated world, written under a temporary
dataset root next to a second world, a directory without a manifest and a
truth directory. Graph reads go through a fake reader offline; the live
adapter runs under GRAPH_E2E=1 (it wipes and re-ingests Neo4j, as
tests/test_graph_rag_live.py does).
"""

from __future__ import annotations

import json
import os
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, ClassVar

import app.api.data_model as data_model
import duckdb
import pytest
from app.config import GraphConfig
from app.datasets.config import GenerationConfig
from app.datasets.parquet import write_world
from app.datasets.schema import TABLE_SCHEMAS
from app.datasets.world import build_world
from app.main import create_app
from fastapi.testclient import TestClient

# Nothing listens on the discard port, so the driver fails fast.
UNREACHABLE_GRAPH = GraphConfig(
    uri="bolt://127.0.0.1:9", user="neo4j", password="unused", database="neo4j", timeout_s=1.0
)
INDEX_MANIFEST = {
    "collection": "tiny_collection",
    "chunk_count": 24,
    "record_count": 400,
    "record_serialiser_version": "2.1.0",
    "indexed_at": "2026-10-20T08:00:00+00:00",
}


@pytest.fixture(scope="module")
def dataset_root(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """tiny (active, indexed), other (a second world, not indexed), a
    directory without a manifest and a truth directory holding a ledger."""
    root = tmp_path_factory.mktemp("datasets")
    for name, seed in (("tiny", 42), ("other", 7)):
        world = build_world(GenerationConfig(profile="tiny", world_seed=seed))
        write_world(root / name, TABLE_SCHEMAS, world.tables)
        (root / name / "_manifest.json").write_text(json.dumps(world.manifest))
    (root / "tiny" / "vector-index.json").write_text(json.dumps(INDEX_MANIFEST))
    (root / "scratch").mkdir()
    (root / "truth").mkdir()
    (root / "truth" / "ledger.json").write_text("{}")
    return root


@pytest.fixture()
def client(dataset_root: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("DATASET_DIR", str(dataset_root / "tiny"))
    with TestClient(create_app(graph_config=UNREACHABLE_GRAPH)) as test_client:
        yield test_client


@dataclass
class DuckDbSpy:
    statements: list[str] = field(default_factory=list)


@pytest.fixture()
def spy_duckdb(monkeypatch: pytest.MonkeyPatch) -> DuckDbSpy:
    """Records every statement the data-model routes run on DuckDB."""
    spy = DuckDbSpy()
    connect = duckdb.connect

    class Recording:
        def __init__(self) -> None:
            self._connection = connect()

        def execute(self, statement: str, parameters: Any = None) -> Any:
            spy.statements.append(statement)
            return self._connection.execute(statement, parameters)

        def close(self) -> None:
            self._connection.close()

    monkeypatch.setattr(duckdb, "connect", Recording)
    return spy


class FakeReader:
    """Stands in for the Neo4j reader: a fixed edge summary per node id."""

    calls: ClassVar[list[tuple[str, str]]] = []

    def __init__(self, _config: GraphConfig) -> None:
        pass

    def edge_summary(self, label: str, node_id: str) -> list[tuple[str, str, int]]:
        FakeReader.calls.append((label, node_id))
        return [("FROM_MARKET", "out", 1), ("USES_PAYMENT", "out", 2)]

    def close(self) -> None:
        pass


@pytest.fixture()
def fake_reader(monkeypatch: pytest.MonkeyPatch) -> type[FakeReader]:
    FakeReader.calls = []
    monkeypatch.setattr(data_model, "GraphReader", FakeReader)
    return FakeReader


def table(dictionary: list[dict[str, Any]], name: str) -> dict[str, Any]:
    return next(entry for entry in dictionary if entry["table"] == name)


# -- datasets -----------------------------------------------------------------


def test_datasets_lists_worlds_with_a_manifest_and_marks_the_active_one(
    client: TestClient,
) -> None:
    datasets = client.get("/api/v1/datasets").json()
    assert [d["dataset_id"] for d in datasets] == ["other", "tiny"]
    tiny = next(d for d in datasets if d["dataset_id"] == "tiny")
    assert tiny["active"] is True and tiny["world_seed"] == 42 and tiny["profile"] == "tiny"
    assert tiny["row_counts"]["players"] == 200
    assert next(d for d in datasets if d["dataset_id"] == "other")["active"] is False


def test_truth_and_unmanifested_directories_are_never_listed_or_served(
    client: TestClient,
) -> None:
    listed = {d["dataset_id"] for d in client.get("/api/v1/datasets").json()}
    assert not listed & {"truth", "scratch"}
    assert client.get("/api/v1/datasets/truth").status_code == 404
    assert client.get("/api/v1/datasets/truth/dictionary").status_code == 404


def test_dataset_id_cannot_escape_the_data_directory(client: TestClient) -> None:
    assert client.get("/api/v1/datasets/..%2Ftruth").status_code in (404, 422)
    assert client.get("/api/v1/datasets/..").status_code in (404, 422)
    response = client.get("/api/v1/datasets/nope")
    assert response.status_code == 404 and response.json()["error"]["error_code"] == "NOT_FOUND"


def test_dataset_detail_carries_provenance_and_index_status(client: TestClient) -> None:
    detail = client.get("/api/v1/datasets/tiny").json()
    assert detail["summary"]["dataset_id"] == "tiny"
    assert detail["provenance"]["players"] == {
        "source_system": "warehouse",
        "source_table": "players",
    }
    assert detail["index_status"] == {
        "collection": "tiny_collection",
        "points": 424,
        "serialiser_version": "2.1.0",
        "built_at": "2026-10-20T08:00:00+00:00",
    }
    assert client.get("/api/v1/datasets/other").json()["index_status"] is None


# -- dictionary ---------------------------------------------------------------


def test_dictionary_names_keys_sources_and_provenance(client: TestClient) -> None:
    dictionary = client.get("/api/v1/datasets/tiny/dictionary").json()
    assert [entry["table"] for entry in dictionary] == list(TABLE_SCHEMAS)
    players = table(dictionary, "players")
    assert players["primary_key"] == "player_id" and players["source_system"]
    assert players["foreign_keys"]
    assert {"column": "market_id", "table": "markets", "ref_column": "market_id"} in players[
        "foreign_keys"
    ]
    assert players["columns"][0] == {"name": "player_id", "type": "VARCHAR", "description": None}
    assert players["provenance"] == {"source_system": "warehouse", "source_table": "players"}
    assert table(dictionary, "sessions")["source_system"] == "telemetry_platform"


# -- rows ---------------------------------------------------------------------


def test_unknown_table_or_column_is_refused_before_any_query(
    client: TestClient, spy_duckdb: DuckDbSpy
) -> None:
    assert client.get("/api/v1/datasets/tiny/tables/players;drop/rows").status_code == 422
    assert (
        client.get("/api/v1/datasets/tiny/tables/players/rows?column=1=1--&value=x").status_code
        == 422
    )
    assert (
        client.get("/api/v1/datasets/tiny/tables/players;drop/rows/PLAYER_UK_000001").status_code
        == 422
    )
    assert spy_duckdb.statements == []


def test_a_filter_needs_both_column_and_value(client: TestClient, spy_duckdb: DuckDbSpy) -> None:
    assert (
        client.get("/api/v1/datasets/tiny/tables/players/rows?column=market_id").status_code == 422
    )
    assert client.get("/api/v1/datasets/tiny/tables/players/rows?value=MKT_GR").status_code == 422
    assert spy_duckdb.statements == []


def test_page_size_above_the_maximum_is_refused(client: TestClient, spy_duckdb: DuckDbSpy) -> None:
    assert client.get("/api/v1/datasets/tiny/tables/players/rows?limit=201").status_code == 422
    assert client.get("/api/v1/datasets/tiny/tables/players/rows?offset=-1").status_code == 422
    assert spy_duckdb.statements == []


def test_rows_page_and_filter_with_a_bound_value(client: TestClient, spy_duckdb: DuckDbSpy) -> None:
    page = client.get(
        "/api/v1/datasets/tiny/tables/players/rows?limit=2&column=market_id&value=MKT_GR"
    ).json()
    assert page["limit"] == 2 and len(page["rows"]) == 2
    assert all(r["market_id"] == "MKT_GR" for r in page["rows"])
    assert page["total"] >= len(page["rows"])
    assert page["total"] == 56  # the tiny world's Greek players
    assert len(spy_duckdb.statements) == 2  # the count and the page
    assert all("MKT_GR" not in statement for statement in spy_duckdb.statements)


def test_rows_default_page_and_stable_order(client: TestClient) -> None:
    first = client.get("/api/v1/datasets/tiny/tables/players/rows").json()
    assert (first["offset"], first["limit"], first["total"]) == (0, 50, 200)
    second = client.get("/api/v1/datasets/tiny/tables/players/rows?offset=50&limit=50").json()
    ids = [r["player_id"] for r in first["rows"] + second["rows"]]
    assert ids == sorted(ids) and len(set(ids)) == 100


def test_rows_render_dates_and_exact_decimals_as_strings(client: TestClient) -> None:
    page = client.get(
        "/api/v1/datasets/tiny/tables/games/rows?column=game_id&value=GAME_UK_01"
    ).json()
    game = page["rows"][0]
    assert game["ticket_price"] == "2.50"
    assert game["launch_date"] == "2022-10-24" and game["retirement_date"] is None
    assert game["digital_enabled"] is True
    session = client.get("/api/v1/datasets/tiny/tables/sessions/rows?limit=1").json()["rows"][0]
    assert "T" in session["started_at"]


def test_rows_of_an_unknown_dataset_are_not_found(client: TestClient) -> None:
    assert client.get("/api/v1/datasets/nope/tables/players/rows").status_code == 404


# -- records ------------------------------------------------------------------


def test_record_carries_its_graph_node_and_edge_summary_offline(
    client: TestClient, fake_reader: type[FakeReader]
) -> None:
    record = client.get("/api/v1/datasets/tiny/tables/players/rows/PLAYER_UK_000001").json()
    assert record["table"] == "players"
    assert record["row"]["player_id"] == "PLAYER_UK_000001"
    assert record["graph_node_id"] == "PLAYER_UK_000001"
    assert record["edges"] == [
        {"type": "FROM_MARKET", "direction": "out", "count": 1},
        {"type": "USES_PAYMENT", "direction": "out", "count": 2},
    ]
    assert record["graph_error"] is None
    assert fake_reader.calls == [("Player", "PLAYER_UK_000001")]


def test_record_keeps_its_row_when_the_graph_is_unreachable(client: TestClient) -> None:
    response = client.get("/api/v1/datasets/tiny/tables/players/rows/PLAYER_UK_000001")
    assert response.status_code == 200
    record = response.json()
    assert record["row"]["player_id"] == "PLAYER_UK_000001"
    assert record["graph_node_id"] == "PLAYER_UK_000001"
    assert record["edges"] is None and record["graph_error"] == "GRAPH_QUERY_ERROR"


def test_record_of_a_table_without_a_graph_label_reads_no_graph(
    client: TestClient, fake_reader: type[FakeReader]
) -> None:
    record = client.get("/api/v1/datasets/tiny/tables/regions/rows/REG_UK_NORTH").json()
    assert record["graph_node_id"] is None and record["edges"] == []
    assert fake_reader.calls == []


def test_record_of_a_dataset_the_graph_does_not_hold_reads_no_graph(
    client: TestClient, fake_reader: type[FakeReader]
) -> None:
    record = client.get("/api/v1/datasets/other/tables/players/rows/PLAYER_UK_000001").json()
    assert record["row"]["player_id"] == "PLAYER_UK_000001"
    assert record["graph_node_id"] is None and record["edges"] == []
    assert fake_reader.calls == []


def test_unknown_record_is_not_found(client: TestClient) -> None:
    response = client.get("/api/v1/datasets/tiny/tables/players/rows/PLAYER_XX_999999")
    assert response.status_code == 404


def test_record_of_a_table_whose_key_is_not_unique_is_a_conflict(client: TestClient) -> None:
    # INC_005 affects three games in the tiny world: three incident_game_map rows.
    response = client.get("/api/v1/datasets/tiny/tables/incident_game_map/rows/INC_005")
    assert response.status_code == 409


def test_record_carries_its_graph_node_and_edge_summary(
    dataset_root: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Live: the real statement over the tiny world ingested into Neo4j."""
    if os.environ.get("GRAPH_E2E") != "1":
        pytest.skip("set GRAPH_E2E=1 to run live-graph tests (they wipe the database)")
    from app.graph.ingest import ingest

    graph = GraphConfig.from_env()
    ingest(dataset_root / "tiny", graph, ingestion_version="ing-test", wipe=True)
    monkeypatch.setenv("DATASET_DIR", str(dataset_root / "tiny"))
    with TestClient(create_app(graph_config=graph)) as live:
        record = live.get("/api/v1/datasets/tiny/tables/players/rows/PLAYER_UK_000001").json()
    assert record["graph_node_id"] == "PLAYER_UK_000001" and record["graph_error"] is None
    edges = {(edge["type"], edge["direction"]): edge["count"] for edge in record["edges"]}
    assert edges[("BELONGS_TO", "out")] == 2  # value and engagement segments
    assert all(count > 0 for count in edges.values())
