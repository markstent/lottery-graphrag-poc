"""Operational generators: incidents, incident-game mapping, support, experiments."""

from __future__ import annotations

import random
from datetime import datetime, time, timedelta

from app.datasets.config import WINDOW_DAYS, WINDOW_START
from app.datasets.distributions import (
    CROSS_MARKET_INCIDENT_SHARE,
    INCIDENT_RESOLVED_SHARE,
    INCIDENT_ROOT_CAUSE_SHARE,
    MARKET_SPLIT,
    SEVERITY_WEIGHTS,
    SUPPORT_CLOSED_SHARE,
    SUPPORT_GAME_LINK_SHARE,
    SUPPORT_INCIDENT_LINK_SHARE,
    SUPPORT_PLAYER_LINK_SHARE,
)
from app.datasets.rows import (
    AppVersionRow,
    ExperimentRow,
    GameRow,
    IncidentGameMapRow,
    IncidentRow,
    PlatformRow,
    PlatformVersionRow,
    PlayerRow,
    SupportCaseRow,
)
from app.datasets.schema import ID_FORMATS
from app.datasets.taxonomies import incident_type_for, segments_for, support_category_for

_WINDOW_START_TS = datetime.combine(WINDOW_START, time.min)
_MARKET_CODES = list(MARKET_SPLIT)

# Canonical incident kind and English summary per platform.
_INCIDENT_BY_PLATFORM: dict[str, tuple[str, str]] = {
    "PLT_PAYMENTS": ("PAYMENT", "Payment provider degraded; transactions failing."),
    "PLT_APP_IOS": ("APPLICATION", "Application crashes reported on launch."),
    "PLT_APP_ANDROID": ("APPLICATION", "Application crashes reported during checkout."),
    "PLT_WEB": ("IDENTITY", "Sign-in failures for a subset of accounts."),
    "PLT_DRAW": ("DRAW", "Draw result publication delayed."),
    "PLT_RETAIL": ("RETAIL", "Retail terminals offline in one region."),
    "PLT_IDENTITY": ("IDENTITY", "Identity service latency causing timeouts."),
    "PLT_ANALYTICS": ("APPLICATION", "Reporting pipelines delayed; no customer impact."),
}
_APP_PLATFORMS = ("PLT_APP_IOS", "PLT_APP_ANDROID")
_SUPPORT_KINDS = ("PAYMENT", "ACCOUNT", "GAME", "TECHNICAL")

# Experiment name, hypothesis and primary metric; cycled to the requested volume.
_EXPERIMENTS = (
    ("Instant tutorial overlay", "Tutorials lift digital instant engagement", "conversion_rate"),
    ("Retail QR cross-sell", "QR prompts lift add-on attach rate", "conversion_rate"),
    ("Push reactivation copy", "New copy reactivates dormant players", "active_players"),
    ("Checkout one-tap", "One-tap payment lifts checkout completion", "session_completion"),
    ("Jackpot rollover banner", "Banners lift ticket sales during rollovers", "ticket_sales"),
    ("Second-chance emails", "Emails reduce complaint volume", "support_contact_rate"),
)
_EXPERIMENT_RESULTS = (
    "POSITIVE: variant beat control.",
    "NEUTRAL: no significant lift.",
    "NEGATIVE: variant underperformed.",
)


def generate_incidents(
    rng: random.Random,
    platforms: list[PlatformRow],
    platform_versions: list[PlatformVersionRow],
    app_versions: list[AppVersionRow],
    games: list[GameRow],
    total: int,
) -> tuple[list[IncidentRow], list[IncidentGameMapRow]]:
    """Platform incidents with version links and game impact mapping.

    An app-platform incident references an app version released on or before its
    start, from its own market (any market for a corporate incident). When none
    qualifies the link is None and no random draw is consumed.
    """
    versions_by_platform: dict[str, list[PlatformVersionRow]] = {}
    for version in platform_versions:
        versions_by_platform.setdefault(version.platform_id, []).append(version)
    games_by_market: dict[str, list[GameRow]] = {}
    for game in games:
        games_by_market.setdefault(game.market_id, []).append(game)
    severities = [severity for severity, _ in SEVERITY_WEIGHTS]
    severity_weights = [weight for _, weight in SEVERITY_WEIGHTS]
    version_label = {v.platform_version_id: v.version_label for v in platform_versions}
    version_cutoff = _WINDOW_START_TS + timedelta(days=WINDOW_DAYS - 30)

    incidents: list[IncidentRow] = []
    incident_games: list[IncidentGameMapRow] = []
    for i in range(total):
        incident_id = ID_FORMATS["incidents"].format(n=i + 1)
        home_market = f"MKT_{_MARKET_CODES[i % len(_MARKET_CODES)]}"
        market_id = None if rng.random() < CROSS_MARKET_INCIDENT_SHARE else home_market
        platform_id = platforms[rng.randrange(len(platforms))].platform_id
        candidates = [
            v for v in versions_by_platform.get(platform_id, []) if v.released_at < version_cutoff
        ]
        platform_version_id = (
            candidates[rng.randrange(len(candidates))].platform_version_id if candidates else None
        )
        started = _WINDOW_START_TS + timedelta(
            days=rng.randrange(WINDOW_DAYS), seconds=rng.randrange(24 * 60 * 60)
        )
        app_version_id: str | None = None
        if platform_id in _APP_PLATFORMS:
            eligible = sorted(
                v.app_version_id
                for v in app_versions
                if v.released_at <= started and market_id in (None, v.market_id)
            )
            app_version_id = rng.choice(eligible) if eligible else None
        resolved = (
            started + timedelta(minutes=rng.randrange(30, 60 * 72))
            if rng.random() < INCIDENT_RESOLVED_SHARE
            else None
        )
        canonical, summary = _INCIDENT_BY_PLATFORM[platform_id]
        if platform_version_id is not None:
            summary = (
                f"{summary} Seen on platform version {version_label[platform_version_id]} "
                f"({platform_version_id})."
            )
        severity = rng.choices(severities, weights=severity_weights)[0]
        incidents.append(
            IncidentRow(
                incident_id=incident_id,
                market_id=market_id,
                platform_id=platform_id,
                platform_version_id=platform_version_id,
                app_version_id=app_version_id,
                incident_type=incident_type_for(market_id, canonical),
                severity=severity,
                started_at=started,
                resolved_at=resolved,
                summary=summary,
                root_cause_code=(
                    f"RC_{rng.randrange(10, 99)}"
                    if rng.random() < INCIDENT_ROOT_CAUSE_SHARE
                    else None
                ),
            )
        )
        market_games = games_by_market[market_id or home_market]
        for game in rng.sample(market_games, k=min(len(market_games), rng.randrange(1, 4))):
            incident_games.append(
                IncidentGameMapRow(incident_id, game.game_id, round(rng.uniform(0.2, 1.0), 3))
            )
    incidents.sort(key=lambda x: x.started_at)
    return incidents, incident_games


def generate_support_cases(
    rng: random.Random,
    players: list[PlayerRow],
    games: list[GameRow],
    incidents: list[IncidentRow],
    total: int,
) -> list[SupportCaseRow]:
    """Support contacts, some linked to incidents and games."""
    players_by_market: dict[str, list[PlayerRow]] = {}
    for player in players:
        players_by_market.setdefault(player.market_id, []).append(player)
    games_by_market: dict[str, list[GameRow]] = {}
    for game in games:
        games_by_market.setdefault(game.market_id, []).append(game)

    cases: list[SupportCaseRow] = []
    for i in range(total):
        market_id = f"MKT_{_MARKET_CODES[i % len(_MARKET_CODES)]}"
        opened = _WINDOW_START_TS + timedelta(
            days=rng.randrange(WINDOW_DAYS), seconds=rng.randrange(24 * 60 * 60)
        )
        incident: IncidentRow | None = None
        if rng.random() < SUPPORT_INCIDENT_LINK_SHARE and incidents:
            candidates = [inc for inc in incidents if inc.started_at <= opened]
            if candidates:
                incident = candidates[rng.randrange(len(candidates))]
        linked_player = (
            rng.choice(players_by_market[market_id])
            if rng.random() < SUPPORT_PLAYER_LINK_SHARE
            else None
        )
        linked_game = (
            rng.choice(games_by_market[market_id])
            if rng.random() < SUPPORT_GAME_LINK_SHARE
            else None
        )
        closed = (
            opened + timedelta(hours=rng.randrange(2, 24 * 14))
            if rng.random() < SUPPORT_CLOSED_SHARE
            else None
        )
        sentiment_base = -0.4 if incident is not None and incident.severity == "CRITICAL" else -0.05
        sentiment = round(max(-1.0, min(1.0, rng.gauss(sentiment_base, 0.5))), 3)
        cases.append(
            SupportCaseRow(
                support_case_id=ID_FORMATS["support_cases"].format(n=i + 1),
                market_id=market_id,
                player_id=linked_player.player_id if linked_player else None,
                game_id=linked_game.game_id if linked_game else None,
                incident_id=incident.incident_id if incident else None,
                opened_at=opened,
                closed_at=closed,
                category_code=support_category_for(market_id, rng.choice(_SUPPORT_KINDS)),
                sentiment_score=sentiment,
                summary_text="Synthetic support contact describing a player-reported issue.",
            )
        )
    cases.sort(key=lambda c: c.opened_at)
    return cases


def generate_experiments(rng: random.Random, total: int) -> list[ExperimentRow]:
    """Synthetic A/B experiments with primary metrics and outcome summaries."""
    rows: list[ExperimentRow] = []
    for i in range(total):
        name, hypothesis, metric = _EXPERIMENTS[i % len(_EXPERIMENTS)]
        code = _MARKET_CODES[i % len(_MARKET_CODES)]
        start = _WINDOW_START_TS + timedelta(days=rng.randrange(0, 200))
        end = start + timedelta(days=rng.randrange(14, 60))
        result = rng.choice(_EXPERIMENT_RESULTS)
        rows.append(
            ExperimentRow(
                experiment_id=ID_FORMATS["experiments"].format(n=i + 1),
                market_id=f"MKT_{code}",
                experiment_name=name,
                hypothesis=hypothesis,
                start_at=start,
                end_at=end,
                target_segment=segments_for(code, "ENGAGEMENT")[rng.randrange(3)],
                primary_metric=metric,
                result_summary=result,
            )
        )
    return rows
