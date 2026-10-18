"""Transactional activity generators: draws, tickets, prizes, sessions, KPIs.

KPI rows are derived from the generated transactional tables so that
authoritative aggregates stay consistent with the underlying facts
(the structured layer remains the source of numeric truth).
"""

from __future__ import annotations

import random
from collections import defaultdict
from datetime import date, datetime, time, timedelta

from app.datasets.config import WINDOW_DAYS, WINDOW_START
from app.datasets.distributions import (
    ANONYMOUS_RETAIL_SHARE,
    DOMINANT_APP_VERSION_SHARE,
    DRAW_WIN_PROBABILITY,
    ENGAGEMENT_ACTIVITY_BOOST,
    JACKPOT_CAP_MINOR,
    MARKET_SPLIT,
    PLAYER_ACTIVITY_PARETO_ALPHA,
    PRIZE_CLAIM_SHARE,
    PRIZE_WIN_SHARE,
    ROLLOVER_FACTOR,
    SESSION_OUTCOME_WEIGHTS,
    VOID_TICKET_SHARE,
)
from app.datasets.master_data import PRIZE_TYPES
from app.datasets.rows import (
    AppVersionRow,
    CampaignExposureRow,
    CampaignRow,
    DrawRow,
    GameRow,
    KpiDailyRow,
    PlayerRow,
    PrizeRow,
    RetailerRow,
    SessionRow,
    SupportCaseRow,
    TicketRow,
)
from app.datasets.schema import ID_FORMATS
from app.datasets.taxonomies import segments_for
from app.datasets.util import money, to_json

# Opening jackpot amounts in minor currency units, by jackpot kind.
_DRAW_BASE_JACKPOT_MINOR = {
    "NATIONAL": 400_000_00,
    "MULTINATIONAL": 20_000_000_00,
    "FIXED": 1_000_000_00,
}


# Prize amount ceiling in minor currency units.
_PRIZE_CAP_MINOR = 10_000_000_00
_PRIZE_TIERS = [(prize_id, weight) for prize_id, _, _, weight in PRIZE_TYPES]
_PRIZE_MULTIPLIER = {prize_id: multiplier for prize_id, _, multiplier, _ in PRIZE_TYPES}
_DRAW_START = datetime.combine(WINDOW_START, time.min)


def _base_jackpot_minor(game: GameRow) -> int:
    """Opening jackpot: multinational for jackpot families, national for other progressives."""
    if game.jackpot_type_code != "PROGRESSIVE":
        return _DRAW_BASE_JACKPOT_MINOR["FIXED"]
    if "JACKPOT" in game.game_family_id:
        return _DRAW_BASE_JACKPOT_MINOR["MULTINATIONAL"]
    return _DRAW_BASE_JACKPOT_MINOR["NATIONAL"]


def _cumulative(weights: list[float]) -> list[float]:
    cum = list(weights)
    for i in range(1, len(cum)):
        cum[i] += cum[i - 1]
    return cum


def _draw_slots(frequency: str) -> tuple[str, ...]:
    if frequency == "DAILY":
        return tuple(str(d) for d in range(WINDOW_DAYS))
    if frequency == "TWICE_WEEKLY":
        return tuple(str(d) for d in range(WINDOW_DAYS) if d % 7 in (2, 5))
    if frequency == "WEEKLY":
        return tuple(str(d) for d in range(WINDOW_DAYS) if d % 7 == 5)
    return ()


def generate_draws(rng: random.Random, games: list[GameRow]) -> list[DrawRow]:
    """Draw schedule per draw-based game with rollover jackpots."""
    rows: list[DrawRow] = []
    for game in games:
        frequency = game.draw_frequency_code
        if frequency == "NONE":
            continue
        base = _base_jackpot_minor(game)
        jackpot_minor = base
        rollover = 0
        for counter, day in enumerate(_draw_slots(frequency), start=1):
            hour = 21 if frequency == "DAILY" else 20
            ts = _DRAW_START + timedelta(days=int(day), hours=hour, minutes=15)
            won = rng.random() < DRAW_WIN_PROBABILITY
            rows.append(
                DrawRow(
                    draw_id=ID_FORMATS["draws"].format(game=game.game_id[5:], n=counter),
                    game_id=game.game_id,
                    draw_timestamp=ts,
                    jackpot_amount=money(min(jackpot_minor, JACKPOT_CAP_MINOR)),
                    currency_code=game.currency_code,
                    result_payload=to_json({"numbers": sorted(rng.sample(range(1, 51), 6))}),
                    rollover_count=rollover,
                )
            )
            if won:
                jackpot_minor = base
                rollover = 0
            else:
                jackpot_minor = int(jackpot_minor * ROLLOVER_FACTOR)
                rollover += 1
    return rows


def _weighted_players(players: list[PlayerRow], rng: random.Random) -> list[float]:
    """Long-tail activity weight per player, boosted by engagement segment."""
    # Segment ids are market-local; each market lists engaged, casual, dormant in kind order.
    boosts = {
        segment_id: boost
        for code in MARKET_SPLIT
        for segment_id, boost in zip(
            segments_for(code, "ENGAGEMENT"), ENGAGEMENT_ACTIVITY_BOOST.values(), strict=True
        )
    }
    return [
        rng.paretovariate(PLAYER_ACTIVITY_PARETO_ALPHA) * boosts[player.engagement_segment]
        for player in players
    ]


def generate_tickets_and_prizes(
    rng: random.Random,
    players: list[PlayerRow],
    games: list[GameRow],
    retailers: list[RetailerRow],
    draws: list[DrawRow],
    total_tickets: int,
) -> tuple[list[TicketRow], list[PrizeRow]]:
    """Tickets with draw/retailer links, plus derived prizes."""
    games_by_market: dict[str, list[GameRow]] = defaultdict(list)
    for game in games:
        games_by_market[game.market_id].append(game)
    draws_by_game: dict[str, list[DrawRow]] = defaultdict(list)
    for draw in draws:
        draws_by_game[draw.game_id].append(draw)
    retailers_by_market: dict[str, list[RetailerRow]] = defaultdict(list)
    for retailer in retailers:
        retailers_by_market[retailer.market_id].append(retailer)

    cum_weights = _cumulative(_weighted_players(players, rng))

    tickets: list[TicketRow] = []
    prizes: list[PrizeRow] = []
    for i in range(total_tickets):
        player = players[rng.choices(range(len(players)), cum_weights=cum_weights)[0]]
        market_games = games_by_market[player.market_id]
        game = market_games[rng.randrange(len(market_games))]

        if game.digital_enabled and game.retail_enabled:
            retail = rng.random() > player.digital_affinity
        else:
            retail = game.retail_enabled
        channel = "RETAIL" if retail else rng.choice(("APP", "WEB"))

        draw_id: str | None = None
        ts: datetime
        if game.draw_frequency_code != "NONE":
            game_draws = draws_by_game[game.game_id]
            draw = game_draws[rng.randrange(len(game_draws))]
            draw_id = draw.draw_id
            # Look back up to three days from the draw, but never leave the
            # generation window (the first draws sit days after window start).
            window_minutes = int((draw.draw_timestamp - _DRAW_START).total_seconds() // 60)
            lookback = rng.randrange(1, min(4320, max(2, window_minutes - 1)))
            ts = draw.draw_timestamp - timedelta(minutes=lookback)
        else:
            ts = _DRAW_START + timedelta(
                days=rng.randrange(WINDOW_DAYS), seconds=rng.randrange(24 * 60 * 60)
            )

        retailer_id: str | None = None
        if retail:
            market_retailers = retailers_by_market[player.market_id]
            retailer_id = market_retailers[rng.randrange(len(market_retailers))].retailer_id
        anonymous = retail and rng.random() < ANONYMOUS_RETAIL_SHARE
        ticket_id = ID_FORMATS["tickets"].format(n=i + 1)
        tickets.append(
            TicketRow(
                ticket_id=ticket_id,
                player_id=None if anonymous else player.player_id,
                game_id=game.game_id,
                market_id=player.market_id,
                draw_id=draw_id,
                retailer_id=retailer_id,
                channel_code=channel,
                purchase_timestamp=ts,
                stake_amount=game.ticket_price,
                currency_code=game.currency_code,
                ticket_status="VOID" if rng.random() < VOID_TICKET_SHARE else "SETTLED",
            )
        )

        if rng.random() < PRIZE_WIN_SHARE:
            tier = rng.choices(
                [prize_id for prize_id, _ in _PRIZE_TIERS],
                weights=[weight for _, weight in _PRIZE_TIERS],
            )[0]
            amount_minor = min(
                int(game.ticket_price * 100) * int(_PRIZE_MULTIPLIER[tier]), _PRIZE_CAP_MINOR
            )
            prizes.append(
                PrizeRow(
                    prize_id=ID_FORMATS["prizes"].format(n=len(prizes) + 1),
                    ticket_id=ticket_id,
                    prize_tier=tier,
                    prize_amount=money(amount_minor),
                    currency_code=game.currency_code,
                    claimed=rng.random() < PRIZE_CLAIM_SHARE,
                )
            )

    tickets.sort(key=lambda t: (t.purchase_timestamp, t.ticket_id))
    prizes.sort(key=lambda p: p.prize_id)
    return tickets, prizes


def generate_sessions(
    rng: random.Random,
    players: list[PlayerRow],
    devices_by_player: dict[str, list[str]],
    app_versions_by_market: dict[str, list[AppVersionRow]],
    total_sessions: int,
) -> list[SessionRow]:
    """Digital and retail sessions with long-tail player distribution."""
    cum_weights = _cumulative(_weighted_players(players, rng))
    outcomes = list(SESSION_OUTCOME_WEIGHTS)
    outcome_weights = list(SESSION_OUTCOME_WEIGHTS.values())

    sessions: list[SessionRow] = []
    for i in range(total_sessions):
        player = players[rng.choices(range(len(players)), cum_weights=cum_weights)[0]]
        player_devices = devices_by_player.get(player.player_id)
        roll = rng.random()
        device_id: str | None = None
        if roll < player.digital_affinity * 0.7:
            channel = "APP"
            device_id = rng.choice(player_devices) if player_devices else None
        elif roll < player.digital_affinity * 0.7 + 0.25:
            channel = "WEB"
        else:
            channel = "RETAIL"
        started = _DRAW_START + timedelta(
            days=rng.randrange(WINDOW_DAYS), seconds=rng.randrange(24 * 60 * 60)
        )
        ended = started + timedelta(minutes=rng.randrange(1, 45))
        app_version_id: str | None = None
        if channel == "APP":
            market_versions = app_versions_by_market[player.market_id]
            # The second release is the dominant deployed version (phase 5 plants its story).
            dominant = rng.random() < DOMINANT_APP_VERSION_SHARE
            app_version_id = (
                market_versions[1] if dominant else rng.choice(market_versions)
            ).app_version_id
        sessions.append(
            SessionRow(
                session_id=ID_FORMATS["sessions"].format(n=i + 1),
                player_id=player.player_id,
                market_id=player.market_id,
                device_id=device_id,
                channel_code=channel,
                started_at=started,
                ended_at=ended,
                app_version_id=app_version_id,
                session_outcome=rng.choices(outcomes, weights=outcome_weights)[0],
            )
        )
    sessions.sort(key=lambda s: (s.started_at, s.session_id))
    return sessions


def generate_kpi_daily(
    tickets: list[TicketRow],
    sessions: list[SessionRow],
    support_cases: list[SupportCaseRow],
    exposures: list[CampaignExposureRow],
    campaigns: list[CampaignRow],
    market_currency: dict[str, str],
) -> list[KpiDailyRow]:
    """Derive daily KPI aggregates from transactional facts."""
    ticket_count: dict[tuple[date, str, str], int] = defaultdict(int)
    gross: dict[tuple[date, str, str], int] = defaultdict(int)
    active: dict[tuple[date, str], set[str]] = defaultdict(set)
    session_outcomes: dict[tuple[date, str], list[str]] = defaultdict(list)
    support_by_day: dict[tuple[date, str], int] = defaultdict(int)
    # [engaged exposures, converted exposures] per day and market.
    exposure_stats: dict[tuple[date, str], list[int]] = defaultdict(lambda: [0, 0])

    campaign_market = {c.campaign_id: c.market_id for c in campaigns}

    for t in tickets:
        day = t.purchase_timestamp.date()
        ticket_count[(day, t.market_id, t.game_id)] += 1
        gross[(day, t.market_id, t.game_id)] += int(t.stake_amount * 100)
        if t.player_id:
            active[(day, t.market_id)].add(t.player_id)
    for s in sessions:
        session_outcomes[(s.started_at.date(), s.market_id)].append(s.session_outcome)
    for c in support_cases:
        support_by_day[(c.opened_at.date(), c.market_id)] += 1
    for e in exposures:
        if e.engaged:
            stats = exposure_stats[(e.exposed_at.date(), campaign_market[e.campaign_id])]
            stats[0] += 1
            if e.converted_game_id is not None:
                stats[1] += 1

    market_ids = sorted(market_currency)
    rows: list[KpiDailyRow] = []
    days = sorted({d for d, _ in active} | {d for d, _ in session_outcomes})

    def add(
        day: date,
        market_id: str,
        game_id: str | None,
        code: str,
        value: float,
        currency: str | None,
    ) -> None:
        rows.append(KpiDailyRow(day, market_id, game_id, None, code, round(value, 6), currency))

    for day in days:
        for market_id in market_ids:
            players_today = len(active.get((day, market_id), set()))
            add(day, market_id, None, "active_players", players_today, None)
            outcomes = session_outcomes.get((day, market_id), [])
            if outcomes:
                complete = sum(1 for o in outcomes if o == "COMPLETE")
                failed = sum(1 for o in outcomes if o == "FAIL_PAYMENT")
                add(day, market_id, None, "session_completion", complete / len(outcomes), None)
                add(day, market_id, None, "payment_failure_rate", failed / len(outcomes), None)
            engaged, converted = exposure_stats.get((day, market_id), [0, 0])
            if engaged:
                add(day, market_id, None, "conversion_rate", converted / engaged, None)
            contacts = support_by_day.get((day, market_id), 0)
            if players_today:
                add(day, market_id, None, "support_contact_rate", contacts / players_today, None)
            for game_id in {g for (d, m, g) in ticket_count if d == day and m == market_id}:
                key = (day, market_id, game_id)
                add(day, market_id, game_id, "ticket_sales", ticket_count[key], None)
                add(
                    day,
                    market_id,
                    game_id,
                    "gross_sales",
                    gross[key] / 100,
                    market_currency[market_id],
                )
    rows.sort(key=lambda r: (r.date, r.market_id, r.game_id or "", r.metric_code))
    return rows
