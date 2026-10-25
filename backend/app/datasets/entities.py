"""Entity generators: games, retailers, platforms, players, devices, payments."""

from __future__ import annotations

import random
from datetime import date, datetime, time, timedelta
from typing import Any

from app.datasets.config import WINDOW_START
from app.datasets.distributions import (
    DIGITAL_AFFINITY_MEAN,
    DIGITAL_AFFINITY_SD,
    ENGAGEMENT_SEGMENT_WEIGHTS,
    MARKET_DEVICE_SHARE,
    MARKET_RETAIL_SHARE,
    MARKET_SPLIT,
    PROVIDER_MIX,
    RETAILER_AGENT_SHARE,
    SECOND_DEVICE_SHARE,
    SHARED_PAYMENT_POOL_SIZE,
    SHARED_PAYMENT_SHARE,
    VALUE_SEGMENT_WEIGHTS,
)
from app.datasets.master_data import (
    CHANNELS,
    CURRENCIES,
    GAME_SPECS,
    LANGUAGES,
    MARKET_CURRENCY,
    MARKETS,
    PLATFORMS,
    REGIONS,
    SUPPLIERS,
)
from app.datasets.rows import (
    AccountRow,
    AppVersionRow,
    ChannelRow,
    DeviceRow,
    GameMechanicMapRow,
    GameRow,
    PaymentMethodRow,
    PlatformRow,
    PlatformVersionRow,
    PlayerDeviceRow,
    PlayerPaymentMethodRow,
    PlayerRow,
    RetailerRow,
    SupplierRow,
)
from app.datasets.taxonomies import (
    GAME_CATEGORIES,
    GAME_FAMILIES,
    GAME_MECHANICS,
    INCIDENT_TYPES,
    PAYMENT_PROVIDERS,
    PLAYER_SEGMENTS,
    SUPPORT_CATEGORIES,
    segments_for,
)
from app.datasets.util import money

_SHARED_POOL_PROVIDER = "PP_BLUEHARBOR"


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
        "currencies": list(CURRENCIES),
        "languages": list(LANGUAGES),
        "channels": [ChannelRow(*channel) for channel in CHANNELS],
        "suppliers": [SupplierRow(*supplier) for supplier in SUPPLIERS],
        "game_families": list(GAME_FAMILIES),
        "game_categories": list(GAME_CATEGORIES),
        "game_mechanics": list(GAME_MECHANICS),
        "incident_types": list(INCIDENT_TYPES),
        "support_categories": list(SUPPORT_CATEGORIES),
        "player_segments": list(PLAYER_SEGMENTS),
        "payment_providers": list(PAYMENT_PROVIDERS),
    }


def generate_games() -> dict[str, list[Any]]:
    """Synthetic game catalogue and mechanic mapping."""
    games: list[GameRow] = []
    mechanic_map: list[GameMechanicMapRow] = []
    for spec in GAME_SPECS:
        launch = date.fromordinal(WINDOW_START.toordinal() - spec.launch_offset_days)
        games.append(
            GameRow(
                game_id=spec.game_id,
                market_id=f"MKT_{spec.market_code}",
                game_name=spec.name,
                game_family_id=spec.family_id,
                game_category_code=spec.category_id,
                launch_date=launch,
                retirement_date=None,
                status="ACTIVE",
                ticket_price=money(spec.price_minor),
                currency_code=MARKET_CURRENCY[spec.market_code],
                draw_frequency_code=spec.draw_frequency or "NONE",
                jackpot_type_code=spec.jackpot_type,
                prize_model_code=spec.prize_model,
                digital_enabled=spec.digital,
                retail_enabled=spec.retail,
            )
        )
        for importance, mechanic_id in enumerate(spec.mechanics, start=1):
            mechanic_map.append(
                GameMechanicMapRow(
                    game_id=spec.game_id,
                    mechanic_id=mechanic_id,
                    importance_weight=float(importance),
                    valid_from=launch,
                    valid_to=None,
                )
            )
    return {"games": games, "game_mechanic_map": mechanic_map}


def generate_retailers(rng: random.Random, total: int) -> list[RetailerRow]:
    """Synthetic retail network, split across markets and regions."""
    rows: list[RetailerRow] = []
    counts = _split(total, MARKET_RETAIL_SHARE)
    index = 0
    for code in ("UK", "GR", "AT", "CZ"):
        market_regions = [r.region_id for r in REGIONS if r.market_id == f"MKT_{code}"]
        for i in range(counts[code]):
            index += 1
            active_from = date(2024, 12, 1) + timedelta(days=index % 30)
            rows.append(
                RetailerRow(
                    retailer_id=f"RET_{code}_{i + 1:05d}",
                    market_id=f"MKT_{code}",
                    region_id=market_regions[index % len(market_regions)],
                    retailer_type="AGENT" if rng.random() < RETAILER_AGENT_SHARE else "KIOSK",
                    active_from=active_from,
                    active_to=None,
                    synthetic_cluster=f"CLUSTER_{code}_{index % 12:02d}",
                )
            )
    return rows


def generate_platform_layer() -> dict[str, list[Any]]:
    """Platforms, platform versions and per-market app versions."""
    platform_rows = [
        PlatformRow(platform_id=pid, platform_name=name, platform_type=kind, supplier_id=supplier)
        for pid, name, kind, supplier in PLATFORMS
    ]
    version_rows: list[PlatformVersionRow] = []
    for platform in platform_rows:
        for v in range(1, 4):
            version_rows.append(
                PlatformVersionRow(
                    platform_version_id=f"PLV_{platform.platform_id[4:]}_{v}",
                    platform_id=platform.platform_id,
                    version_label=f"2024.{v}.0",
                    released_at=datetime(2024, 5 + v, 1),
                    retired_at=None,
                )
            )
    app_version_rows: list[AppVersionRow] = []
    labels = ["5.2.0", "5.3.0", "5.3.1", "5.4.0"]
    os_buckets = ["14", "14", "15", "15"]
    for code in ("UK", "GR", "AT", "CZ"):
        for i, label in enumerate(labels):
            app_version_rows.append(
                AppVersionRow(
                    app_version_id=f"APPV_{code}_{label.replace('.', '')}",
                    market_id=f"MKT_{code}",
                    version_label=label,
                    released_at=datetime.combine(WINDOW_START, time.min)
                    + timedelta(days=10 + i * 80),
                    min_os_bucket=os_buckets[i],
                )
            )
    return {
        "platforms": platform_rows,
        "platform_versions": version_rows,
        "app_versions": app_version_rows,
    }


def generate_players_and_devices(
    rng: random.Random, players_total: int, devices_total: int
) -> dict[str, list[Any]]:
    """Players, accounts, devices and device/payment links."""
    players: list[PlayerRow] = []
    accounts: list[AccountRow] = []
    devices: list[DeviceRow] = []
    player_device: list[PlayerDeviceRow] = []
    payment_methods: list[PaymentMethodRow] = []
    player_payment: list[PlayerPaymentMethodRow] = []

    device_counts = _split(devices_total, MARKET_DEVICE_SHARE)
    player_counts = _split(players_total, MARKET_SPLIT)
    shared_payment_pool = [f"PAY_SHARED_{i:03d}" for i in range(SHARED_PAYMENT_POOL_SIZE)]
    device_families = ("IOS", "ANDROID", "WEB")
    os_by_family = {"IOS": "18", "ANDROID": "15", "WEB": "-"}

    payment_index = 1
    for code in ("UK", "GR", "AT", "CZ"):
        market_id = f"MKT_{code}"
        value_segments = segments_for(code, "VALUE")
        engagement_segments = segments_for(code, "ENGAGEMENT")
        provider_mix = PROVIDER_MIX[code]
        market_devices = [f"DEV_{code}_{i + 1:06d}" for i in range(device_counts[code])]
        for i, device_id in enumerate(market_devices):
            family = device_families[i % 3]
            devices.append(
                DeviceRow(
                    device_id=device_id,
                    device_fingerprint=f"fp-{device_id.lower()}-{i % 7}",
                    device_family=family,
                    os_version_bucket=os_by_family[family],
                    app_capable=family != "WEB",
                    first_seen_at=datetime(2024, 11, 1 + (i % 27)),
                )
            )

        for i in range(player_counts[code]):
            player_id = f"PLAYER_{code}_{i + 1:06d}"
            registration = WINDOW_START + timedelta(days=rng.randrange(200))
            registered_at = datetime.combine(registration, time.min)
            value_seg = rng.choices(value_segments, weights=VALUE_SEGMENT_WEIGHTS)[0]
            engagement_seg = rng.choices(engagement_segments, weights=ENGAGEMENT_SEGMENT_WEIGHTS)[0]
            digital_affinity = round(
                min(1.0, max(0.05, rng.gauss(DIGITAL_AFFINITY_MEAN[code], DIGITAL_AFFINITY_SD))), 3
            )
            players.append(
                PlayerRow(
                    player_id=player_id,
                    market_id=market_id,
                    synthetic_age_band=rng.choice(
                        ("AGE_18_24", "AGE_25_34", "AGE_35_44", "AGE_45_54", "AGE_55_PLUS")
                    ),
                    synthetic_region_id=rng.choice(
                        [r.region_id for r in REGIONS if r.market_id == market_id]
                    ),
                    registration_date=registration,
                    acquisition_channel=rng.choice(
                        ("PAID_SOCIAL", "ORGANIC", "RETAIL_CROSSSELL", "REFERRAL")
                    ),
                    account_status="ACTIVE",
                    value_segment=value_seg,
                    engagement_segment=engagement_seg,
                    digital_affinity=digital_affinity,
                    retail_affinity=round(
                        min(1.0, max(0.05, 1.0 - digital_affinity + rng.gauss(0, 0.1))), 3
                    ),
                )
            )
            accounts.append(
                AccountRow(
                    account_id=f"ACCT_{code}_{i + 1:06d}",
                    player_id=player_id,
                    created_at=registered_at + timedelta(hours=rng.randrange(72)),
                    status="ACTIVE",
                    verification_state="VERIFIED",
                    preferred_channel=rng.choice(("APP", "WEB")),
                )
            )

            # Devices: one primary per player; some also use a second device, so a
            # minority of devices is shared (docs/reference/01 distribution rules).
            primary = market_devices[rng.randrange(len(market_devices))]
            player_device.append(
                PlayerDeviceRow(
                    player_id=player_id,
                    device_id=primary,
                    first_seen_at=registered_at,
                    last_seen_at=registered_at + timedelta(days=rng.randrange(150)),
                    usage_weight=1.0,
                )
            )
            if rng.random() < SECOND_DEVICE_SHARE:
                secondary = market_devices[rng.randrange(len(market_devices))]
                if secondary != primary:
                    player_device.append(
                        PlayerDeviceRow(
                            player_id=player_id,
                            device_id=secondary,
                            first_seen_at=registered_at,
                            last_seen_at=None,
                            usage_weight=0.3,
                        )
                    )

            # Payments: most players own a unique method; the rest share pool methods.
            if rng.random() >= SHARED_PAYMENT_SHARE:
                pm_id = f"PAY_{code}_{payment_index:07d}"
                payment_index += 1
                created = registered_at + timedelta(days=rng.randrange(30))
                payment_methods.append(
                    PaymentMethodRow(
                        payment_method_id=pm_id,
                        provider_id=rng.choices(
                            list(provider_mix), weights=list(provider_mix.values())
                        )[0],
                        payment_type=rng.choice(("CARD", "WALLET", "BANK")),
                        synthetic_token=f"tok-{pm_id.lower()}",
                        created_at=created,
                    )
                )
                player_payment.append(
                    PlayerPaymentMethodRow(
                        player_id=player_id,
                        payment_method_id=pm_id,
                        first_used_at=created,
                        last_used_at=None,
                        usage_weight=1.0,
                    )
                )
            else:
                player_payment.append(
                    PlayerPaymentMethodRow(
                        player_id=player_id,
                        payment_method_id=shared_payment_pool[
                            rng.randrange(len(shared_payment_pool))
                        ],
                        first_used_at=registered_at,
                        last_used_at=None,
                        usage_weight=1.0,
                    )
                )

    pool_created = datetime.combine(WINDOW_START, time.min)
    payment_methods.extend(
        PaymentMethodRow(
            payment_method_id=pm_id,
            provider_id=_SHARED_POOL_PROVIDER,
            payment_type="WALLET",
            synthetic_token=f"tok-{pm_id.lower()}",
            created_at=pool_created,
        )
        for pm_id in shared_payment_pool
    )
    payment_methods.sort(key=lambda row: row.payment_method_id)

    return {
        "players": players,
        "accounts": accounts,
        "devices": devices,
        "player_device": player_device,
        "payment_methods": payment_methods,
        "player_payment_method": player_payment,
    }
