"""Operational generators: incidents, incident-game mapping, support, experiments."""

from __future__ import annotations

import random
from datetime import datetime, time, timedelta
from typing import Any

from app.datasets.config import WINDOW_DAYS, WINDOW_START
from app.datasets.distributions import MARKET_SPLIT

_SEVERITIES = (("LOW", 0.40), ("MEDIUM", 0.35), ("HIGH", 0.20), ("CRITICAL", 0.05))

_INCIDENT_TYPE_BY_PLATFORM: dict[str, tuple[str, str]] = {
    "PLT_PAYMENTS": ("INC_PAYMENTS", "Payment provider degraded; transactions failing."),
    "PLT_APP_IOS": ("INC_APP_STABILITY", "Application crashes reported on launch."),
    "PLT_APP_ANDROID": ("INC_APP_STABILITY", "Application crashes reported during checkout."),
    "PLT_WEB": ("INC_LOGIN", "Sign-in failures for a subset of accounts."),
    "PLT_DRAW": ("INC_DRAW_DELAY", "Draw result publication delayed."),
    "PLT_RETAIL": ("INC_RETAIL_TERMINAL", "Retail terminals offline in one region."),
    "PLT_IDENTITY": ("INC_LOGIN", "Identity service latency causing timeouts."),
    "PLT_ANALYTICS": ("INC_APP_STABILITY", "Reporting pipelines delayed; no customer impact."),
}


def generate_incidents(
    rng: random.Random,
    platforms: list[tuple[Any, ...]],
    platform_versions: list[tuple[Any, ...]],
    app_versions: list[tuple[Any, ...]],
    game_rows: list[tuple[Any, ...]],
    total: int,
) -> tuple[list[tuple[Any, ...]], list[tuple[Any, ...]]]:
    """Platform incidents with version links and game impact mapping."""
    versions_by_platform: dict[str, list[tuple[Any, ...]]] = {}
    for version in platform_versions:
        versions_by_platform.setdefault(version[1], []).append(version)
    games_by_market: dict[str, list[tuple[Any, ...]]] = {}
    for game in game_rows:
        games_by_market.setdefault(game[1], []).append(game)

    incidents: list[tuple[Any, ...]] = []
    incident_games: list[tuple[Any, ...]] = []
    markets = list(MARKET_SPLIT)
    for i in range(total):
        incident_id = f"INC_{i + 1:03d}"
        cross_market = rng.random() < 0.12
        market_id: str | None = None if cross_market else f"MKT_{markets[i % len(markets)]}"
        platform = platforms[rng.randrange(len(platforms))]
        platform_id = platform[0]
        candidates = [
            v
            for v in versions_by_platform.get(platform_id, [])
            if v[3] < datetime.combine(WINDOW_START, time.min) + timedelta(days=WINDOW_DAYS - 30)
        ]
        chosen_version: tuple[Any, ...] | None = (
            candidates[rng.randrange(len(candidates))] if candidates else None
        )
        platform_version_id = chosen_version[0] if chosen_version else None
        app_version_id: str | None = None
        if platform_id in ("PLT_APP_IOS", "PLT_APP_ANDROID"):
            app_version_id = app_versions[rng.randrange(len(app_versions))][0]
        started = datetime.combine(WINDOW_START, time.min) + timedelta(
            days=rng.randrange(WINDOW_DAYS), seconds=rng.randrange(24 * 60 * 60)
        )
        resolved = (
            started + timedelta(minutes=rng.randrange(30, 60 * 72)) if rng.random() < 0.9 else None
        )
        incident_type, summary = _INCIDENT_TYPE_BY_PLATFORM[platform_id]
        severity = rng.choices([s for s, _ in _SEVERITIES], weights=[w for _, w in _SEVERITIES])[0]
        incidents.append(
            (
                incident_id,
                market_id,
                platform_id,
                platform_version_id,
                app_version_id,
                incident_type,
                severity,
                started,
                resolved,
                summary,
                f"RC_{rng.randrange(10, 99)}" if rng.random() < 0.4 else None,
            )
        )
        affected_market = market_id or f"MKT_{markets[i % len(markets)]}"
        for game in rng.sample(
            games_by_market[affected_market],
            k=min(len(games_by_market[affected_market]), rng.randrange(1, 4)),
        ):
            incident_games.append((incident_id, game[0], round(rng.uniform(0.2, 1.0), 3)))
    incidents.sort(key=lambda x: x[7])
    return incidents, incident_games


def generate_support_cases(
    rng: random.Random,
    players: list[tuple[Any, ...]],
    game_rows: list[tuple[Any, ...]],
    incidents: list[tuple[Any, ...]],
    total: int,
) -> list[tuple[Any, ...]]:
    """Support contacts, some linked to incidents and games."""
    players_by_market: dict[str, list[tuple[Any, ...]]] = {}
    for player in players:
        players_by_market.setdefault(player[1], []).append(player)
    games_by_market: dict[str, list[tuple[Any, ...]]] = {}
    for game in game_rows:
        games_by_market.setdefault(game[1], []).append(game)
    markets = list(MARKET_SPLIT)

    cases: list[tuple[Any, ...]] = []
    for i in range(total):
        market_id = f"MKT_{markets[i % len(markets)]}"
        opened = datetime.combine(WINDOW_START, time.min) + timedelta(
            days=rng.randrange(WINDOW_DAYS), seconds=rng.randrange(24 * 60 * 60)
        )
        incident: tuple[Any, ...] | None = None
        if rng.random() < 0.15 and incidents:
            candidates = [inc for inc in incidents if inc[7] <= opened]
            if candidates:
                incident = candidates[rng.randrange(len(candidates))]
        linked_player: tuple[Any, ...] | None = (
            rng.choice(players_by_market[market_id]) if rng.random() < 0.6 else None
        )
        linked_game: tuple[Any, ...] | None = (
            rng.choice(games_by_market[market_id]) if rng.random() < 0.6 else None
        )
        closed = (
            opened + timedelta(hours=rng.randrange(2, 24 * 14)) if rng.random() < 0.85 else None
        )
        sentiment_base = -0.4 if incident is not None and incident[6] == "CRITICAL" else -0.05
        sentiment = round(max(-1.0, min(1.0, rng.gauss(sentiment_base, 0.5))), 3)
        cases.append(
            (
                f"SUP_{i + 1:05d}",
                market_id,
                linked_player[0] if linked_player else None,
                linked_game[0] if linked_game else None,
                incident[0] if incident else None,
                opened,
                closed,
                rng.choice(("SUP_PAYMENT", "SUP_ACCOUNT", "SUP_GAME_QUERY", "SUP_TECHNICAL")),
                sentiment,
                "Synthetic support contact describing a player-reported issue.",
            )
        )
    cases.sort(key=lambda c: c[5])
    return cases


def generate_experiments(rng: random.Random) -> list[tuple[Any, ...]]:
    """Synthetic A/B experiments with primary metrics and outcome summaries."""
    markets = list(MARKET_SPLIT)
    names = (
        (
            "Instant tutorial overlay",
            "Tutorials lift digital instant engagement",
            "conversion_rate",
        ),
        ("Retail QR cross-sell", "QR prompts lift add-on attach rate", "conversion_rate"),
        ("Push reactivation copy", "New copy reactivates dormant players", "active_players"),
        ("Checkout one-tap", "One-tap payment lifts checkout completion", "session_completion"),
        ("Jackpot rollover banner", "Banners lift ticket sales during rollovers", "ticket_sales"),
        ("Second-chance emails", "Emails reduce complaint volume", "support_contact_rate"),
    )
    rows: list[tuple[Any, ...]] = []
    for i, (name, hypothesis, metric) in enumerate(names):
        start = datetime.combine(WINDOW_START, time.min) + timedelta(days=rng.randrange(0, 200))
        end = start + timedelta(days=rng.randrange(14, 60))
        result = rng.choice(
            (
                "POSITIVE: variant beat control.",
                "NEUTRAL: no significant lift.",
                "NEGATIVE: variant underperformed.",
            )
        )
        rows.append(
            (
                f"EXP_{i + 1:03d}",
                f"MKT_{markets[i % len(markets)]}",
                name,
                hypothesis,
                start,
                end,
                rng.choice(("SEG_ENG_ENGAGED", "SEG_ENG_CASUAL", "SEG_ENG_DORMANT")),
                metric,
                result,
            )
        )
    return rows
