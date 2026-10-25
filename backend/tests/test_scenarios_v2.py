"""Scenario planting acceptance tests (docs/reference/04 section 20, design 10a.5).

Planted ids never encode a scenario and continue each table's id sequence;
targets are drawn from the scenario seed; the truth ledger records the
chosen targets and every planted id, so tests never rely on id prefixes.
"""

from __future__ import annotations

import random
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal

import pytest
from app.datasets.config import GenerationConfig
from app.datasets.rows import KpiDailyRow, TicketRow
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

ScenarioWorld = tuple[World, dict[str, ScenarioOutcome]]


def _planted_world(scenario_seed: int) -> ScenarioWorld:
    world = build_world(GenerationConfig(profile="tiny", world_seed=7, scenario_seed=scenario_seed))
    outcomes = apply_scenarios(world)
    return world, {outcome.spec.scenario_id: outcome for outcome in outcomes}


@pytest.fixture(scope="module")
def scenario_world() -> ScenarioWorld:
    return _planted_world(7)


def test_every_enabled_scenario_has_a_planter() -> None:
    from app.scenarios.plant import PLANTERS

    assert set(ENABLED) == set(PLANTERS)
    assert len(BY_ID) == 15


def test_planted_ids_do_not_encode_scenarios(scenario_world: ScenarioWorld) -> None:
    _world, outcomes = scenario_world
    for outcome in outcomes.values():
        for table, ids in outcome.truth["planted_ids"].items():
            assert all("_S0" not in i for i in ids), (table, ids)


def test_planted_ids_continue_the_table_sequence(scenario_world: ScenarioWorld) -> None:
    world, _outcomes = scenario_world
    incident_ids = sorted(r.incident_id for r in world.tables["incidents"])
    numbers = [int(i.split("_")[1]) for i in incident_ids]
    assert numbers == list(range(1, len(numbers) + 1))


def test_planted_ids_exist_and_are_unique(scenario_world: ScenarioWorld) -> None:
    world, outcomes = scenario_world
    for table in ("incidents", "documents", "document_chunks", "sessions", "tickets"):
        ids = [row[0] for row in world.tables[table]]
        assert len(ids) == len(set(ids)), table
    for outcome in outcomes.values():
        for table, ids in outcome.truth["planted_ids"].items():
            assert len(ids) == outcome.planted_rows[table], (outcome.spec.scenario_id, table)
            assert set(ids) <= {row[0] for row in world.tables[table]}


def test_document_ids_and_chunk_ids_continue_sequences(scenario_world: ScenarioWorld) -> None:
    world, _outcomes = scenario_world
    numbers = sorted(int(d.document_id.split("_")[1]) for d in world.tables["documents"])
    assert numbers == list(range(1, len(numbers) + 1))
    for chunk in world.tables["document_chunks"]:
        number = chunk.document_id.split("_")[1]
        expected = ID_FORMATS["document_chunks"].format(doc=number, n=chunk.chunk_index)
        assert chunk.chunk_id == expected


def test_scn007_documents_do_not_name_sibling_incidents(scenario_world: ScenarioWorld) -> None:
    world, outcomes = scenario_world
    planted = outcomes["SCN-007"].truth["planted_ids"]
    docs = {d.document_id: d for d in world.tables["documents"]}
    gr_doc = docs[planted["documents"][0]]
    assert not any(inc in gr_doc.body for inc in planted["incidents"][1:])


def test_scenario_world_passes_validation(scenario_world: ScenarioWorld) -> None:
    assert validate_world(scenario_world[0]) == []


def test_scn002_device_cluster_topology(scenario_world: ScenarioWorld) -> None:
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


def test_scn003_payment_cluster_topology(scenario_world: ScenarioWorld) -> None:
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


def test_scn007_cross_market_incident_pattern(scenario_world: ScenarioWorld) -> None:
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


def test_scn007_documents_use_local_terms(scenario_world: ScenarioWorld) -> None:
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


def test_scn015_document_structured_conflict(scenario_world: ScenarioWorld) -> None:
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


def test_baseline_noise_still_exists(scenario_world: ScenarioWorld) -> None:
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


def test_planted_rows_are_deterministic(scenario_world: ScenarioWorld) -> None:
    world, outcomes = scenario_world
    ledger = build_ledger(list(outcomes.values()), world)
    rebuilt, rebuilt_outcomes = _planted_world(7)
    assert build_ledger(list(rebuilt_outcomes.values()), rebuilt) == ledger
    assert rebuilt.planted == world.planted
    assert rebuilt.tables == world.tables


def test_targets_depend_on_the_scenario_seed(scenario_world: ScenarioWorld) -> None:
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
    assert len({o["SCN-010"].truth["mechanic_concept"] for o in other.values()}) > 1
    assert len({o["SCN-011"].truth["target_market"] for o in other.values()}) > 1


def test_scn007_depresses_gr_session_completion_without_manual_edits(
    scenario_world: ScenarioWorld,
) -> None:
    world, outcomes = scenario_world
    outcome = outcomes["SCN-007"]
    market = outcome.truth["primary_market"]
    baseline = build_world(GenerationConfig(profile="tiny", world_seed=7, scenario_seed=7))
    dip_days = {outcome.start_date + timedelta(days=o) for o in range(outcome.duration_days)}

    def completion(table: list[KpiDailyRow], days: set[date] | None = None) -> dict[date, float]:
        return {
            row.date: row.metric_value
            for row in table
            if row.market_id == market
            and row.metric_code == "session_completion"
            and (days is None or row.date in days)
        }

    before = completion(baseline.tables["kpi_daily"])
    during = completion(world.tables["kpi_daily"], dip_days)
    assert len(during) >= 2
    assert sum(during.values()) / len(during) <= 0.85 * (sum(before.values()) / len(before))


def test_manifest_row_counts_match_tables_after_planting(scenario_world: ScenarioWorld) -> None:
    world, _outcomes = scenario_world
    assert world.manifest["row_counts"] == {name: len(rows) for name, rows in world.tables.items()}


def test_scn001_cohort_sessions_are_on_the_release_and_device_family(
    scenario_world: ScenarioWorld,
) -> None:
    world, outcomes = scenario_world
    truth = outcomes["SCN-001"].truth
    devices = {d.device_id: d for d in world.tables["devices"]}
    planted_ids = set(truth["planted_ids"]["sessions"])
    planted = [s for s in world.tables["sessions"] if s.session_id in planted_ids]
    assert planted and all(s.app_version_id == truth["app_version_id"] for s in planted)
    assert all(s.market_id == truth["market"] for s in planted)
    assert all(devices[s.device_id].device_family == truth["device_family"] for s in planted)


def test_scn009_failures_share_one_provider_across_three_markets(
    scenario_world: ScenarioWorld,
) -> None:
    world, outcomes = scenario_world
    truth = outcomes["SCN-009"].truth
    method_provider = {m.payment_method_id: m.provider_id for m in world.tables["payment_methods"]}
    player_providers: dict[str, set[str]] = defaultdict(set)
    for link in world.tables["player_payment_method"]:
        player_providers[link.player_id].add(method_provider[link.payment_method_id])
    planted_ids = set(truth["planted_ids"]["sessions"])
    planted = [s for s in world.tables["sessions"] if s.session_id in planted_ids]
    assert len(truth["affected_markets"]) == 3
    assert {s.market_id for s in planted} == set(truth["affected_markets"])
    assert all(truth["provider_id"] in player_providers[s.player_id] for s in planted)
    assert all(s.session_outcome == "FAIL_PAYMENT" for s in planted)


def test_scenarios_fail_loudly_when_the_world_is_too_small() -> None:
    from app.datasets.config import PROFILES, ProfileVolumes

    PROFILES["micro"] = ProfileVolumes(12, 100, 50, 50, 8, 12, 6, 6, 20, 25, 3, 6)
    try:
        world = build_world(GenerationConfig(profile="micro", world_seed=1, scenario_seed=1))
        with pytest.raises(RuntimeError, match="SCN-"):
            apply_scenarios(world)
    finally:
        del PROFILES["micro"]


def test_scn001_documents_and_contacts_use_the_market_language(
    scenario_world: ScenarioWorld,
) -> None:
    world, outcomes = scenario_world
    truth = outcomes["SCN-001"].truth
    market = truth["market"]
    docs = {d.document_id: d for d in world.tables["documents"]}
    incident = next(i for i in world.tables["incidents"] if i.incident_id == truth["incident_id"])
    version = next(
        v for v in world.tables["app_versions"] if v.app_version_id == truth["app_version_id"]
    )
    note, report = docs[truth["release_note_id"]], docs[truth["incident_report_id"]]
    assert note.document_type == "RELEASE_NOTE" and report.document_type == "INCIDENT_REPORT"
    assert {note.language_code, report.language_code} == {MARKET_LANGUAGE[market]}
    assert truth["app_version_id"] in note.body
    assert truth["incident_id"] in report.body
    assert {t.incident_type_id: t.name for t in INCIDENT_TYPES}[
        incident.incident_type
    ] in report.body
    assert incident.app_version_id == truth["app_version_id"]
    assert incident.platform_version_id is None and incident.severity == "HIGH"
    for doc in (note, report):
        assert all(". " not in sentence for sentence in split_sentences(doc.body))
    planted = set(truth["planted_ids"]["support_cases"])
    cases = [c for c in world.tables["support_cases"] if c.support_case_id in planted]
    assert cases and all(version.version_label in c.summary_text for c in cases)
    assert {c.category_code for c in cases} == {support_category_for(market, "TECHNICAL")}


def test_scn009_contacts_do_not_name_the_provider(scenario_world: ScenarioWorld) -> None:
    from app.datasets.taxonomies import PAYMENT_PROVIDERS

    world, outcomes = scenario_world
    truth = outcomes["SCN-009"].truth
    provider = next(p for p in PAYMENT_PROVIDERS if p.provider_id == truth["provider_id"])
    planted = truth["planted_ids"]
    cases = [
        c for c in world.tables["support_cases"] if c.support_case_id in planted["support_cases"]
    ]
    assert {c.market_id for c in cases} == set(truth["affected_markets"])
    for case in cases:
        assert provider.provider_id not in case.summary_text
        assert provider.name not in case.summary_text
        assert case.category_code == support_category_for(case.market_id, "PAYMENT")
    assert "incidents" not in planted
    (review_id,) = planted["documents"]
    review = next(d for d in world.tables["documents"] if d.document_id == review_id)
    assert review.document_type == "POST_INCIDENT_REVIEW" and review.market_id is None
    assert provider.provider_id in review.body
    assert all(market in review.body for market in truth["affected_markets"])


def test_scn010_uses_three_local_mechanic_codes_for_one_concept(
    scenario_world: ScenarioWorld,
) -> None:
    from app.ontology.loader import load_ontology

    _world, outcomes = scenario_world
    truth = outcomes["SCN-010"].truth
    onto = load_ontology()
    codes = {m["mechanic_code"] for m in truth["per_market"].values()}
    assert len(codes) == 3
    assert {onto.concept_for("mechanic", c) for c in codes} == {truth["mechanic_concept"]}


def test_scn010_documents_are_local_language_and_name_only(scenario_world: ScenarioWorld) -> None:
    world, outcomes = scenario_world
    truth = outcomes["SCN-010"].truth
    docs = {d.document_id: d for d in world.tables["documents"]}
    for market, detail in truth["per_market"].items():
        doc = docs[detail["document_id"]]
        assert doc.language_code == MARKET_LANGUAGE[market]
        assert detail["game_id"] not in doc.body
        assert detail["game_id"] not in doc.title
        assert doc.source_record_id == ""


def test_scn011_source_campaign_outperforms_baseline(scenario_world: ScenarioWorld) -> None:
    world, outcomes = scenario_world
    truth = outcomes["SCN-011"].truth
    rows = [
        e
        for e in world.tables["campaign_exposures"]
        if e.campaign_id == truth["source_campaign_id"]
    ]
    engaged = [e for e in rows if e.engaged]
    assert len(engaged) / len(rows) >= 0.6
    converted = sum(1 for e in engaged if e.converted_game_id == truth["source_game_id"])
    assert converted / len(engaged) >= 0.4


def test_no_planted_row_contains_a_concept_id(scenario_world: ScenarioWorld) -> None:
    world, _ = scenario_world
    for table, rows in world.tables.items():
        for row in rows:
            assert "CONCEPT_" not in " ".join(str(v) for v in row), table


def test_scn010_control_and_scn011_target_get_no_planted_rows(
    scenario_world: ScenarioWorld,
) -> None:
    world, outcomes = scenario_world
    affinity, campaign = outcomes["SCN-010"].truth, outcomes["SCN-011"].truth
    assert affinity["control_market"] not in affinity["per_market"]
    planted_tickets = set(affinity["planted_ids"]["tickets"])
    tickets = [t for t in world.tables["tickets"] if t.ticket_id in planted_tickets]
    assert {t.market_id for t in tickets} == set(affinity["per_market"])
    for market, detail in affinity["per_market"].items():
        mine = [t for t in tickets if t.market_id == market]
        assert len(mine) == detail["planted_ticket_count"]
        assert {t.game_id for t in mine} == {detail["game_id"]}
    planted_docs = set(campaign["planted_ids"]["documents"])
    docs = [d for d in world.tables["documents"] if d.document_id in planted_docs]
    assert {d.market_id for d in docs} == {campaign["source_market"]}
    assert campaign["target_market"] != campaign["source_market"]
    assert set(campaign["planted_ids"]) == {
        "campaigns",
        "campaign_exposures",
        "documents",
        "document_chunks",
    }


def _engaged_share(tickets: list[TicketRow], segment_of: dict[str, str], segment: str) -> float:
    identified = [t.player_id for t in tickets if t.player_id is not None]
    return sum(1 for player in identified if segment_of[player] == segment) / len(identified)


@pytest.mark.parametrize("scenario_seed", [7, 11, 23])
def test_scn010_engaged_segment_over_indexes_on_the_planted_game(scenario_seed: int) -> None:
    from app.scenarios.inject_ontology import SCN010_MECHANICS

    world, outcomes = _planted_world(scenario_seed)
    truth = outcomes["SCN-010"].truth
    segment_of = {p.player_id: p.engagement_segment for p in world.tables["players"]}
    for market, detail in truth["per_market"].items():
        market_tickets = [t for t in world.tables["tickets"] if t.market_id == market]
        game_tickets = [t for t in market_tickets if t.game_id == detail["game_id"]]
        game_share = _engaged_share(game_tickets, segment_of, detail["segment_id"])
        market_share = _engaged_share(market_tickets, segment_of, detail["segment_id"])
        assert game_share - market_share >= 0.10, (market, game_share, market_share)

    control = truth["control_market"]
    (local_codes,) = (
        codes
        for concept, codes in SCN010_MECHANICS.values()
        if concept == truth["mechanic_concept"]
    )
    mechanic = local_codes[control.removeprefix("MKT_")]
    games = {
        link.game_id for link in world.tables["game_mechanic_map"] if link.mechanic_id == mechanic
    }
    baseline = build_world(
        GenerationConfig(profile="tiny", world_seed=7, scenario_seed=scenario_seed)
    )
    for game_id in games:
        planted = sum(1 for t in world.tables["tickets"] if t.game_id == game_id)
        unplanted = sum(1 for t in baseline.tables["tickets"] if t.game_id == game_id)
        assert planted == unplanted, (control, game_id)
