"""Validation suite: referential integrity, currency, time order, volumes."""

from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal

import pytest
from app.datasets.activity import generate_draws
from app.datasets.config import PROFILES, GenerationConfig
from app.datasets.master_data import CAMPAIGN_OBJECTIVES
from app.datasets.rng import stream
from app.datasets.rows import GameRow
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


def test_campaign_objectives_cycle_through_all_four_in_each_market(tiny_world: World) -> None:
    expected = [objective_id for objective_id, _ in CAMPAIGN_OBJECTIVES]
    for market_id in {c.market_id for c in tiny_world.tables["campaigns"]}:
        objectives = [
            c.objective_code for c in tiny_world.tables["campaigns"] if c.market_id == market_id
        ]
        assert objectives == (expected * len(objectives))[: len(objectives)]
        assert objectives[:3] == expected[:3]


def test_experiment_target_segments_are_local_engagement_segments(tiny_world: World) -> None:
    engagement = {
        s.segment_id for s in tiny_world.tables["player_segments"] if s.segment_kind == "ENGAGEMENT"
    }
    for experiment in tiny_world.tables["experiments"]:
        assert experiment.target_segment in engagement
        assert experiment.target_segment.startswith(f"SEG_{experiment.market_id[-2:]}_")


def test_support_categories_are_market_local(tiny_world: World) -> None:
    for case in tiny_world.tables["support_cases"]:
        assert case.category_code.startswith(f"SUPC_{case.market_id[-2:]}_")


def test_kpi_daily_has_conversion_rate_for_every_market(tiny_world: World) -> None:
    markets = {m.market_id for m in tiny_world.tables["markets"]}
    converted = {
        k.market_id for k in tiny_world.tables["kpi_daily"] if k.metric_code == "conversion_rate"
    }
    assert converted == markets


def _game(game_id: str, family: str, jackpot_type: str) -> GameRow:
    template = GameRow(
        game_id, "MKT_UK", "Test", family, "CAT_UK_DRAW", datetime(2025, 1, 1).date(), None,
        "ACTIVE", Decimal("2.50"), "GBP", "WEEKLY", jackpot_type, "PARIMUTUEL", True, True,
    )  # fmt: skip
    return template


def test_draw_base_jackpot_follows_jackpot_type_and_family() -> None:
    games = [
        _game("GAME_UK_90", "FAM_AT_LAENDER_JACKPOT", "PROGRESSIVE"),
        _game("GAME_UK_91", "FAM_UK_NATIONAL_DRAW", "PROGRESSIVE"),
        _game("GAME_UK_92", "FAM_UK_FIXED_PRIZE", "FIXED"),
    ]
    first_draw = {}
    for draw in generate_draws(stream(1, "draws"), games):
        first_draw.setdefault(draw.game_id, draw.jackpot_amount)
    assert first_draw == {
        "GAME_UK_90": Decimal("20000000.00"),
        "GAME_UK_91": Decimal("400000.00"),
        "GAME_UK_92": Decimal("1000000.00"),
    }
