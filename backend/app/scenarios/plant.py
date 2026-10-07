"""Scenario injectors (docs/04-scenario-catalogue.md).

Each injector plants one scenario's pattern into an already generated world,
using its own RNG stream so baseline tables stay stable when scenarios
change. Planted rows satisfy every docs/01 section 11 integrity rule; the
pipeline validates the combined world after injection.

Injected row ids use a scenario prefix (``*_S002_*``) that cannot collide
with baseline ids. Timestamps stay inside the generation window.
"""

from __future__ import annotations

import random
from collections import Counter
from collections.abc import Callable
from datetime import date, datetime, time, timedelta
from typing import Any

from app.datasets.config import WINDOW_START
from app.datasets.util import chunk_text, word_count
from app.datasets.world import World
from app.scenarios.catalogue import ScenarioSpec

# games tuple positions (docs/data/data-dictionary.md)
GAME_MARKET, GAME_LAUNCH, GAME_PRICE, GAME_CURRENCY, GAME_DRAW_FREQ, GAME_DIGITAL = (
    1,
    5,
    8,
    9,
    10,
    13,
)

MARKET_LANGUAGE = {"MKT_UK": "en", "MKT_GR": "el", "MKT_AT": "de", "MKT_CZ": "cs"}
SEVERITY_WEIGHT = {"HIGH": 0.9, "MEDIUM": 0.6, "LOW": 0.3}


def _at(day_offset: int, hour: int = 0, minute: int = 0) -> datetime:
    """Naive timestamp inside the generation window."""
    return datetime.combine(WINDOW_START + timedelta(days=day_offset), time(hour, minute))


def _released_on_or_before(release_moment: Any, limit: datetime) -> bool:
    """Compare a release timestamp (date or datetime) against a limit."""
    moment = (
        release_moment
        if isinstance(release_moment, datetime)
        else datetime.combine(release_moment, time.min)
    )
    return moment <= limit


class ScenarioPlanter:
    """Bundle of one outcome plus the helper lookups every injector shares."""

    def __init__(self, world: World, rng: random.Random, spec: ScenarioSpec) -> None:
        self.world = world
        self.rng = rng
        self.spec = spec
        self.tables = world.tables
        self.market_currency: dict[str, str] = {row[0]: row[3] for row in self.tables["markets"]}
        self.truth: dict[str, Any] = {}
        self.required_evidence: list[str] = []
        self.affected_markets: list[str] = []
        self.affected_games: list[str] = []
        self.start_date: date = WINDOW_START
        self.duration_days = 1
        self.planted_rows: dict[str, int] = {}

    def add(self, table: str, rows: list[tuple[Any, ...]]) -> None:
        self.tables[table].extend(rows)
        self.planted_rows[table] = self.planted_rows.get(table, 0) + len(rows)

    def players_in(self, market_id: str, count: int) -> list[tuple[Any, ...]]:
        pool = [p for p in self.tables["players"] if p[1] == market_id and p[6] == "ACTIVE"]
        if len(pool) < count:
            raise RuntimeError(
                f"scenario {self.spec.scenario_id}: not enough players in {market_id}"
            )
        return self.rng.sample(pool, count)

    def digital_games(self, market_id: str) -> list[tuple[Any, ...]]:
        return sorted(
            (g for g in self.tables["games"] if g[GAME_MARKET] == market_id and g[GAME_DIGITAL]),
            key=lambda g: g[0],
        )

    def devices_of(self, player_ids: list[str]) -> dict[str, list[str]]:
        grouped: dict[str, list[str]] = {}
        for player_id, device_id, *_ in self.tables["player_device"]:
            if player_id in player_ids:
                grouped.setdefault(player_id, []).append(device_id)
        return grouped


def plant_shared_device_cluster(plan: ScenarioPlanter) -> None:
    """SCN-002: eight accounts connected through three shared devices."""
    market = "MKT_CZ"
    members = plan.players_in(market, 8)
    member_ids = [p[0] for p in members]
    game = plan.digital_games(market)[0]

    base = _at(150, 20, 0)  # one coordinated evening
    devices: list[tuple[Any, ...]] = []
    links: list[tuple[Any, ...]] = []
    for index in range(1, 4):
        device_id = f"DEV_S002_{index:03d}"
        family = plan.rng.choice(("IOS", "ANDROID"))
        devices.append(
            (
                device_id,
                f"SCN002-SHARED-{index:02d}",
                family,
                {"IOS": "18", "ANDROID": "15"}[family],
                True,
                base - timedelta(days=30),
            )
        )
    plan.add("devices", devices)

    for player_id in member_ids:
        for device_id in plan.rng.sample([d[0] for d in devices], 2):
            links.append(
                (player_id, device_id, base - timedelta(days=30), base + timedelta(days=1), 0.2)
            )
    plan.add("player_device", links)

    tickets: list[tuple[Any, ...]] = []
    for order, player_id in enumerate(member_ids):
        moment = base + timedelta(minutes=5 * order + plan.rng.randrange(0, 4))
        for _ in range(3):
            moment += timedelta(minutes=4 + plan.rng.randrange(0, 6))
            tickets.append(
                (
                    f"TKT_S002_{plan.rng.randrange(10**6):06d}",
                    player_id,
                    game[0],
                    market,
                    None,
                    None,
                    "APP",
                    moment,
                    game[GAME_PRICE],
                    plan.market_currency[market],
                    "SETTLED",
                )
            )
    plan.add("tickets", tickets)

    plan.affected_markets = [market]
    plan.affected_games = [game[0]]
    plan.start_date = base.date()
    plan.duration_days = 1
    plan.truth = {
        "cluster_players": sorted(member_ids),
        "shared_devices": sorted(d[0] for d in devices),
        "coordination_window": {"start": base.isoformat(), "minutes": 120},
        "planted_ticket_count": len(tickets),
        "expected_interpretation": (
            "an unusual cluster worth investigation; the pattern alone does not establish fraud"
        ),
    }
    plan.required_evidence = [
        *sorted(d[0] for d in devices),
        *sorted(member_ids)[:3],
    ]


def plant_shared_payment_cluster(plan: ScenarioPlanter) -> None:
    """SCN-003: six accounts sharing two rarely used payment instruments."""
    market = "MKT_GR"
    members = plan.players_in(market, 6)
    member_ids = [p[0] for p in members]

    usage: Counter[str] = Counter(
        row[1] for row in plan.tables["player_payment_method"] if row[1].startswith("PAY_SHARED_")
    )
    instruments = sorted(usage, key=lambda key: (usage[key], key))[:2]

    base = _at(200, 9, 0)
    links: list[tuple[Any, ...]] = []
    for player_id in member_ids:
        first_used = base + timedelta(days=plan.rng.randrange(0, 7), hours=plan.rng.randrange(24))
        for instrument in instruments:
            links.append((player_id, instrument, first_used, first_used + timedelta(days=60), 0.15))
    plan.add("player_payment_method", links)

    plan.affected_markets = [market]
    plan.start_date = base.date()
    plan.duration_days = 7
    plan.truth = {
        "cluster_players": sorted(member_ids),
        "shared_instruments": sorted(instruments),
        "baseline_usage_of_instruments": dict(sorted(usage.items())),
        "expected_interpretation": (
            "a connected component of accounts over shared instruments; "
            "normal spend per account, abnormal topology"
        ),
    }
    plan.required_evidence = [*sorted(member_ids)[:3], *sorted(instruments)]


def plant_cross_market_platform_incident(plan: ScenarioPlanter) -> None:
    """SCN-007: one platform version degrades checkout in GR, AT, CZ; UK deferred."""
    market_severity = (("MKT_GR", "HIGH", 0), ("MKT_AT", "MEDIUM", 1), ("MKT_CZ", "LOW", 2))
    base = _at(140, 9, 0)

    candidates = [
        v
        for v in plan.tables["platform_versions"]
        if v[1] == "PLT_PAYMENTS" and _released_on_or_before(v[3], base - timedelta(days=30))
    ]
    if not candidates:
        raise RuntimeError("scenario SCN-007: no eligible platform version")
    version = max(candidates, key=lambda v: v[3])

    incidents: list[tuple[Any, ...]] = []
    incident_games: list[tuple[Any, ...]] = []
    support: list[tuple[Any, ...]] = []
    sessions: list[tuple[Any, ...]] = []
    documents: list[tuple[Any, ...]] = []
    chunks: list[tuple[Any, ...]] = []
    evidence_games: list[str] = []

    for market, severity, day_offset in market_severity:
        started = base + timedelta(days=day_offset, hours=plan.rng.randrange(0, 6))
        resolved = started + timedelta(days={"HIGH": 2, "MEDIUM": 1, "LOW": 0.5}[severity])
        incident_id = f"INC_S007_{market[-2:]}"
        incidents.append(
            (
                incident_id,
                market,
                "PLT_PAYMENTS",
                version[0],
                None,
                "INC_PAYMENTS",
                severity,
                started,
                resolved,
                f"Payment checkout failures on platform version {version[0]} "
                + "affecting digital checkout.",
                "RC_77",
            )
        )
        games = plan.digital_games(market)[:2]
        for game in games:
            incident_games.append(
                (incident_id, game[0], round(SEVERITY_WEIGHT[severity] * plan.spec.strength, 3))
            )
            evidence_games.append(game[0])

        case_counts = {"MKT_GR": 6, "MKT_AT": 4, "MKT_CZ": 2}
        players = plan.players_in(market, case_counts[market])
        for player in players:
            opened = started + timedelta(hours=1 + plan.rng.randrange(30))
            support.append(
                (
                    f"SPC_S007_{plan.rng.randrange(10**5):05d}",
                    market,
                    player[0],
                    None,
                    incident_id,
                    opened,
                    opened + timedelta(hours=2 + plan.rng.randrange(48)),
                    "SUP_PAYMENT",
                    round(-0.9 + plan.rng.random() * 0.3, 2),
                    f"Payment failing at checkout since {started.date().isoformat()}.",
                )
            )

        language = MARKET_LANGUAGE[market]
        body = (
            f"Incident {incident_id} was raised for payment checkout failures. "
            f"The release of platform version {version[0]} changed the checkout component. "
            + (
                "Similar symptoms are expected in INC_S007_AT and INC_S007_CZ. "
                if market == "MKT_GR"
                else ""
            )
            + "Affected cohorts could not complete digital purchases."
        )
        created = started + timedelta(days=1)
        doc_id = f"DOC_S007_{market[-2:]}"
        documents.append(
            (
                doc_id,
                "INCIDENT_REPORT",
                market,
                language,
                f"Incident Report: {incident_id}",
                created,
                created,
                None,
                "document_store",
                None,
                body,
            )
        )
        for index, chunk in enumerate(chunk_text(body)):
            chunks.append(
                (
                    f"CHNK_S007_{market[-2:]}_{index:02d}",
                    doc_id,
                    index,
                    chunk,
                    word_count(chunk),
                    None,
                )
            )

        # Planted failing sessions feed the checkout KPI degradation.
        devices_by_player = plan.devices_of([p[0] for p in players])
        market_versions = [
            a
            for a in plan.tables["app_versions"]
            if a[1] == market and _released_on_or_before(a[3], base)
        ]
        app_version = max(market_versions, key=lambda a: a[3])[0] if market_versions else None
        for _ in range({"MKT_GR": 8, "MKT_AT": 4, "MKT_CZ": 2}[market]):
            player = plan.rng.choice(players)
            device = (
                plan.rng.choice(devices_by_player[player[0]])
                if devices_by_player.get(player[0])
                else None
            )
            started_at = started + timedelta(hours=plan.rng.randrange(48))
            sessions.append(
                (
                    f"SES_S007_{plan.rng.randrange(10**6):06d}",
                    player[0],
                    market,
                    device,
                    "APP",
                    started_at,
                    started_at + timedelta(minutes=2 + plan.rng.randrange(6)),
                    app_version,
                    "FAIL_PAYMENT",
                )
            )

    # UK was never exposed: its rollout of the same version was deferred.
    uk_versions = [
        a
        for a in plan.tables["app_versions"]
        if a[1] == "MKT_UK" and _released_on_or_before(a[3], base)
    ]
    uk_app_version = max(uk_versions, key=lambda a: a[3])[0]
    uk_body = (
        f"Release {uk_app_version} defers the platform version {version[0]} update for the UK. "
        "The checkout component update is rescheduled after stability reports from other markets. "
        "UK checkout is unaffected."
    )
    uk_created = base - timedelta(days=3)
    documents.append(
        (
            "DOC_S007_UK",
            "RELEASE_NOTE",
            "MKT_UK",
            "en",
            f"Release Note: {uk_app_version} (Deferred Update)",
            uk_created,
            uk_created,
            None,
            "document_store",
            None,
            uk_body,
        )
    )
    for index, chunk in enumerate(chunk_text(uk_body)):
        chunks.append(
            (f"CHNK_S007_UK_{index:02d}", "DOC_S007_UK", index, chunk, word_count(chunk), None)
        )

    plan.add("incidents", incidents)
    plan.add("incident_game_map", incident_games)
    plan.add("support_cases", support)
    plan.add("sessions", sessions)
    plan.add("documents", documents)
    plan.add("document_chunks", chunks)

    # Reporting degradation for the most affected market (derived KPI layer).
    dip_days = {(base + timedelta(days=offset)).date() for offset in range(5)}
    kpi_rows = plan.tables["kpi_daily"]
    adjusted: list[tuple[Any, ...]] = []
    for row in kpi_rows:
        if row[1] == "MKT_GR" and row[0] in dip_days:
            if row[4] == "session_completion":
                row = (
                    row[0],
                    row[1],
                    row[2],
                    row[3],
                    row[4],
                    round(row[5] * (1 - 0.4 * plan.spec.strength), 6),
                    row[6],
                )
            elif row[4] == "payment_failure_rate":
                row = (
                    row[0],
                    row[1],
                    row[2],
                    row[3],
                    row[4],
                    min(0.95, row[5] + 0.3 * plan.spec.strength),
                    row[6],
                )
        adjusted.append(row)
    plan.tables["kpi_daily"] = adjusted

    plan.affected_markets = [market for market, _s, _o in market_severity]
    plan.affected_games = sorted(set(evidence_games))
    plan.start_date = base.date()
    plan.duration_days = 5
    plan.truth = {
        "root_cause_entity": version[0],
        "primary_market": "MKT_GR",
        "related_markets": ["MKT_AT", "MKT_CZ"],
        "unaffected_markets": ["MKT_UK"],
        "unaffected_explanation": (f"MKT_UK deferred the {version[0]} update; see DOC_S007_UK."),
        "required_path": ["INC_S007_GR", version[0], "INC_S007_AT"],
        "planted_incidents": sorted(i[0] for i in incidents),
        "kpi_effect": "session_completion down / payment_failure_rate up for MKT_GR for 5 days",
    }
    plan.required_evidence = [
        version[0],
        "INC_S007_GR",
        "INC_S007_AT",
        "INC_S007_CZ",
        "DOC_S007_GR",
        "DOC_S007_UK",
        "kpi:MKT_GR:session_completion",
    ]


def plant_document_structured_conflict(plan: ScenarioPlanter) -> None:
    """SCN-015: a superseded rules document contradicts the authoritative price."""
    game = next(g for g in plan.tables["games"] if g[0] == "GAME_UK_01")
    actual_price = float(game[GAME_PRICE])
    stale_price = round(actual_price - 1.0, 2)

    created = _at(20, 10, 0)
    body = (
        f"Game rules for GAME_UK_01 ({game[2]}). Each ticket costs GBP {stale_price:.2f} per line. "
        "This leaflet reflects the launch configuration of the product. "
        f"Product GAME_UK_01 is played twice weekly."
    )
    documents = [
        (
            "DOC_S015_UK",
            "GAME_RULES",
            "MKT_UK",
            "en",
            "Game Rules: GAME_UK_01 (Legacy Pricing)",
            created,
            created,
            created + timedelta(days=200),  # superseded well before the window ends
            "document_store",
            None,
            body,
        )
    ]
    chunks = [
        (f"CHNK_S015_UK_{index:02d}", "DOC_S015_UK", index, chunk, word_count(chunk), None)
        for index, chunk in enumerate(chunk_text(body))
    ]
    plan.add("documents", documents)
    plan.add("document_chunks", chunks)

    plan.affected_markets = ["MKT_UK"]
    plan.affected_games = [game[0]]
    plan.start_date = created.date()
    plan.duration_days = 200
    plan.truth = {
        "conflicting_document": "DOC_S015_UK",
        "stale_price": stale_price,
        "authoritative_source": "warehouse:games:GAME_UK_01",
        "authoritative_price": actual_price,
        "validity_note": "document valid_to marks it superseded within the generation window",
        "expected_behaviour": (
            "identify the conflict, prefer the structured record, and cite validity timestamps"
        ),
    }
    plan.required_evidence = ["DOC_S015_UK", "GAME_UK_01"]


_PLANTERS: dict[str, Callable[[ScenarioPlanter], None]] = {
    "SCN-002": plant_shared_device_cluster,
    "SCN-003": plant_shared_payment_cluster,
    "SCN-007": plant_cross_market_platform_incident,
    "SCN-015": plant_document_structured_conflict,
}
