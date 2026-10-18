"""Scenario planting acceptance tests (docs/04 section 20, design 10a.5).

Planted ids never encode a scenario and continue each table's id sequence;
targets are drawn from the scenario seed; the truth ledger records the
chosen targets and every planted id, so tests never rely on id prefixes.
"""

from __future__ import annotations

import random
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from decimal import Decimal

import pytest
from app.datasets.config import GenerationConfig
from app.datasets.schema import ID_FORMATS
from app.datasets.taxonomies import (
    GAME_FAMILIES,
    INCIDENT_TYPES,
    MARKET_LANGUAGE,
    support_category_for,
)
from app.datasets.util import split_sentences
from app.datasets.validation import validate_world
from app.datasets.world import World, build_world
from app.scenarios.catalogue import BY_ID, ENABLED
from app.scenarios.engine import ScenarioOutcome, apply_scenarios
from app.scenarios.inject_topology import SCN002_CLUSTER_SIZE, plant_shared_device_cluster
from app.scenarios.ledger import build_ledger
from app.scenarios.planter import ScenarioPlanter

SCN007_MARKETS = {"MKT_GR", "MKT_AT", "MKT_CZ"}


def _planted_world(scenario_seed: int) -> tuple[World, dict[str, ScenarioOutcome]]:
    world = build_world(GenerationConfig(profile="tiny", world_seed=7, scenario_seed=scenario_seed))
    outcomes = apply_scenarios(world)
    return world, {outcome.spec.scenario_id: outcome for outcome in outcomes}


@pytest.fixture(scope="module")
def scenario_world() -> tuple[World, dict[str, ScenarioOutcome]]:
    return _planted_world(7)


def test_every_enabled_scenario_has_a_planter() -> None:
    from app.scenarios.plant import PLANTERS

    assert set(ENABLED) == set(PLANTERS)
    assert len(BY_ID) == 15


def test_planted_ids_do_not_encode_scenarios(scenario_world) -> None:
    _world, outcomes = scenario_world
    for outcome in outcomes.values():
        for table, ids in outcome.truth["planted_ids"].items():
            assert all("_S0" not in i for i in ids), (table, ids)


def test_planted_ids_continue_the_table_sequence(scenario_world) -> None:
    world, _outcomes = scenario_world
    incident_ids = sorted(r.incident_id for r in world.tables["incidents"])
    numbers = [int(i.split("_")[1]) for i in incident_ids]
    assert numbers == list(range(1, len(numbers) + 1))


def test_planted_ids_exist_and_are_unique(scenario_world) -> None:
    world, outcomes = scenario_world
    for table in ("incidents", "documents", "document_chunks", "sessions", "tickets"):
        ids = [row[0] for row in world.tables[table]]
        assert len(ids) == len(set(ids)), table
    for outcome in outcomes.values():
        for table, ids in outcome.truth["planted_ids"].items():
            assert len(ids) == outcome.planted_rows[table], (outcome.spec.scenario_id, table)
            assert set(ids) <= {row[0] for row in world.tables[table]}


def test_document_ids_and_chunk_ids_continue_sequences(scenario_world) -> None:
    world, _outcomes = scenario_world
    numbers = sorted(int(d.document_id.split("_")[1]) for d in world.tables["documents"])
    assert numbers == list(range(1, len(numbers) + 1))
    for chunk in world.tables["document_chunks"]:
        number = chunk.document_id.split("_")[1]
        expected = ID_FORMATS["document_chunks"].format(doc=number, n=chunk.chunk_index)
        assert chunk.chunk_id == expected


def test_scn007_documents_do_not_name_sibling_incidents(scenario_world) -> None:
    world, outcomes = scenario_world
    planted = outcomes["SCN-007"].truth["planted_ids"]
    docs = {d.document_id: d for d in world.tables["documents"]}
    gr_doc = docs[planted["documents"][0]]
    assert not any(inc in gr_doc.body for inc in planted["incidents"][1:])


def test_scenario_world_passes_validation(scenario_world) -> None:
    assert validate_world(scenario_world[0]) == []


def test_scn002_device_cluster_topology(scenario_world) -> None:
    world, outcomes = scenario_world
    outcome = outcomes["SCN-002"]
    truth = outcome.truth
    market = truth["market"]
    cluster_players = set(truth["cluster_players"])
    shared_devices = set(truth["shared_devices"])
    assert shared_devices == set(truth["planted_ids"]["devices"])
    code = next(m.market_code for m in world.tables["markets"] if m.market_id == market)
    assert all(d.startswith(f"DEV_{code}_") for d in shared_devices)

    players = {p.player_id: p for p in world.tables["players"]}
    assert all(players[p].market_id == market for p in cluster_players)

    by_player: dict[str, set[str]] = defaultdict(set)
    for link in world.tables["player_device"]:
        if link.player_id in cluster_players:
            by_player[link.player_id].add(link.device_id)
    assert all(shared_devices & devices for devices in by_player.values())

    game = next(g for g in world.tables["games"] if g.game_id == truth["game"])
    assert game.market_id == market and game.digital_enabled
    planted_ids = set(truth["planted_ids"]["tickets"])
    planted = [t for t in world.tables["tickets"] if t.ticket_id in planted_ids]
    assert len(planted) == truth["planted_ticket_count"]
    assert all(t.player_id in cluster_players for t in planted)
    assert all(
        t.game_id == game.game_id
        and t.stake_amount == game.ticket_price
        and t.currency_code == game.currency_code
        and t.channel_code == "APP"
        for t in planted
    )
    window = truth["coordination_window"]
    start = datetime.fromisoformat(window["start"])
    assert all(
        start <= t.purchase_timestamp <= start + timedelta(minutes=window["minutes"])
        for t in planted
    )


def test_scn003_payment_cluster_topology(scenario_world) -> None:
    world, outcomes = scenario_world
    truth = outcomes["SCN-003"].truth
    members = set(truth["cluster_players"])
    instruments = set(truth["shared_instruments"])

    players = {p.player_id: p for p in world.tables["players"]}
    assert all(players[p].market_id == truth["market"] for p in members)
    links = [
        link
        for link in world.tables["player_payment_method"]
        if link.player_id in members and link.payment_method_id in instruments
    ]
    assert len(links) == len(members) * len(instruments)  # complete bipartite topology
    outside = Counter(
        link.payment_method_id
        for link in world.tables["player_payment_method"]
        if link.payment_method_id in instruments and link.player_id not in members
    )
    assert all(count <= 3 for count in outside.values())


def test_scn007_cross_market_incident_pattern(scenario_world) -> None:
    world, outcomes = scenario_world
    truth = outcomes["SCN-007"].truth
    version = truth["root_cause_entity"]
    primary = truth["primary_market"]
    assert primary in SCN007_MARKETS
    assert set(truth["related_markets"]) == SCN007_MARKETS - {primary}
    assert truth["unaffected_markets"] == ["MKT_UK"]

    incidents = {i.incident_id: i for i in world.tables["incidents"]}
    planted = [incidents[i] for i in truth["planted_ids"]["incidents"]]
    assert [i.market_id for i in planted] == [primary, *truth["related_markets"]]
    assert [i.severity for i in planted] == ["HIGH", "MEDIUM", "LOW"]
    assert all(i.platform_version_id == version for i in planted)
    assert all(
        i.platform_version_id != version
        for i in world.tables["incidents"]
        if i.market_id == "MKT_UK"
    )

    # Planted signals per market, typed with the market's local taxonomy.
    sessions = set(truth["planted_ids"]["sessions"])
    cases = set(truth["planted_ids"]["support_cases"])
    for incident in planted:
        market = incident.market_id
        market_sessions = [
            s
            for s in world.tables["sessions"]
            if s.session_id in sessions and s.market_id == market
        ]
        assert len(market_sessions) >= 8
        assert all(s.session_outcome == "FAIL_PAYMENT" for s in market_sessions)
        assert incident.resolved_at is not None
        assert all(
            incident.started_at <= s.started_at < incident.resolved_at for s in market_sessions
        )
        market_cases = [
            c
            for c in world.tables["support_cases"]
            if c.support_case_id in cases and c.market_id == market
        ]
        assert len(market_cases) >= 6
        assert all(c.incident_id == incident.incident_id for c in market_cases)
        assert {c.category_code for c in market_cases} == {support_category_for(market, "PAYMENT")}


def test_scn007_documents_use_local_terms(scenario_world) -> None:
    world, outcomes = scenario_world
    truth = outcomes["SCN-007"].truth
    planted = truth["planted_ids"]
    docs = {d.document_id: d for d in world.tables["documents"]}
    incidents = {i.incident_id: i for i in world.tables["incidents"]}
    type_names = {t.incident_type_id: t.name for t in INCIDENT_TYPES}
    family_names = {f.family_id: f.name for f in GAME_FAMILIES}
    games = {g.game_id: g for g in world.tables["games"]}
    impacted: dict[str, list[str]] = defaultdict(list)
    for link in world.tables["incident_game_map"]:
        impacted[link.incident_id].append(link.game_id)

    incident_docs = [
        docs[d] for d in planted["documents"] if docs[d].document_type != "RELEASE_NOTE"
    ]
    assert len(incident_docs) == len(planted["incidents"])
    for doc, incident_id in zip(incident_docs, planted["incidents"], strict=True):
        incident = incidents[incident_id]
        assert doc.market_id == incident.market_id
        assert doc.language_code == MARKET_LANGUAGE[incident.market_id]
        assert doc.source_record_id == incident_id
        assert type_names[incident.incident_type] in doc.body
        assert any(family_names[games[g].game_family_id] in doc.body for g in impacted[incident_id])
        assert not any(other in doc.body for other in planted["incidents"] if other != incident_id)
        sentences = split_sentences(doc.body)
        assert 3 <= len(sentences) <= 5
        assert all(". " not in sentence for sentence in sentences)

    release = [docs[d] for d in planted["documents"] if docs[d].document_type == "RELEASE_NOTE"]
    assert len(release) == 1
    assert release[0].market_id == "MKT_UK" and release[0].language_code == "en"
    assert truth["root_cause_entity"] in release[0].body


def test_scn015_document_structured_conflict(scenario_world) -> None:
    world, outcomes = scenario_world
    truth = outcomes["SCN-015"].truth

    assert truth["planted_ids"]["documents"] == [truth["conflicting_document"]]
    doc = next(
        d for d in world.tables["documents"] if d.document_id == truth["conflicting_document"]
    )
    assert truth["stale_price"] < truth["authoritative_price"]
    assert f"{truth['stale_price']:.2f}" in doc.body
    assert doc.valid_to is not None  # validity window marks the document superseded

    game_id = truth["authoritative_source"].split(":")[-1]
    game = next(g for g in world.tables["games"] if g.game_id == game_id)
    assert game.draw_frequency_code != "NONE"
    assert game.ticket_price >= Decimal("1.50")
    assert float(game.ticket_price) == truth["authoritative_price"]
    assert truth["stale_price"] == round(truth["authoritative_price"] * 0.6, 2)
    assert doc.market_id == game.market_id
    assert doc.language_code == MARKET_LANGUAGE[game.market_id]
    family = next(f for f in GAME_FAMILIES if f.family_id == game.game_family_id)
    assert family.name in doc.body


def test_scn002_raises_when_no_market_is_eligible() -> None:
    """Only one market keeps digital games, and it has too few active players."""
    world = build_world(GenerationConfig(profile="tiny", world_seed=7, scenario_seed=7))
    kept = "MKT_CZ"
    tables = world.tables
    tables["games"] = [
        g if g.market_id == kept else g._replace(digital_enabled=False) for g in tables["games"]
    ]
    active = [p.player_id for p in tables["players"] if p.market_id == kept]
    too_few = set(active[: SCN002_CLUSTER_SIZE - 1])
    tables["players"] = [
        p
        if p.market_id != kept or p.player_id in too_few
        else p._replace(account_status="SUSPENDED")
        for p in tables["players"]
    ]
    plan = ScenarioPlanter(world, random.Random(7), BY_ID["SCN-002"])
    with pytest.raises(RuntimeError, match="SCN-002"):
        plant_shared_device_cluster(plan)


def test_baseline_noise_still_exists(scenario_world) -> None:
    world, outcomes = scenario_world
    planted_incidents = {
        i for o in outcomes.values() for i in o.truth["planted_ids"].get("incidents", [])
    }
    planted_docs = {
        d for o in outcomes.values() for d in o.truth["planted_ids"].get("documents", [])
    }
    baseline_incidents = [
        i for i in world.tables["incidents"] if i.incident_id not in planted_incidents
    ]
    baseline_docs = [d for d in world.tables["documents"] if d.document_id not in planted_docs]
    assert len(baseline_incidents) == 25
    assert len(baseline_docs) == 24  # tiny profile volume


def test_planted_rows_are_deterministic(scenario_world) -> None:
    world, outcomes = scenario_world
    ledger = build_ledger(list(outcomes.values()), world)
    rebuilt, rebuilt_outcomes = _planted_world(7)
    assert build_ledger(list(rebuilt_outcomes.values()), rebuilt) == ledger
    assert rebuilt.planted == world.planted
    assert rebuilt.tables == world.tables


def test_targets_depend_on_the_scenario_seed(scenario_world) -> None:
    """Design 10a.5: markets, games and clusters are drawn from the scenario seed."""
    _world, outcomes = scenario_world
    other = {seed: _planted_world(seed)[1] for seed in range(20, 32)}
    assert (
        other[20]["SCN-002"].truth["cluster_players"]
        != outcomes["SCN-002"].truth["cluster_players"]
    )
    assert len({o["SCN-007"].truth["primary_market"] for o in other.values()}) > 1
    assert len({o["SCN-015"].truth["authoritative_source"] for o in other.values()}) > 1
    assert len({o["SCN-002"].truth["market"] for o in other.values()}) > 1
    assert len({o["SCN-003"].truth["market"] for o in other.values()}) > 1
