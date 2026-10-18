"""Validation suite: referential integrity, currency, time order, volumes."""

from __future__ import annotations

from datetime import datetime, timedelta

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
    broken[0] = broken[0]._replace(ticket_id="TKT_BROKEN", game_id="GAME_MISSING")
    tables["tickets"] = broken
    world = World(tiny_world.config, tables)

    errors = validate_world(world)
    assert any("GAME_MISSING" in e and "referential" in e for e in errors)


def test_wrong_ticket_currency_is_reported(tiny_world: World) -> None:
    tables = {name: list(rows) for name, rows in tiny_world.tables.items()}
    broken = list(tables["tickets"])
    broken[0] = broken[0]._replace(currency_code="USD")
    tables["tickets"] = broken
    world = World(tiny_world.config, tables)

    errors = validate_world(world)
    assert any("currency: ticket" in e for e in errors)


def test_pre_launch_ticket_is_reported(tiny_world: World) -> None:
    tables = {name: list(rows) for name, rows in tiny_world.tables.items()}
    game = tables["games"][0]
    broken = list(tables["tickets"])
    broken[0] = broken[0]._replace(
        ticket_id="TKT_EARLY",
        game_id=game.game_id,
        market_id=game.market_id,
        currency_code=game.currency_code,
        purchase_timestamp=datetime.combine(game.launch_date, datetime.min.time())
        - timedelta(days=5),
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


def test_shared_payment_pool_is_real_rows(tiny_world: World) -> None:
    ids = {row.payment_method_id for row in tiny_world.tables["payment_methods"]}
    assert {f"PAY_SHARED_{i:03d}" for i in range(80)} <= ids


def test_players_use_their_markets_segment_codes(tiny_world: World) -> None:
    for player in tiny_world.tables["players"]:
        assert player.value_segment.startswith(f"SEG_{player.market_id[-2:]}_")
        assert player.engagement_segment.startswith(f"SEG_{player.market_id[-2:]}_")


def test_payment_methods_reference_known_providers(tiny_world: World) -> None:
    providers = {row.provider_id for row in tiny_world.tables["payment_providers"]}
    assert all(row.provider_id in providers for row in tiny_world.tables["payment_methods"])


def test_incident_types_are_market_local_or_corporate(tiny_world: World) -> None:
    for incident in tiny_world.tables["incidents"]:
        expected_prefix = (
            "ITYPE_CORP_" if incident.market_id is None else f"ITYPE_{incident.market_id[-2:]}_"
        )
        assert incident.incident_type.startswith(expected_prefix)


def test_exposure_ids_do_not_collide_with_experiments(tiny_world: World) -> None:
    assert all(
        row.exposure_id.startswith("EXPO_") for row in tiny_world.tables["campaign_exposures"]
    )


def test_volume_targets_include_operational_volumes(tiny_world: World) -> None:
    volumes = PROFILES["tiny"]
    assert len(tiny_world.tables["incidents"]) == volumes.incidents
    assert len(tiny_world.tables["campaigns"]) == volumes.campaigns_per_market * 4
    assert len(tiny_world.tables["experiments"]) == volumes.experiments
