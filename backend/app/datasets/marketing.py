"""Marketing generators: campaigns, campaign-game mapping, exposures."""

from __future__ import annotations

import random
from datetime import datetime, time, timedelta

from app.datasets.activity import _cumulative, _weighted_players
from app.datasets.config import WINDOW_DAYS, WINDOW_START
from app.datasets.distributions import (
    EXPOSURE_CONVERSION_SHARE,
    EXPOSURE_ENGAGED_SHARE,
    MARKET_SPLIT,
)
from app.datasets.master_data import CAMPAIGN_OBJECTIVES, MARKET_CURRENCY
from app.datasets.rows import (
    CampaignExposureRow,
    CampaignGameMapRow,
    CampaignRow,
    GameRow,
    PlayerRow,
)
from app.datasets.schema import ID_FORMATS
from app.datasets.util import money

_CAMPAIGN_NAMES = {
    "OBJ_ACQUISITION": ("First Play Focus", "New Season Start"),
    "OBJ_CROSS_SELL": ("Twin Ticket Trail", "Family Bundle Drive"),
    "OBJ_REACTIVATION": ("Comeback Countdown", "Second Chance Season"),
    "OBJ_DIGITAL_SHIFT": ("Pocket Play Push", "Scan and Play"),
}
_WINDOW_START_TS = datetime.combine(WINDOW_START, time.min)


def generate_campaigns(
    rng: random.Random, games: list[GameRow], per_market: int
) -> dict[str, list[CampaignRow] | list[CampaignGameMapRow]]:
    """Campaigns per market, objectives cycling through all four, mapped to local games."""
    campaigns: list[CampaignRow] = []
    campaign_games: list[CampaignGameMapRow] = []
    games_by_market: dict[str, list[GameRow]] = {}
    for game in games:
        games_by_market.setdefault(game.market_id, []).append(game)
    objectives = [objective_id for objective_id, _ in CAMPAIGN_OBJECTIVES]

    counter = 0
    for market_code in MARKET_SPLIT:
        market_id = f"MKT_{market_code}"
        market_games = games_by_market[market_id]
        for slot in range(per_market):
            counter += 1
            campaign_id = ID_FORMATS["campaigns"].format(n=counter)
            objective = objectives[slot % len(objectives)]
            start = _WINDOW_START_TS + timedelta(days=rng.randrange(WINDOW_DAYS - 100))
            end = start + timedelta(days=rng.randrange(20, 80))
            name = f"{_CAMPAIGN_NAMES[objective][counter % 2]} {market_code}"
            campaigns.append(
                CampaignRow(
                    campaign_id=campaign_id,
                    market_id=market_id,
                    campaign_name=name,
                    campaign_type=objective,
                    start_at=start,
                    end_at=end,
                    budget_amount=money(rng.randrange(5_000_000, 500_000_000, step=500_000)),
                    currency_code=MARKET_CURRENCY[market_code],
                    objective_code=objective,
                )
            )
            promoted = rng.sample(market_games, k=min(len(market_games), rng.randrange(1, 4)))
            for game in promoted:
                campaign_games.append(
                    CampaignGameMapRow(campaign_id, game.game_id, round(rng.uniform(0.5, 2.0), 3))
                )

    return {"campaigns": campaigns, "campaign_game_map": campaign_games}


def generate_exposures(
    rng: random.Random,
    campaigns: list[CampaignRow],
    campaign_games: list[CampaignGameMapRow],
    players: list[PlayerRow],
    total: int,
) -> list[CampaignExposureRow]:
    """Campaign exposures with engagement and conversion."""
    games_by_campaign: dict[str, list[str]] = {}
    for mapping in campaign_games:
        games_by_campaign.setdefault(mapping.campaign_id, []).append(mapping.game_id)
    players_by_market: dict[str, list[PlayerRow]] = {}
    for player in players:
        players_by_market.setdefault(player.market_id, []).append(player)
    # Cumulative weights once per market: rebuilding inside the row loop made
    # generation quadratic in players x exposures and unusable at demo scale.
    cum_by_market = {
        market_id: _cumulative(_weighted_players(market_players, rng))
        for market_id, market_players in players_by_market.items()
    }

    exposures: list[CampaignExposureRow] = []
    for i in range(total):
        campaign = campaigns[rng.randrange(len(campaigns))]
        market_players = players_by_market[campaign.market_id]
        cum = cum_by_market[campaign.market_id]
        player = market_players[rng.choices(range(len(market_players)), cum_weights=cum)[0]]
        span_seconds = max(1, int((campaign.end_at - campaign.start_at).total_seconds()))
        exposed_at = campaign.start_at + timedelta(seconds=rng.randrange(span_seconds))
        engaged = rng.random() < EXPOSURE_ENGAGED_SHARE
        converted_game: str | None = None
        converted_at: datetime | None = None
        if engaged and rng.random() < EXPOSURE_CONVERSION_SHARE:
            options = games_by_campaign.get(campaign.campaign_id, [])
            if options:
                converted_game = options[rng.randrange(len(options))]
                converted_at = min(
                    exposed_at + timedelta(hours=rng.randrange(1, 72)), campaign.end_at
                )
        exposures.append(
            CampaignExposureRow(
                exposure_id=ID_FORMATS["campaign_exposures"].format(n=i + 1),
                campaign_id=campaign.campaign_id,
                player_id=player.player_id,
                channel_code=rng.choice(("APP", "WEB", "RETAIL")),
                exposed_at=exposed_at,
                engaged=engaged,
                converted_game_id=converted_game,
                converted_at=converted_at,
            )
        )
    exposures.sort(key=lambda e: (e.exposed_at, e.exposure_id))
    return exposures
