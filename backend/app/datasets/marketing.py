"""Marketing generators: campaigns, campaign-game mapping, exposures."""

from __future__ import annotations

import random
from datetime import datetime, time, timedelta
from typing import Any

from app.datasets.activity import _weighted_players
from app.datasets.config import WINDOW_DAYS, WINDOW_START
from app.datasets.master_data import MARKET_CURRENCY
from app.datasets.util import money

_CAMPAIGN_NAMES = {
    "OBJ_ACQUISITION": ("First Play Focus", "New Season Start"),
    "OBJ_CROSS_SELL": ("Twin Ticket Trail", "Family Bundle Drive"),
    "OBJ_REACTIVATION": ("Comeback Countdown", "Second Chance Season"),
    "OBJ_DIGITAL_SHIFT": ("Pocket Play Push", "Scan and Play"),
}


def generate_campaigns(
    rng: random.Random, game_rows: list[tuple[Any, ...]]
) -> dict[str, list[tuple[Any, ...]]]:
    """Campaigns per market, mapped to local games."""
    campaigns: list[tuple[Any, ...]] = []
    campaign_games: list[tuple[Any, ...]] = []
    counter = 0
    games_by_market: dict[str, list[tuple[Any, ...]]] = {}
    for game in game_rows:
        games_by_market.setdefault(game[1], []).append(game)

    for market_code in ("UK", "GR", "AT", "CZ"):
        market_id = f"MKT_{market_code}"
        market_games = games_by_market[market_id]
        for objective in ("OBJ_ACQUISITION", "OBJ_CROSS_SELL", "OBJ_DIGITAL_SHIFT"):
            counter += 1
            start_day = rng.randrange(WINDOW_DAYS - 100)
            duration = rng.randrange(20, 80)
            start = datetime.combine(WINDOW_START, time.min) + timedelta(days=start_day)
            end = start + timedelta(days=duration)
            name = f"{_CAMPAIGN_NAMES[objective][counter % 2]} {market_code}"
            budget_minor = rng.randrange(5_000_000, 500_000_000, step=500_000)
            campaigns.append(
                (
                    f"CMP_{counter:03d}",
                    market_id,
                    name,
                    objective,
                    start,
                    end,
                    money(budget_minor),
                    MARKET_CURRENCY[market_code],
                    objective,
                )
            )
            promoted = rng.sample(market_games, k=min(len(market_games), rng.randrange(1, 4)))
            for game in promoted:
                campaign_games.append(
                    (f"CMP_{counter:03d}", game[0], round(rng.uniform(0.5, 2.0), 3))
                )

    return {"campaigns": campaigns, "campaign_game_map": campaign_games}


def generate_exposures(
    rng: random.Random,
    campaigns: list[tuple[Any, ...]],
    campaign_games: list[tuple[Any, ...]],
    players: list[tuple[Any, ...]],
    total: int,
) -> list[tuple[Any, ...]]:
    """Campaign exposures with engagement and conversion."""
    games_by_campaign: dict[str, list[str]] = {}
    for campaign_id, game_id, _ in campaign_games:
        games_by_campaign.setdefault(campaign_id, []).append(game_id)
    players_by_market: dict[str, list[tuple[Any, ...]]] = {}
    for player in players:
        players_by_market.setdefault(player[1], []).append(player)
    weights_by_market = {
        market_id: _weighted_players(market_players, rng)
        for market_id, market_players in players_by_market.items()
    }
    # Cumulative weights once per market: rebuilding inside the row loop made
    # generation quadratic in players x exposures and unusable at demo scale.
    cum_by_market: dict[str, list[float]] = {}
    for market_id, weights in weights_by_market.items():
        cum = list(weights)
        for j in range(1, len(cum)):
            cum[j] += cum[j - 1]
        cum_by_market[market_id] = cum

    exposures: list[tuple[Any, ...]] = []
    for i in range(total):
        campaign = campaigns[rng.randrange(len(campaigns))]
        campaign_id, market_id = campaign[0], campaign[1]
        start, end = campaign[4], campaign[5]
        market_players = players_by_market[market_id]
        cum = cum_by_market[market_id]
        player = market_players[rng.choices(range(len(market_players)), cum_weights=cum)[0]]
        span_seconds = max(1, int((end - start).total_seconds()))
        exposed_at = start + timedelta(seconds=rng.randrange(span_seconds))
        engaged = rng.random() < 0.30
        converted_game: str | None = None
        converted_at = None
        if engaged and rng.random() < 0.25:
            options = games_by_campaign.get(campaign_id, [])
            if options:
                converted_game = options[rng.randrange(len(options))]
                converted_at = exposed_at + timedelta(hours=rng.randrange(1, 72))
                if converted_at > end:
                    converted_at = end
        exposures.append(
            (
                f"EXP_{i + 1:07d}",
                campaign_id,
                player[0],
                rng.choice(("APP", "WEB", "RETAIL")),
                exposed_at,
                engaged,
                converted_game,
                converted_at,
            )
        )
    exposures.sort(key=lambda e: (e[4], e[0]))
    return exposures
