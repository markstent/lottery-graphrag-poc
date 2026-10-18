"""Relational contract: table DDL, provenance, foreign keys and id formats.

This is the single source of truth for the generated warehouse. Table schemas
follow docs/01-synthetic-data-spec.md sections 6 and 7; provenance follows
docs/data/source-system-contracts.md. Foreign keys are declared by column name
so validation and graph ingestion never depend on column positions.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.datasets.util import split_columns

TABLE_SCHEMAS: dict[str, str] = {
    "markets": "market_id VARCHAR, market_code VARCHAR, market_name VARCHAR, currency_code VARCHAR, primary_language VARCHAR, timezone VARCHAR, digital_maturity DOUBLE, retail_intensity DOUBLE",
    "regions": "region_id VARCHAR, market_id VARCHAR, name VARCHAR",
    "currencies": "currency_code VARCHAR, name VARCHAR",
    "languages": "language_code VARCHAR, name VARCHAR",
    "channels": "channel_code VARCHAR, description VARCHAR",
    "suppliers": "supplier_id VARCHAR, name VARCHAR",
    "game_families": "family_id VARCHAR, name VARCHAR, market_id VARCHAR, language_code VARCHAR",
    "game_categories": "category_code VARCHAR, name VARCHAR, market_id VARCHAR, language_code VARCHAR",
    "game_mechanics": "mechanic_id VARCHAR, mechanic_code VARCHAR, description VARCHAR, market_id VARCHAR, language_code VARCHAR",
    "incident_types": "incident_type_id VARCHAR, market_id VARCHAR, name VARCHAR, language_code VARCHAR",
    "support_categories": "support_category_id VARCHAR, market_id VARCHAR, name VARCHAR, language_code VARCHAR",
    "player_segments": "segment_id VARCHAR, market_id VARCHAR, segment_kind VARCHAR, name VARCHAR, language_code VARCHAR",
    "payment_providers": "provider_id VARCHAR, name VARCHAR, home_market_id VARCHAR, platform_id VARCHAR",
    "games": "game_id VARCHAR, market_id VARCHAR, game_name VARCHAR, game_family_id VARCHAR, game_category_code VARCHAR, launch_date DATE, retirement_date DATE, status VARCHAR, ticket_price DECIMAL(12,2), currency_code VARCHAR, draw_frequency_code VARCHAR, jackpot_type_code VARCHAR, prize_model_code VARCHAR, digital_enabled BOOLEAN, retail_enabled BOOLEAN",
    "game_mechanic_map": "game_id VARCHAR, mechanic_id VARCHAR, importance_weight DOUBLE, valid_from DATE, valid_to DATE",
    "platforms": "platform_id VARCHAR, platform_name VARCHAR, platform_type VARCHAR, supplier_id VARCHAR",
    "platform_versions": "platform_version_id VARCHAR, platform_id VARCHAR, version_label VARCHAR, released_at TIMESTAMP, retired_at TIMESTAMP",
    "app_versions": "app_version_id VARCHAR, market_id VARCHAR, version_label VARCHAR, released_at TIMESTAMP, min_os_bucket VARCHAR",
    "players": "player_id VARCHAR, market_id VARCHAR, synthetic_age_band VARCHAR, synthetic_region_id VARCHAR, registration_date DATE, acquisition_channel VARCHAR, account_status VARCHAR, value_segment VARCHAR, engagement_segment VARCHAR, digital_affinity DOUBLE, retail_affinity DOUBLE",
    "accounts": "account_id VARCHAR, player_id VARCHAR, created_at TIMESTAMP, status VARCHAR, verification_state VARCHAR, preferred_channel VARCHAR",
    "devices": "device_id VARCHAR, device_fingerprint VARCHAR, device_family VARCHAR, os_version_bucket VARCHAR, app_capable BOOLEAN, first_seen_at TIMESTAMP",
    "player_device": "player_id VARCHAR, device_id VARCHAR, first_seen_at TIMESTAMP, last_seen_at TIMESTAMP, usage_weight DOUBLE",
    "payment_methods": "payment_method_id VARCHAR, provider_id VARCHAR, payment_type VARCHAR, synthetic_token VARCHAR, created_at TIMESTAMP",
    "player_payment_method": "player_id VARCHAR, payment_method_id VARCHAR, first_used_at TIMESTAMP, last_used_at TIMESTAMP, usage_weight DOUBLE",
    "retailers": "retailer_id VARCHAR, market_id VARCHAR, region_id VARCHAR, retailer_type VARCHAR, active_from DATE, active_to DATE, synthetic_cluster VARCHAR",
    "draws": "draw_id VARCHAR, game_id VARCHAR, draw_timestamp TIMESTAMP, jackpot_amount DECIMAL(12,2), currency_code VARCHAR, result_payload VARCHAR, rollover_count INTEGER",
    "tickets": "ticket_id VARCHAR, player_id VARCHAR, game_id VARCHAR, market_id VARCHAR, draw_id VARCHAR, retailer_id VARCHAR, channel_code VARCHAR, purchase_timestamp TIMESTAMP, stake_amount DECIMAL(12,2), currency_code VARCHAR, ticket_status VARCHAR",
    "prizes": "prize_id VARCHAR, ticket_id VARCHAR, prize_tier VARCHAR, prize_amount DECIMAL(12,2), currency_code VARCHAR, claimed BOOLEAN",
    "sessions": "session_id VARCHAR, player_id VARCHAR, market_id VARCHAR, device_id VARCHAR, channel_code VARCHAR, started_at TIMESTAMP, ended_at TIMESTAMP, app_version_id VARCHAR, session_outcome VARCHAR",
    "campaigns": "campaign_id VARCHAR, market_id VARCHAR, campaign_name VARCHAR, campaign_type VARCHAR, start_at TIMESTAMP, end_at TIMESTAMP, budget_amount DECIMAL(12,2), currency_code VARCHAR, objective_code VARCHAR",
    "campaign_game_map": "campaign_id VARCHAR, game_id VARCHAR, promotion_weight DOUBLE",
    "campaign_exposures": "exposure_id VARCHAR, campaign_id VARCHAR, player_id VARCHAR, channel_code VARCHAR, exposed_at TIMESTAMP, engaged BOOLEAN, converted_game_id VARCHAR, converted_at TIMESTAMP",
    "incidents": "incident_id VARCHAR, market_id VARCHAR, platform_id VARCHAR, platform_version_id VARCHAR, app_version_id VARCHAR, incident_type VARCHAR, severity VARCHAR, started_at TIMESTAMP, resolved_at TIMESTAMP, summary VARCHAR, root_cause_code VARCHAR",
    "incident_game_map": "incident_id VARCHAR, game_id VARCHAR, impact_weight DOUBLE",
    "support_cases": "support_case_id VARCHAR, market_id VARCHAR, player_id VARCHAR, game_id VARCHAR, incident_id VARCHAR, opened_at TIMESTAMP, closed_at TIMESTAMP, category_code VARCHAR, sentiment_score DOUBLE, summary_text VARCHAR",
    "kpi_daily": "date DATE, market_id VARCHAR, game_id VARCHAR, channel_code VARCHAR, metric_code VARCHAR, metric_value DOUBLE, currency_code VARCHAR",
    "experiments": "experiment_id VARCHAR, market_id VARCHAR, experiment_name VARCHAR, hypothesis VARCHAR, start_at TIMESTAMP, end_at TIMESTAMP, target_segment VARCHAR, primary_metric VARCHAR, result_summary VARCHAR",
    "documents": "document_id VARCHAR, document_type VARCHAR, market_id VARCHAR, language_code VARCHAR, title VARCHAR, created_at TIMESTAMP, valid_from TIMESTAMP, valid_to TIMESTAMP, source_system_code VARCHAR, source_record_id VARCHAR, body VARCHAR",
    "document_chunks": "chunk_id VARCHAR, document_id VARCHAR, chunk_index INTEGER, text VARCHAR, token_count INTEGER, embedding_version VARCHAR",
}

# Source-system provenance per table (docs/data/source-system-contracts.md).
TABLE_PROVENANCE: dict[str, tuple[str, str]] = {
    table: (system, table)
    for table, system in {
        **dict.fromkeys(
            (
                "markets",
                "regions",
                "currencies",
                "languages",
                "channels",
                "suppliers",
                "incident_types",
                "support_categories",
                "player_segments",
                "payment_providers",
                "game_families",
                "game_categories",
                "game_mechanics",
                "games",
                "game_mechanic_map",
                "players",
                "accounts",
                "devices",
                "payment_methods",
                "player_payment_method",
                "retailers",
                "draws",
                "tickets",
                "prizes",
                "kpi_daily",
                "experiments",
                "player_device",
            ),
            "warehouse",
        ),
        **dict.fromkeys(("sessions",), "telemetry_platform"),
        **dict.fromkeys(("platforms", "platform_versions", "app_versions"), "release_management"),
        **dict.fromkeys(("incidents", "incident_game_map"), "incident_management"),
        **dict.fromkeys(("support_cases",), "support_platform"),
        **dict.fromkeys(
            ("campaigns", "campaign_game_map", "campaign_exposures"), "campaign_platform"
        ),
        **dict.fromkeys(("documents", "document_chunks"), "document_store"),
    }.items()
}


@dataclass(frozen=True)
class ForeignKey:
    """One child column referencing the primary key (first column) of a parent table."""

    child_table: str
    child_column: str
    parent_table: str
    nullable: bool


FOREIGN_KEYS: tuple[ForeignKey, ...] = (
    ForeignKey("regions", "market_id", "markets", False),
    ForeignKey("games", "market_id", "markets", False),
    ForeignKey("game_mechanic_map", "game_id", "games", False),
    ForeignKey("game_mechanic_map", "mechanic_id", "game_mechanics", False),
    ForeignKey("platforms", "supplier_id", "suppliers", False),
    ForeignKey("platform_versions", "platform_id", "platforms", False),
    ForeignKey("app_versions", "market_id", "markets", False),
    ForeignKey("players", "market_id", "markets", False),
    ForeignKey("players", "synthetic_region_id", "regions", False),
    ForeignKey("accounts", "player_id", "players", False),
    ForeignKey("player_device", "player_id", "players", False),
    ForeignKey("player_device", "device_id", "devices", False),
    ForeignKey("player_payment_method", "player_id", "players", False),
    ForeignKey("retailers", "market_id", "markets", False),
    ForeignKey("retailers", "region_id", "regions", False),
    ForeignKey("draws", "game_id", "games", False),
    ForeignKey("tickets", "game_id", "games", False),
    ForeignKey("tickets", "market_id", "markets", False),
    ForeignKey("tickets", "draw_id", "draws", True),
    ForeignKey("tickets", "retailer_id", "retailers", True),
    ForeignKey("prizes", "ticket_id", "tickets", False),
    ForeignKey("sessions", "player_id", "players", False),
    ForeignKey("sessions", "market_id", "markets", False),
    ForeignKey("sessions", "device_id", "devices", True),
    ForeignKey("sessions", "app_version_id", "app_versions", True),
    ForeignKey("campaigns", "market_id", "markets", False),
    ForeignKey("campaign_game_map", "campaign_id", "campaigns", False),
    ForeignKey("campaign_game_map", "game_id", "games", False),
    ForeignKey("campaign_exposures", "campaign_id", "campaigns", False),
    ForeignKey("campaign_exposures", "player_id", "players", False),
    ForeignKey("campaign_exposures", "converted_game_id", "games", True),
    ForeignKey("incidents", "platform_id", "platforms", False),
    ForeignKey("incidents", "platform_version_id", "platform_versions", True),
    ForeignKey("incidents", "app_version_id", "app_versions", True),
    ForeignKey("incident_game_map", "incident_id", "incidents", False),
    ForeignKey("incident_game_map", "game_id", "games", False),
    ForeignKey("support_cases", "market_id", "markets", False),
    ForeignKey("support_cases", "player_id", "players", True),
    ForeignKey("support_cases", "game_id", "games", True),
    ForeignKey("support_cases", "incident_id", "incidents", True),
    ForeignKey("documents", "market_id", "markets", True),
    ForeignKey("document_chunks", "document_id", "documents", False),
    ForeignKey("kpi_daily", "market_id", "markets", False),
    ForeignKey("kpi_daily", "game_id", "games", True),
    ForeignKey("experiments", "market_id", "markets", False),
    ForeignKey("games", "game_family_id", "game_families", False),
    ForeignKey("games", "game_category_code", "game_categories", False),
    ForeignKey("incidents", "incident_type", "incident_types", False),
    ForeignKey("support_cases", "category_code", "support_categories", False),
    ForeignKey("players", "value_segment", "player_segments", False),
    ForeignKey("players", "engagement_segment", "player_segments", False),
    ForeignKey("payment_methods", "provider_id", "payment_providers", False),
    ForeignKey("player_payment_method", "payment_method_id", "payment_methods", False),
    ForeignKey("game_families", "market_id", "markets", False),
    ForeignKey("game_categories", "market_id", "markets", False),
    ForeignKey("game_mechanics", "market_id", "markets", False),
    ForeignKey("incident_types", "market_id", "markets", True),
    ForeignKey("support_categories", "market_id", "markets", False),
    ForeignKey("player_segments", "market_id", "markets", False),
    ForeignKey("payment_providers", "home_market_id", "markets", True),
    ForeignKey("payment_providers", "platform_id", "platforms", False),
)

ID_FORMATS: dict[str, str] = {
    "incidents": "INC_{n:03d}",
    "documents": "DOC_{n:04d}",
    "document_chunks": "CHNK_{doc}_{n:02d}",
    "support_cases": "SUP_{n:05d}",
    "sessions": "SES_{n:08d}",
    "tickets": "TKT_{n:08d}",
    "prizes": "PRZ_{n:07d}",
    "draws": "DRAW_{game}_{n:04d}",
    "campaigns": "CMP_{n:03d}",
    "campaign_exposures": "EXPO_{n:07d}",
    "experiments": "EXP_{n:03d}",
    "players": "PLAYER_{market}_{n:06d}",
    "accounts": "ACCT_{market}_{n:06d}",
    "devices": "DEV_{market}_{n:06d}",
    "payment_methods": "PAY_{market}_{n:07d}",
    "retailers": "RET_{market}_{n:05d}",
}


def column_names(table: str) -> list[str]:
    return [name for name, _ in split_columns(TABLE_SCHEMAS[table])]


def column_index(table: str, column: str) -> int:
    return column_names(table).index(column)
