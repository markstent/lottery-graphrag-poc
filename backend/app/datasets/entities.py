"""Entity generators: games, retailers, platforms, players, devices, payments."""

from __future__ import annotations

import random
from datetime import date, datetime, time, timedelta
from typing import Any

from app.datasets.config import WINDOW_START
from app.datasets.distributions import MARKET_DEVICE_SHARE, MARKET_RETAIL_SHARE, MARKET_SPLIT
from app.datasets.master_data import (
    CHANNELS,
    GAME_SPECS,
    MARKET_CURRENCY,
    MARKETS,
    PLATFORMS,
    REGIONS,
    SUPPLIERS,
)
from app.datasets.taxonomies import (
    GAME_CATEGORIES,
    GAME_FAMILIES,
    GAME_MECHANICS,
    INCIDENT_TYPES,
    PAYMENT_PROVIDERS,
    PLAYER_SEGMENTS,
    SUPPORT_CATEGORIES,
)
from app.datasets.util import money


def _split(total: int, shares: dict[str, float]) -> dict[str, int]:
    """Deterministically split a total across markets, preserving the sum."""
    raw = {code: total * share for code, share in shares.items()}
    counts = {code: int(v) for code, v in raw.items()}
    remainder = total - sum(counts.values())
    over = sorted(raw, key=lambda c: raw[c] - int(raw[c]), reverse=True)[:remainder]
    for code in over:
        counts[code] += 1
    return counts


def generate_master_rows() -> dict[str, list[tuple[Any, ...]]]:
    """Fixed master tables (no randomness)."""
    return {
        "markets": list(MARKETS),
        "regions": list(REGIONS),
        "currencies": [("GBP", "Pound sterling"), ("EUR", "Euro"), ("CZK", "Czech koruna")],
        "languages": [("en", "English"), ("el", "Greek"), ("de", "German"), ("cs", "Czech")],
        "channels": list(CHANNELS),
        "suppliers": list(SUPPLIERS),
        "game_families": list(GAME_FAMILIES),
        "game_categories": list(GAME_CATEGORIES),
        "game_mechanics": list(GAME_MECHANICS),
        "incident_types": list(INCIDENT_TYPES),
        "support_categories": list(SUPPORT_CATEGORIES),
        "player_segments": list(PLAYER_SEGMENTS),
        "payment_providers": list(PAYMENT_PROVIDERS),
    }


def generate_games() -> dict[str, list[tuple[Any, ...]]]:
    """Synthetic game catalogue and mechanic mapping."""
    games: list[tuple[Any, ...]] = []
    mechanic_map: list[tuple[Any, ...]] = []
    for spec in GAME_SPECS:
        launch = date.fromordinal(WINDOW_START.toordinal() - spec.launch_offset_days)
        games.append(
            (
                spec.game_id,
                f"MKT_{spec.market_code}",
                spec.name,
                spec.family_id,
                spec.category_id,
                launch,
                None,
                "ACTIVE",
                money(spec.price_minor),
                MARKET_CURRENCY[spec.market_code],
                spec.draw_frequency or "NONE",
                spec.jackpot_type,
                spec.prize_model,
                spec.digital,
                spec.retail,
            )
        )
        for importance, mechanic_id in enumerate(spec.mechanics, start=1):
            mechanic_map.append((spec.game_id, mechanic_id, float(importance), launch, None))
    return {"games": games, "game_mechanic_map": mechanic_map}


def generate_retailers(rng: random.Random, total: int) -> list[tuple[Any, ...]]:
    """Synthetic retail network, split across markets and regions."""
    rows: list[tuple[Any, ...]] = []
    counts = _split(total, MARKET_RETAIL_SHARE)
    index = 0
    for code in ("UK", "GR", "AT", "CZ"):
        market_regions = [r[0] for r in REGIONS if r[1] == f"MKT_{code}"]
        for i in range(counts[code]):
            index += 1
            active_from = date(2024, 12, 1) + timedelta(days=index % 30)
            rows.append(
                (
                    f"RET_{code}_{i + 1:05d}",
                    f"MKT_{code}",
                    market_regions[index % len(market_regions)],
                    "AGENT" if rng.random() < 0.7 else "KIOSK",
                    active_from,
                    None,
                    f"CLUSTER_{code}_{index % 12:02d}",
                )
            )
    return rows


def generate_platform_layer() -> dict[str, list[tuple[Any, ...]]]:
    """Platforms, platform versions and per-market app versions."""
    platform_rows = list(PLATFORMS)
    version_rows: list[tuple[Any, ...]] = []
    for pid, _, _, _ in PLATFORMS:
        for v in range(1, 4):
            version_rows.append(
                (
                    f"PLV_{pid[4:]}_{v}",
                    pid,
                    f"2024.{v}.0",
                    datetime(2024, 5 + v, 1),
                    None,
                )
            )
    app_version_rows: list[tuple[Any, ...]] = []
    labels = ["5.2.0", "5.3.0", "5.3.1", "5.4.0"]
    os_buckets = ["14", "14", "15", "15"]
    for code in ("UK", "GR", "AT", "CZ"):
        for i, label in enumerate(labels):
            app_version_rows.append(
                (
                    f"APPV_{code}_{label.replace('.', '')}",
                    f"MKT_{code}",
                    label,
                    WINDOW_START + timedelta(days=10 + i * 80),
                    os_buckets[i],
                )
            )
    return {
        "platforms": platform_rows,
        "platform_versions": version_rows,
        "app_versions": app_version_rows,
    }


def generate_players_and_devices(
    rng: random.Random, players_total: int, devices_total: int
) -> dict[str, list[tuple[Any, ...]]]:
    """Players, accounts, devices and device/payment links."""
    players: list[tuple[Any, ...]] = []
    accounts: list[tuple[Any, ...]] = []
    devices: list[tuple[Any, ...]] = []
    player_device: list[tuple[Any, ...]] = []
    payment_methods: list[tuple[Any, ...]] = []
    player_payment: list[tuple[Any, ...]] = []

    value_weights = [0.10, 0.55, 0.35]
    engagement_weights = [0.30, 0.45, 0.25]
    device_counts = _split(devices_total, MARKET_DEVICE_SHARE)
    player_counts = _split(players_total, MARKET_SPLIT)
    shared_payment_pool = [f"PAY_SHARED_{i:03d}" for i in range(80)]
    device_families = ("IOS", "ANDROID", "WEB")
    os_by_family = {"IOS": "18", "ANDROID": "15", "WEB": "-"}

    payment_index = 1
    for code in ("UK", "GR", "AT", "CZ"):
        market_id = f"MKT_{code}"
        market_devices = [f"DEV_{code}_{i + 1:06d}" for i in range(device_counts[code])]
        for i, device_id in enumerate(market_devices):
            family = device_families[i % 3]
            devices.append(
                (
                    device_id,
                    f"fp-{device_id.lower()}-{i % 7}",
                    family,
                    os_by_family[family],
                    family != "WEB",
                    date(2024, 11, 1 + (i % 27)),
                )
            )

        for i in range(player_counts[code]):
            player_id = f"PLAYER_{code}_{i + 1:06d}"
            registration = WINDOW_START + timedelta(days=rng.randrange(200))
            value_seg = rng.choices(
                ("SEG_VALUE_VIP", "SEG_VALUE_MAINSTREAM", "SEG_VALUE_BUDGET"),
                weights=value_weights,
            )[0]
            engagement_seg = rng.choices(
                ("SEG_ENG_ENGAGED", "SEG_ENG_CASUAL", "SEG_ENG_DORMANT"),
                weights=engagement_weights,
            )[0]
            base_affinity = 0.6 if code == "UK" else 0.45
            digital_affinity = round(min(1.0, max(0.05, rng.gauss(base_affinity, 0.2))), 3)
            players.append(
                (
                    player_id,
                    market_id,
                    rng.choice(("AGE_18_24", "AGE_25_34", "AGE_35_44", "AGE_45_54", "AGE_55_PLUS")),
                    rng.choice([r[0] for r in REGIONS if r[1] == market_id]),
                    registration,
                    rng.choice(("PAID_SOCIAL", "ORGANIC", "RETAIL_CROSSSELL", "REFERRAL")),
                    "ACTIVE",
                    value_seg,
                    engagement_seg,
                    digital_affinity,
                    round(min(1.0, max(0.05, 1.0 - digital_affinity + rng.gauss(0, 0.1))), 3),
                )
            )
            accounts.append(
                (
                    f"ACCT_{code}_{i + 1:06d}",
                    player_id,
                    datetime.combine(registration, time.min) + timedelta(hours=rng.randrange(72)),
                    "ACTIVE",
                    "VERIFIED",
                    rng.choice(("APP", "WEB")),
                )
            )

            # Devices: one primary per player; 8% also use a second device, so a
            # minority of devices is shared (docs/01 distribution rules).
            primary = market_devices[rng.randrange(len(market_devices))]
            player_device.append(
                (
                    player_id,
                    primary,
                    registration,
                    registration + timedelta(days=rng.randrange(150)),
                    1.0,
                )
            )
            if rng.random() < 0.08:
                secondary = market_devices[rng.randrange(len(market_devices))]
                if secondary != primary:
                    player_device.append((player_id, secondary, registration, None, 0.3))

            # Payments: unique methods for 96% of players; 4% share pool methods.
            if rng.random() < 0.96:
                pm_id = f"PAY_{code}_{payment_index:07d}"
                payment_index += 1
                created = datetime.combine(registration, time.min) + timedelta(
                    days=rng.randrange(30)
                )
                payment_methods.append(
                    (
                        pm_id,
                        "PP_BLUEHARBOR",
                        rng.choice(("CARD", "WALLET", "BANK")),
                        f"tok-{pm_id.lower()}",
                        created,
                    )
                )
                player_payment.append((player_id, pm_id, created, None, 1.0))
            else:
                player_payment.append(
                    (
                        player_id,
                        shared_payment_pool[rng.randrange(len(shared_payment_pool))],
                        registration,
                        None,
                        1.0,
                    )
                )

    return {
        "players": players,
        "accounts": accounts,
        "devices": devices,
        "player_device": player_device,
        "payment_methods": payment_methods,
        "player_payment_method": player_payment,
    }
