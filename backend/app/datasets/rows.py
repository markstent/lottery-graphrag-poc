"""One NamedTuple per warehouse table; fields equal the DDL column names.

Row types are the typed shape of generated rows. `ROW_TYPES` is keyed by table
name and is checked against `schema.TABLE_SCHEMAS` by the test suite.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import NamedTuple


class MarketRow(NamedTuple):
    market_id: str
    market_code: str
    market_name: str
    currency_code: str
    primary_language: str
    timezone: str
    digital_maturity: float
    retail_intensity: float


class RegionRow(NamedTuple):
    region_id: str
    market_id: str
    name: str


class CurrencyRow(NamedTuple):
    currency_code: str
    name: str


class LanguageRow(NamedTuple):
    language_code: str
    name: str


class ChannelRow(NamedTuple):
    channel_code: str
    description: str


class SupplierRow(NamedTuple):
    supplier_id: str
    name: str


class GameFamilyRow(NamedTuple):
    family_id: str
    name: str
    market_id: str
    language_code: str


class GameCategoryRow(NamedTuple):
    category_code: str
    name: str
    market_id: str
    language_code: str


class GameMechanicRow(NamedTuple):
    mechanic_id: str
    mechanic_code: str
    description: str
    market_id: str
    language_code: str


class IncidentTypeRow(NamedTuple):
    incident_type_id: str
    market_id: str | None
    name: str
    language_code: str


class SupportCategoryRow(NamedTuple):
    support_category_id: str
    market_id: str
    name: str
    language_code: str


class PlayerSegmentRow(NamedTuple):
    segment_id: str
    market_id: str
    segment_kind: str
    name: str
    language_code: str


class PaymentProviderRow(NamedTuple):
    provider_id: str
    name: str
    home_market_id: str | None
    platform_id: str


class GameRow(NamedTuple):
    game_id: str
    market_id: str
    game_name: str
    game_family_id: str
    game_category_code: str
    launch_date: date
    retirement_date: date | None
    status: str
    ticket_price: Decimal
    currency_code: str
    draw_frequency_code: str
    jackpot_type_code: str
    prize_model_code: str
    digital_enabled: bool
    retail_enabled: bool


class GameMechanicMapRow(NamedTuple):
    game_id: str
    mechanic_id: str
    importance_weight: float
    valid_from: date | None
    valid_to: date | None


class PlatformRow(NamedTuple):
    platform_id: str
    platform_name: str
    platform_type: str
    supplier_id: str


class PlatformVersionRow(NamedTuple):
    platform_version_id: str
    platform_id: str
    version_label: str
    released_at: datetime
    retired_at: datetime | None


class AppVersionRow(NamedTuple):
    app_version_id: str
    market_id: str
    version_label: str
    released_at: datetime
    min_os_bucket: str


class PlayerRow(NamedTuple):
    player_id: str
    market_id: str
    synthetic_age_band: str
    synthetic_region_id: str
    registration_date: date
    acquisition_channel: str
    account_status: str
    value_segment: str
    engagement_segment: str
    digital_affinity: float
    retail_affinity: float


class AccountRow(NamedTuple):
    account_id: str
    player_id: str
    created_at: datetime
    status: str
    verification_state: str
    preferred_channel: str


class DeviceRow(NamedTuple):
    device_id: str
    device_fingerprint: str
    device_family: str
    os_version_bucket: str
    app_capable: bool
    first_seen_at: datetime


class PlayerDeviceRow(NamedTuple):
    player_id: str
    device_id: str
    first_seen_at: datetime
    last_seen_at: datetime | None
    usage_weight: float


class PaymentMethodRow(NamedTuple):
    payment_method_id: str
    provider_id: str
    payment_type: str
    synthetic_token: str
    created_at: datetime


class PlayerPaymentMethodRow(NamedTuple):
    player_id: str
    payment_method_id: str
    first_used_at: datetime
    last_used_at: datetime | None
    usage_weight: float


class RetailerRow(NamedTuple):
    retailer_id: str
    market_id: str
    region_id: str
    retailer_type: str
    active_from: date
    active_to: date | None
    synthetic_cluster: str


class DrawRow(NamedTuple):
    draw_id: str
    game_id: str
    draw_timestamp: datetime
    jackpot_amount: Decimal
    currency_code: str
    result_payload: str
    rollover_count: int


class TicketRow(NamedTuple):
    ticket_id: str
    player_id: str
    game_id: str
    market_id: str
    draw_id: str | None
    retailer_id: str | None
    channel_code: str
    purchase_timestamp: datetime
    stake_amount: Decimal
    currency_code: str
    ticket_status: str


class PrizeRow(NamedTuple):
    prize_id: str
    ticket_id: str
    prize_tier: str
    prize_amount: Decimal
    currency_code: str
    claimed: bool


class SessionRow(NamedTuple):
    session_id: str
    player_id: str
    market_id: str
    device_id: str | None
    channel_code: str
    started_at: datetime
    ended_at: datetime | None
    app_version_id: str | None
    session_outcome: str


class CampaignRow(NamedTuple):
    campaign_id: str
    market_id: str
    campaign_name: str
    campaign_type: str
    start_at: datetime
    end_at: datetime
    budget_amount: Decimal
    currency_code: str
    objective_code: str


class CampaignGameMapRow(NamedTuple):
    campaign_id: str
    game_id: str
    promotion_weight: float


class CampaignExposureRow(NamedTuple):
    exposure_id: str
    campaign_id: str
    player_id: str
    channel_code: str
    exposed_at: datetime
    engaged: bool
    converted_game_id: str | None
    converted_at: datetime | None


class IncidentRow(NamedTuple):
    incident_id: str
    market_id: str
    platform_id: str
    platform_version_id: str | None
    app_version_id: str | None
    incident_type: str
    severity: str
    started_at: datetime
    resolved_at: datetime | None
    summary: str
    root_cause_code: str | None


class IncidentGameMapRow(NamedTuple):
    incident_id: str
    game_id: str
    impact_weight: float


class SupportCaseRow(NamedTuple):
    support_case_id: str
    market_id: str
    player_id: str | None
    game_id: str | None
    incident_id: str | None
    opened_at: datetime
    closed_at: datetime | None
    category_code: str
    sentiment_score: float
    summary_text: str


class KpiDailyRow(NamedTuple):
    date: date
    market_id: str
    game_id: str | None
    channel_code: str
    metric_code: str
    metric_value: float
    currency_code: str


class ExperimentRow(NamedTuple):
    experiment_id: str
    market_id: str
    experiment_name: str
    hypothesis: str
    start_at: datetime
    end_at: datetime
    target_segment: str
    primary_metric: str
    result_summary: str | None


class DocumentRow(NamedTuple):
    document_id: str
    document_type: str
    market_id: str | None
    language_code: str
    title: str
    created_at: datetime
    valid_from: datetime | None
    valid_to: datetime | None
    source_system_code: str
    source_record_id: str
    body: str


class DocumentChunkRow(NamedTuple):
    chunk_id: str
    document_id: str
    chunk_index: int
    text: str
    token_count: int
    embedding_version: str


ROW_TYPES: dict[str, type[tuple[object, ...]]] = {
    "markets": MarketRow,
    "regions": RegionRow,
    "currencies": CurrencyRow,
    "languages": LanguageRow,
    "channels": ChannelRow,
    "suppliers": SupplierRow,
    "game_families": GameFamilyRow,
    "game_categories": GameCategoryRow,
    "game_mechanics": GameMechanicRow,
    "incident_types": IncidentTypeRow,
    "support_categories": SupportCategoryRow,
    "player_segments": PlayerSegmentRow,
    "payment_providers": PaymentProviderRow,
    "games": GameRow,
    "game_mechanic_map": GameMechanicMapRow,
    "platforms": PlatformRow,
    "platform_versions": PlatformVersionRow,
    "app_versions": AppVersionRow,
    "players": PlayerRow,
    "accounts": AccountRow,
    "devices": DeviceRow,
    "player_device": PlayerDeviceRow,
    "payment_methods": PaymentMethodRow,
    "player_payment_method": PlayerPaymentMethodRow,
    "retailers": RetailerRow,
    "draws": DrawRow,
    "tickets": TicketRow,
    "prizes": PrizeRow,
    "sessions": SessionRow,
    "campaigns": CampaignRow,
    "campaign_game_map": CampaignGameMapRow,
    "campaign_exposures": CampaignExposureRow,
    "incidents": IncidentRow,
    "incident_game_map": IncidentGameMapRow,
    "support_cases": SupportCaseRow,
    "kpi_daily": KpiDailyRow,
    "experiments": ExperimentRow,
    "documents": DocumentRow,
    "document_chunks": DocumentChunkRow,
}
