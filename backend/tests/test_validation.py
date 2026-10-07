"""Validation suite: referential integrity, currency, time order, volumes."""

from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal

import pytest
from app.datasets.config import PROFILES, GenerationConfig
from app.datasets.validation import validate_world
from app.datasets.world import World, build_world


@pytest.fixture(scope="module")
def tiny_world() -> World:
    return build_world(GenerationConfig(profile="tiny", world_seed=42))


def test_tiny_world_passes_validation(tiny_world: World) -> None:
    assert validate_world(tiny_world) == []


def test_missing_parent_reference_is_reported(tiny_world: World) -> None:
    tables = {name: list(rows) for name, rows in tiny_world.tables.items()}
    broken = list(tables["tickets"])
    broken[0] = (
        "TKT_BROKEN",
        None,
        "GAME_MISSING",
        "MKT_UK",
        None,
        None,
        "WEB",
        broken[0][7],
        Decimal("2.50"),
        "GBP",
        "SETTLED",
    )
    tables["tickets"] = broken
    world = World(tiny_world.config, tables)

    errors = validate_world(world)
    assert any("GAME_MISSING" in e and "referential" in e for e in errors)


def test_wrong_ticket_currency_is_reported(tiny_world: World) -> None:
    tables = {name: list(rows) for name, rows in tiny_world.tables.items()}
    broken = list(tables["tickets"])
    row = broken[0]
    broken[0] = (*row[:9], "USD", *row[10:])
    tables["tickets"] = broken
    world = World(tiny_world.config, tables)

    errors = validate_world(world)
    assert any("currency: ticket" in e for e in errors)


def test_pre_launch_ticket_is_reported(tiny_world: World) -> None:
    tables = {name: list(rows) for name, rows in tiny_world.tables.items()}
    game_id = tables["games"][0][0]
    launch = tables["games"][0][5]
    broken = list(tables["tickets"])
    broken[0] = (
        "TKT_EARLY",
        None,
        game_id,
        "MKT_UK",
        None,
        None,
        "WEB",
        datetime.combine(launch, datetime.min.time()) - timedelta(days=5),
        Decimal("2.50"),
        "GBP",
        "SETTLED",
    )
    tables["tickets"] = broken
    world = World(tiny_world.config, tables)

    errors = validate_world(world)
    assert any("precedes game launch" in e for e in errors)


def test_volume_targets_match_profile(tiny_world: World) -> None:
    volumes = PROFILES[tiny_world.config.profile]
    assert len(tiny_world.tables["players"]) == volumes.players
    assert len(tiny_world.tables["tickets"]) == volumes.tickets
    assert len(tiny_world.tables["sessions"]) == volumes.sessions
    assert len(tiny_world.tables["campaign_exposures"]) == volumes.campaign_exposures
    assert len(tiny_world.tables["documents"]) == volumes.documents
    assert len(tiny_world.tables["games"]) == volumes.games_expected
