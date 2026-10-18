"""World validation per docs/01-synthetic-data-spec.md section 11.

Checks: referential integrity, market/currency consistency, time-order
consistency, volume targets and provenance coverage. Deterministic
regeneration is covered by the test suite. Scenario-signal and truth-ledger
isolation checks arrive with Phase 5.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta
from typing import Any

from app.datasets.config import PROFILES, WINDOW_DAYS, WINDOW_START, GenerationConfig
from app.datasets.schema import FOREIGN_KEYS, TABLE_PROVENANCE, column_index
from app.datasets.world import World

VALUE_SEGMENTS = {"SEG_VALUE_VIP", "SEG_VALUE_MAINSTREAM", "SEG_VALUE_BUDGET"}
ENGAGEMENT_SEGMENTS = {"SEG_ENG_ENGAGED", "SEG_ENG_CASUAL", "SEG_ENG_DORMANT"}
SHARED_PAYMENT_POOL_SIZE = 80
# Task 4 populates the data behind these foreign keys; they cannot resolve until then.
_PENDING_PARENTS = frozenset(
    {"incident_types", "support_categories", "player_segments", "payment_providers"}
)
_PENDING_MASTER_MARKETS = frozenset({"game_families", "game_categories", "game_mechanics"})


def _ids(rows: list[tuple[Any, ...]], column: int = 0) -> set[str]:
    return {row[column] for row in rows if row[column] is not None}


def _index(rows: list[tuple[Any, ...]], key_column: int) -> dict[str, tuple[Any, ...]]:
    return {row[key_column]: row for row in rows if row[key_column] is not None}


def _referential_errors(tables: dict[str, list[tuple[Any, ...]]]) -> list[str]:
    """Foreign-key integrity over nullable-aware relationships."""
    errors: list[str] = []
    known_ids = {name: _ids(rows) for name, rows in tables.items()}
    known_ids["payment_methods"] |= {f"PAY_SHARED_{i:03d}" for i in range(SHARED_PAYMENT_POOL_SIZE)}
    for fk in FOREIGN_KEYS:
        if fk.parent_table in _PENDING_PARENTS or (
            fk.parent_table == "markets" and fk.child_table in _PENDING_MASTER_MARKETS
        ):
            continue
        child, parent = fk.child_table, fk.parent_table
        child_col = column_index(child, fk.child_column)
        for row in tables[child]:
            value = row[child_col]
            if value is None:
                if not fk.nullable:
                    errors.append(f"referential: {child}[{child_col}] is null but required")
                continue
            if value not in known_ids[parent]:
                errors.append(f"referential: {child}[{child_col}]={value!r} missing from {parent}")
    return errors


def _segment_errors(tables: dict[str, list[tuple[Any, ...]]]) -> list[str]:
    errors: list[str] = []
    for row in tables["players"]:
        if row[7] not in VALUE_SEGMENTS:
            errors.append(f"segment: unknown value_segment {row[7]!r}")
        if row[8] not in ENGAGEMENT_SEGMENTS:
            errors.append(f"segment: unknown engagement_segment {row[8]!r}")
    return errors


def _currency_errors(tables: dict[str, list[tuple[Any, ...]]]) -> list[str]:
    """Currency and market consistency across facts."""
    errors: list[str] = []
    market_currency = {row[0]: row[3] for row in tables["markets"]}
    game_market = {row[0]: row[1] for row in tables["games"]}

    for row in tables["games"]:
        if row[9] != market_currency.get(row[1]):
            errors.append(f"currency: game {row[0]} currency {row[9]} differs from market")
    for row in tables["tickets"]:
        expected = market_currency.get(row[3])
        if row[9] != expected:
            errors.append(
                f"currency: ticket {row[0]} currency {row[9]} differs from market {expected}"
            )
        if row[3] != game_market.get(row[2]):
            errors.append(f"market: ticket {row[0]} market differs from game market")
    for row in tables["draws"]:
        if game_market.get(row[1]) and row[4] != market_currency[game_market[row[1]]]:
            errors.append(f"currency: draw {row[0]} currency differs from game market")
    ticket_currency = {row[0]: row[9] for row in tables["tickets"]}
    for row in tables["prizes"]:
        if ticket_currency.get(row[1]) != row[4]:
            errors.append(f"currency: prize {row[0]} currency differs from ticket")
    for row in tables["campaigns"]:
        if row[7] != market_currency.get(row[1]):
            errors.append(f"currency: campaign {row[0]} currency differs from market")
    player_market = {row[0]: row[1] for row in tables["players"]}
    for row in tables["sessions"]:
        if player_market.get(row[1]) != row[2]:
            errors.append(f"market: session {row[0]} market differs from player market")
    for row in tables["campaign_exposures"]:
        campaign_market = next((c[1] for c in tables["campaigns"] if c[0] == row[1]), None)
        if campaign_market and player_market.get(row[2]) != campaign_market:
            errors.append(f"market: exposure {row[0]} player market differs from campaign market")
    return errors


def _time_errors(tables: dict[str, list[tuple[Any, ...]]], window_start: date) -> list[str]:
    """Time-order consistency: no reversed causality, no pre-launch facts."""
    errors: list[str] = []
    window_lower = datetime.combine(window_start, time.min)
    window_upper = datetime.combine(window_start + timedelta(days=WINDOW_DAYS), time.min)
    timestamp_columns = (
        ("tickets", 7),
        ("sessions", 5),
        ("draws", 2),
        ("incidents", 7),
        ("support_cases", 5),
        ("campaign_exposures", 4),
        ("documents", 5),
        ("experiments", 4),
    )
    for table, column in timestamp_columns:
        for row in tables[table]:
            if not window_lower <= row[column] < window_upper:
                errors.append(f"time: {table} {row[0]} timestamp outside generation window")
    launch = {row[0]: row[5] for row in tables["games"]}
    for row in tables["tickets"]:
        if row[7].date() < launch.get(row[2], window_start):
            errors.append(f"time: ticket {row[0]} precedes game launch")
    for row in tables["draws"]:
        if row[2].date() < launch.get(row[1], window_start):
            errors.append(f"time: draw {row[0]} precedes game launch")
    for row in tables["sessions"]:
        if row[6] <= row[5]:
            errors.append(f"time: session {row[0]} ends before it starts")
    registration = {row[0]: row[4] for row in tables["players"]}
    for row in tables["accounts"]:
        if row[2].date() < registration.get(row[1], window_start):
            errors.append(f"time: account {row[0]} created before player registration")
    for row in tables["incidents"]:
        if row[8] is not None and row[8] < row[7]:
            errors.append(f"time: incident {row[0]} resolved before start")
        if row[3]:
            version = next((v for v in tables["platform_versions"] if v[0] == row[3]), None)
            if version and row[7] < version[3]:
                errors.append(f"time: incident {row[0]} started before platform version release")
    incident_start = {row[0]: row[7] for row in tables["incidents"]}
    for row in tables["support_cases"]:
        if row[6] is not None and row[6] < row[5]:
            errors.append(f"time: support case {row[0]} closed before open")
        if row[4] and row[5] < incident_start.get(row[4], window_start):
            errors.append(f"time: support case {row[0]} opened before linked incident")
    campaign_window = {row[0]: (row[4], row[5]) for row in tables["campaigns"]}
    for row in tables["campaign_exposures"]:
        start, end = campaign_window[row[1]]
        if not start <= row[4] <= end:
            errors.append(f"time: exposure {row[0]} outside campaign window")
        if row[7] is not None and row[7] < row[4]:
            errors.append(f"time: exposure {row[0]} converted before exposure")
    return errors


def _volume_errors(world: World) -> list[str]:
    volumes = PROFILES[world.config.profile]
    expected = {
        "players": volumes.players,
        "tickets": volumes.tickets,
        "sessions": volumes.sessions,
        "campaign_exposures": volumes.campaign_exposures,
        "retailers": volumes.retailers,
        "devices": volumes.devices,
        "support_cases": volumes.support_cases,
        "documents": volumes.documents,
        "games": volumes.games_expected,
    }
    return [
        f"volume: {name} has {len(world.tables[name])} rows, expected {count}"
        for name, count in expected.items()
        if len(world.tables[name]) != count + world.planted.get(name, 0)
    ]


def _provenance_errors(world: World) -> list[str]:
    return [
        f"provenance: no source mapping for table {name}"
        for name in world.tables
        if name not in TABLE_PROVENANCE
    ]


def validate_world(world: World, config: GenerationConfig | None = None) -> list[str]:
    """Return all validation error messages; an empty list means the world is valid."""
    tables = world.tables
    errors: list[str] = []
    errors += _referential_errors(tables)
    errors += _segment_errors(tables)
    errors += _currency_errors(tables)
    errors += _time_errors(tables, WINDOW_START)
    errors += _volume_errors(world)
    errors += _provenance_errors(world)
    if config is not None and config != world.config:
        errors.append("config: validation config does not match world config")
    return errors
