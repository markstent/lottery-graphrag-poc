"""Scenario acceptance tests (docs/04 section 20).

For every enabled scenario: the expected signals exist in the generated
world, the truth ledger matches the planted rows, unrelated baseline noise
still exists, and regeneration with identical seeds reproduces identical
planted content.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timedelta

import pytest
from app.datasets.config import GenerationConfig
from app.datasets.validation import validate_world
from app.datasets.world import build_world
from app.scenarios.catalogue import BY_ID, ENABLED
from app.scenarios.engine import apply_scenarios
from app.scenarios.ledger import build_ledger


@pytest.fixture(scope="module")
def scenario_world():
    world = build_world(GenerationConfig(profile="tiny", world_seed=7, scenario_seed=7))
    outcomes = apply_scenarios(world)
    return world, {outcome.spec.scenario_id: outcome for outcome in outcomes}


def test_all_catalogue_scenarios_have_injectors_or_are_disabled() -> None:
    """Every enabled scenario is implemented; nothing is enabled by accident."""
    from app.scenarios.plant import _PLANTERS

    assert set(ENABLED) == set(_PLANTERS)
    assert len(BY_ID) == 15


def test_scenario_world_passes_validation(scenario_world) -> None:
    """Planted rows satisfy every integrity rule (docs/01 section 11)."""
    world, _outcomes = scenario_world
    assert validate_world(world) == []


def test_scn002_device_cluster_topology(scenario_world) -> None:
    world, outcomes = scenario_world
    outcome = outcomes["SCN-002"]
    cluster_players = set(outcome.truth["cluster_players"])
    shared_devices = set(outcome.truth["shared_devices"])

    # Every pair of cluster members shares at least one planted device.
    by_player: dict[str, set[str]] = defaultdict(set)
    for player_id, device_id, *_ in world.tables["player_device"]:
        if player_id in cluster_players:
            by_player[player_id].add(device_id)
    assert all(shared_devices & devices for devices in by_player.values())

    # Coordinated tickets exist inside the planted window for the cluster game.
    planted = [
        t
        for t in world.tables["tickets"]
        if t[1] in cluster_players and t[0].startswith("TKT_S002")
    ]
    assert len(planted) == outcome.truth["planted_ticket_count"]
    moments = [t[7] for t in planted]
    window = outcome.truth["coordination_window"]
    start = datetime.fromisoformat(window["start"])
    assert all(
        start <= moment <= start + timedelta(minutes=window["minutes"]) for moment in moments
    )


def test_scn003_payment_cluster_topology(scenario_world) -> None:
    world, outcomes = scenario_world
    outcome = outcomes["SCN-003"]
    members = set(outcome.truth["cluster_players"])
    instruments = set(outcome.truth["shared_instruments"])

    links = [
        (row[0], row[1])
        for row in world.tables["player_payment_method"]
        if row[0] in members and row[1] in instruments
    ]
    assert len(links) == len(members) * len(instruments)  # complete bipartite topology
    # Outside the cluster, those instruments keep only their sparse baseline use.
    outside = Counter(
        row[1]
        for row in world.tables["player_payment_method"]
        if row[1] in instruments and row[0] not in members
    )
    assert all(count <= 3 for count in outside.values())


def test_scn007_cross_market_incident_pattern(scenario_world) -> None:
    world, outcomes = scenario_world
    outcome = outcomes["SCN-007"]
    truth = outcome.truth
    version = truth["root_cause_entity"]

    planted = {row[0]: row for row in world.tables["incidents"] if row[0].startswith("INC_S007")}
    assert set(planted) == set(truth["planted_incidents"])
    assert planted["INC_S007_GR"][6] == "HIGH"
    assert planted["INC_S007_AT"][6] == "MEDIUM"
    assert planted["INC_S007_CZ"][6] == "LOW"
    assert all(row[3] == version for row in planted.values())

    # No UK incident on the shared version: the UK rollout was deferred.
    uk = [row for row in world.tables["incidents"] if row[1] == "MKT_UK"]
    assert all(row[3] != version for row in uk)

    # Release/deferral and incident documents exist with local languages.
    docs = {row[0]: row for row in world.tables["documents"] if row[0].startswith("DOC_S007")}
    assert docs["DOC_S007_GR"][3] == "el"
    assert docs["DOC_S007_AT"][3] == "de"
    assert docs["DOC_S007_CZ"][3] == "cs"
    assert docs["DOC_S007_UK"][3] == "en"
    assert version in docs["DOC_S007_UK"][10]  # deferral mentions the shared version

    # Exact diff against the deterministic baseline: only GR checkout KPI
    # rows inside the dip window changed, nothing else.
    baseline = build_world(GenerationConfig(profile="tiny", world_seed=7, scenario_seed=7))
    expected_dip = {outcome.start_date + timedelta(days=o) for o in range(outcome.duration_days)}
    changed = [
        (base_row, planted_row)
        for base_row, planted_row in zip(
            baseline.tables["kpi_daily"], world.tables["kpi_daily"], strict=True
        )
        if base_row != planted_row
    ]
    assert changed
    assert all(
        row[1] == "MKT_GR"
        and row[0] in expected_dip
        and row[4] in ("session_completion", "payment_failure_rate")
        for row, _ in changed
    )
    factor = 1 - 0.4 * BY_ID["SCN-007"].strength
    assert all(
        abs(base_row[5] * factor - planted_row[5]) < 1e-6
        for base_row, planted_row in changed
        if planted_row[4] == "session_completion"
    )


def test_scn015_document_structured_conflict(scenario_world) -> None:
    world, outcomes = scenario_world
    outcome = outcomes["SCN-015"]
    truth = outcome.truth

    doc = next(row for row in world.tables["documents"] if row[0] == truth["conflicting_document"])
    assert truth["stale_price"] < truth["authoritative_price"]
    assert f"{truth['stale_price']:.2f}" in doc[10]
    assert doc[7] is not None  # validity window marks the document superseded

    game = next(row for row in world.tables["games"] if row[0] == "GAME_UK_01")
    assert float(game[8]) == truth["authoritative_price"]


def test_baseline_noise_still_exists(scenario_world) -> None:
    """Scenarios add to the world; the unrelated baseline remains intact."""
    world, _outcomes = scenario_world
    baseline_incidents = [
        row for row in world.tables["incidents"] if not row[0].startswith("INC_S")
    ]
    assert len(baseline_incidents) == 25
    baseline_docs = [row for row in world.tables["documents"] if not row[0].startswith("DOC_S")]
    assert len(baseline_docs) == 24  # tiny profile volume


def test_planted_rows_are_deterministic(scenario_world) -> None:
    """Same seeds reproduce identical planted content and identical ledger."""
    world, outcomes = scenario_world
    ledger = build_ledger(list(outcomes.values()), world)

    rebuilt = build_world(GenerationConfig(profile="tiny", world_seed=7, scenario_seed=7))
    rebuilt_outcomes = apply_scenarios(rebuilt)
    assert build_ledger(rebuilt_outcomes, rebuilt) == ledger
    assert rebuilt.planted == world.planted

    other_seed = build_world(GenerationConfig(profile="tiny", world_seed=7, scenario_seed=99))
    other_outcomes = apply_scenarios(other_seed)
    other_by_id = {outcome.spec.scenario_id: outcome for outcome in other_outcomes}
    assert (
        other_by_id["SCN-002"].truth["cluster_players"]
        != outcomes["SCN-002"].truth["cluster_players"]
    )


def test_scenario_seed_changes_cluster_membership(scenario_world) -> None:
    """Seed sensitivity: a different scenario seed plants a different cluster."""
    world, outcomes = scenario_world
    assert world.config.scenario_seed == 7
    assert outcomes["SCN-003"].truth["cluster_players"]
