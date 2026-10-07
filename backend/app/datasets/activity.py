"""Transactional activity generators: draws, tickets, prizes, sessions, KPIs.

KPI rows are derived from the generated transactional tables so that
authoritative aggregates stay consistent with the underlying facts
(the structured layer remains the source of numeric truth).
"""

from __future__ import annotations

import random
from collections import defaultdict
from datetime import date, datetime, time, timedelta
from typing import Any

from app.datasets.config import WINDOW_DAYS, WINDOW_START
from app.datasets.util import money, to_json

_DRAW_BASE_JACKPOT_MINOR = {
    "NATIONAL": 400_000_00,
    "MULTINATIONAL": 20_000_000_00,
    "FIXED": 1_000_000_00,
}


def _draw_slots(frequency: str) -> tuple[str, ...]:
    if frequency == "DAILY":
        return tuple(str(d) for d in range(WINDOW_DAYS))
    if frequency == "TWICE_WEEKLY":
        return tuple(str(d) for d in range(WINDOW_DAYS) if d % 7 in (2, 5))
    if frequency == "WEEKLY":
        return tuple(str(d) for d in range(WINDOW_DAYS) if d % 7 == 5)
    return ()


def generate_draws(rng: random.Random, game_rows: list[tuple[Any, ...]]) -> list[tuple[Any, ...]]:
    """Draw schedule per draw-based game with rollover jackpots."""
    rows: list[tuple[Any, ...]] = []
    for game in game_rows:
        frequency = game[10]
        if frequency == "NONE":
            continue
        family = game[3]
        base = _DRAW_BASE_JACKPOT_MINOR[
            "MULTINATIONAL"
            if family == "FAM_MULTINATIONAL_JACKPOT"
            else "NATIONAL"
            if "DRAW" in family or family in ("FAM_ANNUITY", "FAM_ADD_ON")
            else "FIXED"
        ]
        jackpot_minor = base
        rollover = 0
        for counter, day in enumerate(_draw_slots(frequency), start=1):
            hour = 21 if frequency == "DAILY" else 20
            ts = datetime.combine(WINDOW_START, time.min) + timedelta(
                days=int(day), hours=hour, minutes=15
            )
            won = rng.random() < 0.25
            rows.append(
                (
                    f"DRAW_{game[0][5:]}_{counter:04d}",
                    game[0],
                    ts,
                    money(min(jackpot_minor, 200_000_000_00)),
                    game[9],
                    to_json({"numbers": sorted(rng.sample(range(1, 51), 6))}),
                    rollover,
                )
            )
            if won:
                jackpot_minor = base
                rollover = 0
            else:
                jackpot_minor = int(jackpot_minor * 1.4)
                rollover += 1
    return rows


def _weighted_players(players: list[tuple[Any, ...]], rng: random.Random) -> list[float]:
    """Long-tail activity weight per player, boosted by engagement segment."""
    weights: list[float] = []
    for player in players:
        engagement = player[8]
        base = rng.paretovariate(1.6)
        boost = {"SEG_ENG_ENGAGED": 1.5, "SEG_ENG_CASUAL": 1.0, "SEG_ENG_DORMANT": 0.15}[engagement]
        weights.append(base * boost)
    return weights


def generate_tickets_and_prizes(
    rng: random.Random,
    players: list[tuple[Any, ...]],
    game_rows: list[tuple[Any, ...]],
    retailers: list[tuple[Any, ...]],
    draws: list[tuple[Any, ...]],
    total_tickets: int,
) -> tuple[list[tuple[Any, ...]], list[tuple[Any, ...]]]:
    """Tickets with draw/retailer links, plus derived prizes."""
    games_by_market: dict[str, list[tuple[Any, ...]]] = defaultdict(list)
    for game in game_rows:
        games_by_market[game[1]].append(game)
    draws_by_game: dict[str, list[tuple[Any, ...]]] = defaultdict(list)
    for draw in draws:
        draws_by_game[draw[1]].append(draw)
    retailers_by_market: dict[str, list[tuple[Any, ...]]] = defaultdict(list)
    for retailer in retailers:
        retailers_by_market[retailer[1]].append(retailer)

    weights = _weighted_players(players, rng)
    cum_weights = list(weights)
    for i in range(1, len(cum_weights)):
        cum_weights[i] += cum_weights[i - 1]

    tickets: list[tuple[Any, ...]] = []
    prizes: list[tuple[Any, ...]] = []
    prize_types = (
        ("PTYPE_JACKPOT", 0.001),
        ("PTYPE_MAJOR", 0.01),
        ("PTYPE_MID", 0.06),
        ("PTYPE_MINOR", 0.33),
        ("PTYPE_MICRO", 0.60),
    )
    for i in range(total_tickets):
        player = players[rng.choices(range(len(players)), cum_weights=cum_weights)[0]]
        player_id, market_id = player[0], player[1]
        digital_affinity = player[9]
        market_games = games_by_market[market_id]
        game = market_games[rng.randrange(len(market_games))]
        game_id, currency = game[0], game[9]
        digital_enabled, retail_enabled = game[13], game[14]

        if digital_enabled and retail_enabled:
            retail = rng.random() > digital_affinity
        elif retail_enabled:
            retail = True
        else:
            retail = False
        channel = rng.choice(("RETAIL",)) if retail else rng.choice(("APP", "WEB"))

        draw_id: str | None = None
        ts: datetime
        if game[10] != "NONE":
            draw = draws_by_game[game_id][rng.randrange(len(draws_by_game[game_id]))]
            draw_id = draw[0]
            # Look back up to three days from the draw, but never leave the
            # generation window (the first draws sit days after window start).
            window_minutes = int(
                (draw[2] - datetime.combine(WINDOW_START, time.min)).total_seconds() // 60
            )
            lookback = rng.randrange(1, min(4320, max(2, window_minutes - 1)))
            ts = draw[2] - timedelta(minutes=lookback)
        else:
            ts = datetime.combine(WINDOW_START, time.min) + timedelta(
                days=rng.randrange(WINDOW_DAYS), seconds=rng.randrange(24 * 60 * 60)
            )

        retailer_id: str | None = (
            retailers_by_market[market_id][rng.randrange(len(retailers_by_market[market_id]))][0]
            if retail
            else None
        )
        anonymous = retail and rng.random() < 0.15
        ticket_id = f"TKT_{i + 1:08d}"
        tickets.append(
            (
                ticket_id,
                None if anonymous else player_id,
                game_id,
                market_id,
                draw_id,
                retailer_id,
                channel,
                ts,
                game[8],
                currency,
                "VOID" if rng.random() < 0.01 else "SETTLED",
            )
        )

        if rng.random() < 0.35:
            tier = rng.choices(prize_types, weights=[w for _, w in prize_types])[0][0]
            multiplier = {
                "PTYPE_JACKPOT": 100_000.0,
                "PTYPE_MAJOR": 1_000.0,
                "PTYPE_MID": 40.0,
                "PTYPE_MINOR": 4.0,
                "PTYPE_MICRO": 1.0,
            }[tier]
            amount_minor = min(int(game[8] * 100) * int(multiplier), 10_000_000_00)
            prizes.append(
                (
                    f"PRZ_{len(prizes) + 1:07d}",
                    ticket_id,
                    tier,
                    money(amount_minor),
                    currency,
                    rng.random() < 0.8,
                )
            )

    tickets.sort(key=lambda t: (t[7], t[0]))
    prizes.sort(key=lambda p: p[0])
    return tickets, prizes


def generate_sessions(
    rng: random.Random,
    players: list[tuple[Any, ...]],
    devices_by_player: dict[str, list[str]],
    app_versions_by_market: dict[str, list[tuple[Any, ...]]],
    total_sessions: int,
) -> list[tuple[Any, ...]]:
    """Digital and retail sessions with long-tail player distribution."""
    weights = _weighted_players(players, rng)
    cum_weights = list(weights)
    for i in range(1, len(cum_weights)):
        cum_weights[i] += cum_weights[i - 1]

    sessions: list[tuple[Any, ...]] = []
    for i in range(total_sessions):
        player = players[rng.choices(range(len(players)), cum_weights=cum_weights)[0]]
        player_id, market_id, digital_affinity = player[0], player[1], player[9]
        roll = rng.random()
        if roll < digital_affinity * 0.7:
            channel, device_id = (
                "APP",
                rng.choice(devices_by_player.get(player_id, []))
                if devices_by_player.get(player_id)
                else None,
            )
        elif roll < digital_affinity * 0.7 + 0.25:
            channel, device_id = "WEB", None
        else:
            channel, device_id = "RETAIL", None
        started = datetime.combine(WINDOW_START, time.min) + timedelta(
            days=rng.randrange(WINDOW_DAYS), seconds=rng.randrange(24 * 60 * 60)
        )
        ended = started + timedelta(minutes=rng.randrange(1, 45))
        app_version_id: str | None = None
        if channel == "APP":
            market_versions = app_versions_by_market[market_id]
            # 5.3.0 is the dominant deployed version (phase 5 plants its story).
            app_version_id = (
                market_versions[1][0]
                if rng.random() < 0.45
                else market_versions[rng.randrange(len(market_versions))][0]
            )
        outcome = rng.choices(
            ("COMPLETE", "ABANDONED", "FAIL_PAYMENT"), weights=(0.78, 0.14, 0.08)
        )[0]
        sessions.append(
            (
                f"SES_{i + 1:08d}",
                player_id,
                market_id,
                device_id,
                channel,
                started,
                ended,
                app_version_id,
                outcome,
            )
        )
    sessions.sort(key=lambda s: (s[5], s[0]))
    return sessions


def generate_kpi_daily(
    tickets: list[tuple[Any, ...]],
    sessions: list[tuple[Any, ...]],
    support_cases: list[tuple[Any, ...]],
    exposures: list[tuple[Any, ...]],
    market_currency: dict[str, str],
) -> list[tuple[Any, ...]]:
    """Derive daily KPI aggregates from transactional facts."""
    ticket_count: dict[tuple[date, str, str], int] = defaultdict(int)
    gross: dict[tuple[date, str, str], int] = defaultdict(int)
    market_ticket_count: dict[tuple[date, str], int] = defaultdict(int)
    active: dict[tuple[date, str], set[str]] = defaultdict(set)
    session_outcomes: dict[tuple[date, str], list[str]] = defaultdict(list)
    support_by_day: dict[tuple[date, str], int] = defaultdict(int)
    exposure_stats: dict[tuple[date, str], list[int]] = defaultdict(lambda: [0, 0])

    for t in tickets:
        day, market_id, game_id, stake, player_id = t[7].date(), t[3], t[2], t[8], t[1]
        ticket_count[(day, market_id, game_id)] += 1
        gross[(day, market_id, game_id)] += int(stake * 100)
        market_ticket_count[(day, market_id)] += 1
        if player_id:
            active[(day, market_id)].add(player_id)
    for s in sessions:
        session_outcomes[(s[5].date(), s[2])].append(s[8])
    for c in support_cases:
        support_by_day[(c[5].date(), c[1])] += 1
    for e in exposures:
        stats = exposure_stats[(e[4].date(), e[1])]
        stats[0] += 1
        if e[5]:
            stats[1] += 1

    market_ids = sorted(market_currency)
    rows: list[tuple[Any, ...]] = []
    days = sorted({d for d, _ in active} | {d for d, _ in session_outcomes})

    def add(
        day: date,
        market_id: str,
        game_id: str | None,
        code: str,
        value: float,
        currency: str | None,
    ) -> None:
        rows.append((day, market_id, game_id, None, code, round(value, 6), currency))

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
                add(
                    day,
                    market_id,
                    game_id,
                    "ticket_sales",
                    ticket_count[(day, market_id, game_id)],
                    None,
                )
                add(
                    day,
                    market_id,
                    game_id,
                    "gross_sales",
                    gross[(day, market_id, game_id)] / 100,
                    market_currency[market_id],
                )
    rows.sort(key=lambda r: (r[0], r[1], r[2] or "", r[4]))
    return rows
