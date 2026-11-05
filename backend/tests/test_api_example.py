"""The Data Model Overview example: the first incident whose platform version
is shared with another market, never one whose id, platform version or app
version the world's truth ledger names (data model redesign, Task 3)."""

from __future__ import annotations

import json
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import duckdb
import pytest
from app.config import GraphConfig
from app.main import create_app
from fastapi.testclient import TestClient

UNREACHABLE_GRAPH = GraphConfig(
    uri="bolt://127.0.0.1:9", user="neo4j", password="unused", database="neo4j", timeout_s=1.0
)
WORLD = {"profile": "dev", "world_seed": 2026, "generator_version": "0.2.0"}
SCENARIO_SEED = 7
# (incident_id, market_id, platform_version_id, app_version_id)
Incident = tuple[str, str | None, str | None, str | None]


def _scenario(required_evidence: list[str], truth: dict[str, Any]) -> dict[str, Any]:
    return {
        "scenario_id": "SCN-001",
        "scenario_type": "app_release_conversion_failure",
        "enabled": True,
        "strength": 0.8,
        "noise_level": "moderate",
        "start_date": "2025-06-21",
        "duration_days": 10,
        "affected_markets": [],
        "affected_games": [],
        "affected_segments": [],
        "expected_signals": [],
        "benchmark_questions": [],
        "required_evidence": required_evidence,
        "truth": truth,
    }


def _write_world(root: Path, incidents: list[Incident], *, world: dict[str, Any] = WORLD) -> Path:
    directory = root / "dev-seed2026"
    directory.mkdir()
    manifest = {**world, "scenario_seed": SCENARIO_SEED, "row_counts": {}}
    (directory / "_manifest.json").write_text(json.dumps(manifest))
    with duckdb.connect() as connection:
        connection.execute(
            "CREATE TABLE incidents (incident_id VARCHAR, market_id VARCHAR, "
            "platform_version_id VARCHAR, app_version_id VARCHAR)"
        )
        if incidents:
            connection.executemany("INSERT INTO incidents VALUES (?, ?, ?, ?)", incidents)
        connection.execute(
            f"COPY incidents TO '{directory / 'incidents.parquet'}' (FORMAT parquet)"
        )
    return directory


def _write_ledger(
    root: Path, scenarios: list[dict[str, Any]], *, world: dict[str, Any] = WORLD
) -> Path:
    path = root / "ledger.json"
    payload = {
        "ledger_version": "2.0.0",
        "scenario_seed": SCENARIO_SEED,
        "world": world,
        "scenarios": scenarios,
    }
    path.write_text(json.dumps(payload))
    return path


ClientFor = Callable[..., TestClient]


@pytest.fixture()
def client_for(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[ClientFor]:
    clients: list[TestClient] = []

    def build(
        incidents: list[Incident],
        scenarios: list[dict[str, Any]] | None = None,
        *,
        ledger_world: dict[str, Any] = WORLD,
    ) -> TestClient:
        world_dir = _write_world(tmp_path, incidents)
        monkeypatch.setenv("DATASET_DIR", str(world_dir))
        if scenarios is None:
            monkeypatch.setenv("TRUTH_LEDGER_PATH", str(tmp_path / "missing.json"))
        else:
            ledger = _write_ledger(tmp_path, scenarios, world=ledger_world)
            monkeypatch.setenv("TRUTH_LEDGER_PATH", str(ledger))
        client = TestClient(create_app(graph_config=UNREACHABLE_GRAPH))
        client.__enter__()
        clients.append(client)
        return client

    yield build
    for client in clients:
        client.__exit__(None, None, None)


def _example(client: TestClient) -> Any:
    response = client.get("/api/v1/data-model/example")
    assert response.status_code == 200, response.text
    return response.json()


def test_example_is_the_first_shared_version_incident_not_planted(client_for: ClientFor) -> None:
    client = client_for(
        [
            ("INC_003", "MKT_AT", "PLV_A", None),
            ("INC_001", "MKT_UK", "PLV_A", None),
            ("INC_002", "MKT_GR", "PLV_A", None),
        ],
        [_scenario(["INC_002"], {})],
    )
    assert _example(client) == {"incident_id": "INC_001"}


def test_planted_incident_is_never_the_example(client_for: ClientFor) -> None:
    # INC_001 and INC_002 share PLV_A across markets, but INC_001 is planted
    # (named deep in the truth values), so no shared pair is left.
    client = client_for(
        [
            ("INC_001", "MKT_UK", "PLV_A", None),
            ("INC_002", "MKT_GR", "PLV_A", None),
            ("INC_003", "MKT_AT", "PLV_B", None),
        ],
        [_scenario([], {"incidents": [{"incident_id": "INC_001"}]})],
    )
    assert _example(client) == {"incident_id": "INC_002"}


def test_incident_on_a_planted_platform_version_is_never_the_example(
    client_for: ClientFor,
) -> None:
    # INC_001 is not planted, but its version PLV_A is a story's answer, so
    # neither it nor its partner may be the example.
    client = client_for(
        [
            ("INC_001", "MKT_UK", "PLV_A", None),
            ("INC_002", "MKT_GR", "PLV_A", None),
            ("INC_003", "MKT_AT", "PLV_B", None),
            ("INC_004", "MKT_CZ", "PLV_B", None),
        ],
        [_scenario(["PLV_A"], {})],
    )
    assert _example(client) == {"incident_id": "INC_003"}


def test_incident_on_a_planted_app_version_is_never_the_example(client_for: ClientFor) -> None:
    client = client_for(
        [
            ("INC_001", "MKT_UK", "PLV_A", "APV_X"),
            ("INC_002", "MKT_GR", "PLV_A", None),
            ("INC_003", "MKT_AT", "PLV_B", None),
        ],
        [_scenario([], {"app_version_id": "APV_X"})],
    )
    assert _example(client) == {"incident_id": "INC_002"}


def test_planted_partner_does_not_make_a_shared_version(client_for: ClientFor) -> None:
    # INC_002 shares PLV_A only with the planted INC_003, so no shared pair
    # is left and the first incident left is the example.
    client = client_for(
        [
            ("INC_001", "MKT_UK", "PLV_B", None),
            ("INC_002", "MKT_UK", "PLV_A", None),
            ("INC_003", "MKT_GR", "PLV_A", None),
        ],
        [_scenario(["INC_003"], {})],
    )
    assert _example(client) == {"incident_id": "INC_001"}


def test_null_market_counts_as_its_own_market(client_for: ClientFor) -> None:
    client = client_for(
        [
            ("INC_001", "MKT_UK", "PLV_B", None),
            ("INC_002", None, "PLV_A", None),
            ("INC_003", "MKT_UK", "PLV_A", None),
        ],
        [_scenario([], {})],
    )
    assert _example(client) == {"incident_id": "INC_002"}


def test_no_matching_ledger_gives_no_example(
    client_for: ClientFor, caplog: pytest.LogCaptureFixture
) -> None:
    client = client_for(
        [("INC_001", "MKT_UK", "PLV_A", None), ("INC_002", "MKT_GR", "PLV_A", None)]
    )
    with caplog.at_level("WARNING"):
        assert _example(client) == {"incident_id": None}
    assert any(record.message == "no example incident" for record in caplog.records)


def test_malformed_ledger_reason_names_no_ledger_content(
    client_for: ClientFor, tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    client = client_for(
        [("INC_001", "MKT_UK", "PLV_A", None)],
        [{**_scenario([], {}), "strength": "SECRET_PLANTED_VALUE"}],
    )
    with caplog.at_level("WARNING"):
        assert _example(client) == {"incident_id": None}
    (record,) = [record for record in caplog.records if record.message == "no example incident"]
    reason = record.__dict__["reason"]
    assert "input_value" not in reason
    assert "SECRET_PLANTED_VALUE" not in reason
    assert str(tmp_path / "ledger.json") in reason


def test_ledger_of_another_world_gives_no_example(client_for: ClientFor) -> None:
    client = client_for(
        [("INC_001", "MKT_UK", "PLV_A", None), ("INC_002", "MKT_GR", "PLV_A", None)],
        [_scenario([], {})],
        ledger_world={**WORLD, "world_seed": 2027},
    )
    assert _example(client) == {"incident_id": None}


def test_no_incidents_gives_no_example(client_for: ClientFor) -> None:
    client = client_for([], [_scenario([], {})])
    assert _example(client) == {"incident_id": None}


def test_world_without_an_incidents_table_is_not_found(
    client_for: ClientFor, tmp_path: Path
) -> None:
    client = client_for([], [_scenario([], {})])
    (tmp_path / "dev-seed2026" / "incidents.parquet").unlink()
    response = client.get("/api/v1/data-model/example")
    assert response.status_code == 404
    assert response.json()["error"]["error_code"] == "NOT_FOUND"


def test_response_names_only_the_example(client_for: ClientFor) -> None:
    client = client_for(
        [("INC_001", "MKT_UK", "PLV_A", None), ("INC_002", "MKT_GR", "PLV_A", None)],
        [_scenario(["INC_002"], {"incident_id": "INC_002"})],
    )
    assert set(_example(client)) == {"incident_id"}
