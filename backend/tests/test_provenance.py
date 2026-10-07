"""Provenance coverage for every generated table."""

from __future__ import annotations

import pytest
from app.datasets.config import GenerationConfig
from app.datasets.world import TABLE_PROVENANCE, World, build_world

CONTRACT_SOURCES = {
    "warehouse",
    "document_store",
    "support_platform",
    "campaign_platform",
    "telemetry_platform",
    "release_management",
    "incident_management",
}


@pytest.fixture(scope="module")
def world() -> World:
    return build_world(GenerationConfig(profile="tiny", world_seed=42))


def test_every_table_has_provenance(world: World) -> None:
    assert set(world.tables) - set(TABLE_PROVENANCE) == set()


def test_source_systems_match_contracts(world: World) -> None:
    systems = {system for system, _ in TABLE_PROVENANCE.values()}
    assert systems == CONTRACT_SOURCES


def test_manifest_records_provenance(world: World) -> None:
    assert set(world.manifest["provenance"]) == set(world.tables)
    assert world.manifest["provenance"]["tickets"] == {
        "source_system": "warehouse",
        "source_table": "tickets",
    }


def test_data_dictionary_covers_every_field() -> None:
    from app.datasets.util import split_columns
    from app.datasets.world import TABLE_SCHEMAS, build_data_dictionary

    dictionary = build_data_dictionary()
    expected_fields = sum(len(split_columns(ddl)) for ddl in TABLE_SCHEMAS.values())
    assert len(dictionary) == expected_fields

    games = [entry for entry in dictionary if entry["table"] == "games"]
    assert games[0] == {
        "table": "games",
        "field": "game_id",
        "type": "VARCHAR",
        "position": 0,
        "primary_key": True,
        "source_system": "warehouse",
        "source_table": "games",
        "sensitivity": "none (synthetic)",
    }
