"""Graph-topology scenarios: shared devices (SCN-002) and shared instruments (SCN-003).

Both patterns are invisible row by row and only appear as unusual
connectivity between accounts. Market, game and cluster members are drawn
from the scenario stream (design 10a.5).
"""

from __future__ import annotations

from collections import Counter
from datetime import timedelta

from app.datasets.rows import DeviceRow, PlayerDeviceRow, PlayerPaymentMethodRow, TicketRow
from app.scenarios.planter import ScenarioPlanter, at

# SCN-002 shape: eight accounts, three shared devices, two devices per account,
# three app purchases each inside one coordinated evening.
SCN002_CLUSTER_SIZE = 8
SCN002_SHARED_DEVICES = 3
SCN002_DEVICES_PER_PLAYER = 2
SCN002_TICKETS_PER_PLAYER = 3
SCN002_START_DAY = 150
SCN002_START_HOUR = 20
SCN002_WINDOW_MINUTES = 120
SCN002_DEVICE_LEAD_DAYS = 30
SCN002_LINK_USAGE_WEIGHT = 0.2
SCN002_OS_BUCKET = {"IOS": "18", "ANDROID": "15"}

# SCN-003 shape: six accounts fully connected to the two least used shared instruments.
SCN003_CLUSTER_SIZE = 6
SCN003_SHARED_INSTRUMENTS = 2
SCN003_SHARED_PREFIX = "PAY_SHARED_"
SCN003_START_DAY = 200
SCN003_START_HOUR = 9
SCN003_SPREAD_DAYS = 7
SCN003_USAGE_DAYS = 60
SCN003_LINK_USAGE_WEIGHT = 0.15


def plant_shared_device_cluster(plan: ScenarioPlanter) -> None:
    """SCN-002: eight accounts connected through three shared devices."""
    eligible = [
        m for m in plan.markets_with_active_players(SCN002_CLUSTER_SIZE) if plan.digital_games(m)
    ]
    market = _draw_market(plan, eligible)
    code = plan.market_code(market)
    members = plan.players_in(market, SCN002_CLUSTER_SIZE)
    member_ids = [p.player_id for p in members]
    game = plan.rng.choice(plan.digital_games(market))

    base = at(SCN002_START_DAY, SCN002_START_HOUR)
    devices: list[DeviceRow] = []
    for _ in range(SCN002_SHARED_DEVICES):
        device_id = plan.next_id("devices", market_code=code)
        family = plan.rng.choice(sorted(SCN002_OS_BUCKET))
        devices.append(
            DeviceRow(
                device_id=device_id,
                device_fingerprint=f"fp-{device_id.lower()}",
                device_family=family,
                os_version_bucket=SCN002_OS_BUCKET[family],
                app_capable=True,
                first_seen_at=base - timedelta(days=SCN002_DEVICE_LEAD_DAYS),
            )
        )
    plan.add("devices", devices)
    device_ids = [d.device_id for d in devices]

    links = [
        PlayerDeviceRow(
            player_id=player_id,
            device_id=device_id,
            first_seen_at=base - timedelta(days=SCN002_DEVICE_LEAD_DAYS),
            last_seen_at=base + timedelta(days=1),
            usage_weight=SCN002_LINK_USAGE_WEIGHT,
        )
        for player_id in member_ids
        for device_id in plan.rng.sample(device_ids, SCN002_DEVICES_PER_PLAYER)
    ]
    plan.add("player_device", links)

    tickets: list[TicketRow] = []
    for order, player_id in enumerate(member_ids):
        moment = base + timedelta(minutes=5 * order + plan.rng.randrange(0, 4))
        for _ in range(SCN002_TICKETS_PER_PLAYER):
            moment += timedelta(minutes=4 + plan.rng.randrange(0, 6))
            tickets.append(
                TicketRow(
                    ticket_id=plan.next_id("tickets"),
                    player_id=player_id,
                    game_id=game.game_id,
                    market_id=market,
                    draw_id=None,
                    retailer_id=None,
                    channel_code="APP",
                    purchase_timestamp=moment,
                    stake_amount=game.ticket_price,
                    currency_code=game.currency_code,
                    ticket_status="SETTLED",
                )
            )
    plan.add("tickets", tickets)

    plan.affected_markets = [market]
    plan.affected_games = [game.game_id]
    plan.start_date = base.date()
    plan.duration_days = 1
    plan.truth = {
        "market": market,
        "game": game.game_id,
        "cluster_players": sorted(member_ids),
        "shared_devices": sorted(device_ids),
        "coordination_window": {"start": base.isoformat(), "minutes": SCN002_WINDOW_MINUTES},
        "planted_ticket_count": len(tickets),
        "expected_interpretation": (
            "an unusual cluster worth investigation; the pattern alone does not establish fraud"
        ),
    }
    plan.required_evidence = [*sorted(device_ids), *sorted(member_ids)[:3]]


def plant_shared_payment_cluster(plan: ScenarioPlanter) -> None:
    """SCN-003: six accounts sharing two rarely used payment instruments."""
    market = _draw_market(plan, plan.markets_with_active_players(SCN003_CLUSTER_SIZE))
    members = plan.players_in(market, SCN003_CLUSTER_SIZE)
    member_ids = [p.player_id for p in members]

    usage: Counter[str] = Counter(
        link.payment_method_id
        for link in plan.tables["player_payment_method"]
        if link.payment_method_id.startswith(SCN003_SHARED_PREFIX)
    )
    instruments = sorted(usage, key=lambda key: (usage[key], key))[:SCN003_SHARED_INSTRUMENTS]

    base = at(SCN003_START_DAY, SCN003_START_HOUR)
    links: list[PlayerPaymentMethodRow] = []
    for player_id in member_ids:
        first_used = base + timedelta(
            days=plan.rng.randrange(0, SCN003_SPREAD_DAYS), hours=plan.rng.randrange(24)
        )
        links.extend(
            PlayerPaymentMethodRow(
                player_id=player_id,
                payment_method_id=instrument,
                first_used_at=first_used,
                last_used_at=first_used + timedelta(days=SCN003_USAGE_DAYS),
                usage_weight=SCN003_LINK_USAGE_WEIGHT,
            )
            for instrument in instruments
        )
    plan.add("player_payment_method", links)

    plan.affected_markets = [market]
    plan.start_date = base.date()
    plan.duration_days = SCN003_SPREAD_DAYS
    plan.truth = {
        "market": market,
        "cluster_players": sorted(member_ids),
        "shared_instruments": sorted(instruments),
        "baseline_usage_of_instruments": dict(sorted(usage.items())),
        "expected_interpretation": (
            "a connected component of accounts over shared instruments; "
            "normal spend per account, abnormal topology"
        ),
    }
    plan.required_evidence = [*sorted(member_ids)[:3], *sorted(instruments)]


def _draw_market(plan: ScenarioPlanter, eligible: list[str]) -> str:
    """Draw the scenario market from the eligible candidates."""
    if not eligible:
        raise RuntimeError(f"scenario {plan.spec.scenario_id}: no eligible market")
    return str(plan.rng.choice(eligible))
