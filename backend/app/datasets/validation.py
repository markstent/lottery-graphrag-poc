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
from app.datasets.schema import FOREIGN_KEYS, TABLE_PROVENANCE, primary_key
from app.datasets.world import World


def _referential_errors(tables: dict[str, list[Any]]) -> list[str]:
    """Foreign-key integrity over nullable-aware relationships."""
    errors: list[str] = []
    known_ids = {
        name: {getattr(row, primary_key(name)) for row in rows} for name, rows in tables.items()
    }
    for fk in FOREIGN_KEYS:
        child, parent = fk.child_table, fk.parent_table
        for row in tables[child]:
            value = getattr(row, fk.child_column)
            if value is None:
                if not fk.nullable:
                    errors.append(f"referential: {child}.{fk.child_column} is null but required")
                continue
            if value not in known_ids[parent]:
                errors.append(
                    f"referential: {child}.{fk.child_column}={value!r} missing from {parent}"
                )
    return errors


def _segment_errors(tables: dict[str, list[Any]]) -> list[str]:
    """Player segments must come from the segment taxonomy of the player's own market."""
    allowed: dict[tuple[str, str], set[str]] = {}
    for segment in tables["player_segments"]:
        allowed.setdefault((segment.market_id, segment.segment_kind), set()).add(segment.segment_id)
    errors: list[str] = []
    for player in tables["players"]:
        if player.value_segment not in allowed.get((player.market_id, "VALUE"), set()):
            errors.append(f"segment: unknown value_segment {player.value_segment!r}")
        if player.engagement_segment not in allowed.get((player.market_id, "ENGAGEMENT"), set()):
            errors.append(f"segment: unknown engagement_segment {player.engagement_segment!r}")
    return errors


def _currency_errors(tables: dict[str, list[Any]]) -> list[str]:
    """Currency and market consistency across facts."""
    errors: list[str] = []
    market_currency = {m.market_id: m.currency_code for m in tables["markets"]}
    game_market = {g.game_id: g.market_id for g in tables["games"]}

    for game in tables["games"]:
        if game.currency_code != market_currency.get(game.market_id):
            errors.append(
                f"currency: game {game.game_id} currency {game.currency_code} differs from market"
            )
    for ticket in tables["tickets"]:
        expected = market_currency.get(ticket.market_id)
        if ticket.currency_code != expected:
            errors.append(
                f"currency: ticket {ticket.ticket_id} currency {ticket.currency_code} "
                f"differs from market {expected}"
            )
        if ticket.market_id != game_market.get(ticket.game_id):
            errors.append(f"market: ticket {ticket.ticket_id} market differs from game market")
    for draw in tables["draws"]:
        market = game_market.get(draw.game_id)
        if market and draw.currency_code != market_currency[market]:
            errors.append(f"currency: draw {draw.draw_id} currency differs from game market")
    ticket_currency = {t.ticket_id: t.currency_code for t in tables["tickets"]}
    for prize in tables["prizes"]:
        if ticket_currency.get(prize.ticket_id) != prize.currency_code:
            errors.append(f"currency: prize {prize.prize_id} currency differs from ticket")
    for campaign in tables["campaigns"]:
        if campaign.currency_code != market_currency.get(campaign.market_id):
            errors.append(f"currency: campaign {campaign.campaign_id} currency differs from market")
    player_market = {p.player_id: p.market_id for p in tables["players"]}
    for session in tables["sessions"]:
        if player_market.get(session.player_id) != session.market_id:
            errors.append(f"market: session {session.session_id} market differs from player market")
    campaign_market = {c.campaign_id: c.market_id for c in tables["campaigns"]}
    for exposure in tables["campaign_exposures"]:
        market = campaign_market.get(exposure.campaign_id)
        if market and player_market.get(exposure.player_id) != market:
            errors.append(
                f"market: exposure {exposure.exposure_id} player market differs "
                "from campaign market"
            )
    return errors


# Timestamp column per table that must fall inside the generation window.
_WINDOWED_TIMESTAMPS = (
    ("tickets", "purchase_timestamp"),
    ("sessions", "started_at"),
    ("draws", "draw_timestamp"),
    ("incidents", "started_at"),
    ("support_cases", "opened_at"),
    ("campaign_exposures", "exposed_at"),
    ("documents", "created_at"),
    ("experiments", "start_at"),
)


def _time_errors(tables: dict[str, list[Any]], window_start: date) -> list[str]:
    """Time-order consistency: no reversed causality, no pre-launch facts."""
    errors: list[str] = []
    window_lower = datetime.combine(window_start, time.min)
    window_upper = datetime.combine(window_start + timedelta(days=WINDOW_DAYS), time.min)
    for table, column in _WINDOWED_TIMESTAMPS:
        for row in tables[table]:
            if not window_lower <= getattr(row, column) < window_upper:
                row_id = getattr(row, primary_key(table))
                errors.append(f"time: {table} {row_id} timestamp outside generation window")
    launch = {g.game_id: g.launch_date for g in tables["games"]}
    for ticket in tables["tickets"]:
        if ticket.purchase_timestamp.date() < launch.get(ticket.game_id, window_start):
            errors.append(f"time: ticket {ticket.ticket_id} precedes game launch")
    for draw in tables["draws"]:
        if draw.draw_timestamp.date() < launch.get(draw.game_id, window_start):
            errors.append(f"time: draw {draw.draw_id} precedes game launch")
    app_release = {v.app_version_id: v.released_at for v in tables["app_versions"]}
    for session in tables["sessions"]:
        if session.ended_at is not None and session.ended_at <= session.started_at:
            errors.append(f"time: session {session.session_id} ends before it starts")
        if session.app_version_id and session.started_at < app_release[session.app_version_id]:
            errors.append(
                f"time: session {session.session_id} runs an app version released after it started"
            )
    registration = {p.player_id: p.registration_date for p in tables["players"]}
    for account in tables["accounts"]:
        if account.created_at.date() < registration.get(account.player_id, window_start):
            errors.append(f"time: account {account.account_id} created before player registration")
    release = {v.platform_version_id: v.released_at for v in tables["platform_versions"]}
    for incident in tables["incidents"]:
        if incident.resolved_at is not None and incident.resolved_at < incident.started_at:
            errors.append(f"time: incident {incident.incident_id} resolved before start")
        released = (
            release.get(incident.platform_version_id) if incident.platform_version_id else None
        )
        if released and incident.started_at < released:
            errors.append(
                f"time: incident {incident.incident_id} started before platform version release"
            )
    app_versions = {v.app_version_id: v for v in tables["app_versions"]}
    for incident in tables["incidents"]:
        app_version = app_versions.get(incident.app_version_id or "")
        if app_version is None:
            continue
        if incident.started_at < app_version.released_at:
            errors.append(
                f"time: incident {incident.incident_id} references an app version "
                "released after it started"
            )
        if incident.market_id is not None and app_version.market_id != incident.market_id:
            errors.append(
                f"market: incident {incident.incident_id} app version belongs to another market"
            )
    incident_start = {i.incident_id: i.started_at for i in tables["incidents"]}
    for case in tables["support_cases"]:
        if case.closed_at is not None and case.closed_at < case.opened_at:
            errors.append(f"time: support case {case.support_case_id} closed before open")
        if case.incident_id and case.opened_at < incident_start.get(case.incident_id, window_lower):
            errors.append(
                f"time: support case {case.support_case_id} opened before linked incident"
            )
    campaign_window = {c.campaign_id: (c.start_at, c.end_at) for c in tables["campaigns"]}
    for exposure in tables["campaign_exposures"]:
        start, end = campaign_window[exposure.campaign_id]
        if not start <= exposure.exposed_at <= end:
            errors.append(f"time: exposure {exposure.exposure_id} outside campaign window")
        if exposure.converted_at is not None and exposure.converted_at < exposure.exposed_at:
            errors.append(f"time: exposure {exposure.exposure_id} converted before exposure")
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
