"""World assembly: builds every table for one deterministic generation run.

Table schemas follow docs/01-synthetic-data-spec.md section 6 and 7.
Provenance (docs/01 section 10) is recorded per table in the manifest:
source identity is (source_system, source_table, primary key), and
ingestion_version is stamped when Phase 4 materialises graph nodes.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from app.datasets import activity, documents, entities, marketing, operations
from app.datasets.config import GENERATOR_VERSION, PROFILES, GenerationConfig
from app.datasets.rng import stream
from app.datasets.util import split_columns

TABLE_SCHEMAS: dict[str, str] = {
    "markets": "market_id VARCHAR, market_code VARCHAR, market_name VARCHAR, currency_code VARCHAR, primary_language VARCHAR, timezone VARCHAR, digital_maturity DOUBLE, retail_intensity DOUBLE",
    "regions": "region_id VARCHAR, market_id VARCHAR, name VARCHAR",
    "currencies": "currency_code VARCHAR, name VARCHAR",
    "languages": "language_code VARCHAR, name VARCHAR",
    "channels": "channel_code VARCHAR, description VARCHAR",
    "suppliers": "supplier_id VARCHAR, name VARCHAR",
    "business_concepts": "concept_id VARCHAR, concept_type VARCHAR, description VARCHAR",
    "game_families": "family_id VARCHAR, name VARCHAR",
    "game_categories": "category_code VARCHAR, name VARCHAR",
    "game_mechanics": "mechanic_id VARCHAR, mechanic_code VARCHAR, description VARCHAR",
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
                "business_concepts",
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

_TABLE_ORDER = list(TABLE_SCHEMAS)


class World:
    """One generated world: rows per table plus the reproducibility manifest."""

    def __init__(self, config: GenerationConfig, tables: dict[str, list[tuple[Any, ...]]]) -> None:
        self.config = config
        self.tables = tables
        self.generated_at = datetime.now(UTC)
        # Baseline volumes plus planted rows (scenario layer, Phase 5).
        self.planted: dict[str, int] = {}
        self.manifest: dict[str, Any] = {
            "generator_version": GENERATOR_VERSION,
            "profile": config.profile,
            "world_seed": config.world_seed,
            "scenario_seed": config.scenario_seed,
            "generated_at": self.generated_at.isoformat(),
            "row_counts": {name: len(tables[name]) for name in _TABLE_ORDER},
            "provenance": {
                name: {
                    "source_system": TABLE_PROVENANCE[name][0],
                    "source_table": TABLE_PROVENANCE[name][1],
                }
                for name in _TABLE_ORDER
            },
        }


def build_data_dictionary() -> list[dict[str, Any]]:
    """Machine-readable data dictionary (docs/data/data-dictionary.md).

    Derived from TABLE_SCHEMAS and TABLE_PROVENANCE so the dictionary can
    never drift from the generated schema. Nullability and foreign keys are
    enforced by app.datasets.validation rather than Parquet constraints.
    """
    dictionary: list[dict[str, Any]] = []
    for table in _TABLE_ORDER:
        source_system, source_table = TABLE_PROVENANCE[table]
        for position, (field, field_type) in enumerate(split_columns(TABLE_SCHEMAS[table])):
            dictionary.append(
                {
                    "table": table,
                    "field": field,
                    "type": field_type,
                    "position": position,
                    "primary_key": position == 0,
                    "source_system": source_system,
                    "source_table": source_table,
                    "sensitivity": "none (synthetic)",
                }
            )
    return dictionary


def build_world(config: GenerationConfig) -> World:
    """Generate all tables for the configured profile deterministically."""
    volumes = PROFILES[config.profile]
    tables: dict[str, list[tuple[Any, ...]]] = {}

    tables.update(entities.generate_master_rows())
    tables.update(entities.generate_games())

    rng_retailers = stream(config.world_seed, "retailers")
    tables["retailers"] = entities.generate_retailers(rng_retailers, volumes.retailers)
    tables.update(entities.generate_platform_layer())

    rng_players = stream(config.world_seed, "players")
    tables.update(
        entities.generate_players_and_devices(rng_players, volumes.players, volumes.devices)
    )

    rng_draws = stream(config.world_seed, "draws")
    tables["draws"] = activity.generate_draws(rng_draws, tables["games"])

    rng_tickets = stream(config.world_seed, "tickets")
    tickets, prizes = activity.generate_tickets_and_prizes(
        rng_tickets,
        tables["players"],
        tables["games"],
        tables["retailers"],
        tables["draws"],
        volumes.tickets,
    )
    tables["tickets"] = tickets
    tables["prizes"] = prizes

    rng_campaigns = stream(config.world_seed, "campaigns")
    tables.update(marketing.generate_campaigns(rng_campaigns, tables["games"]))

    rng_exposures = stream(config.world_seed, "exposures")
    tables["campaign_exposures"] = marketing.generate_exposures(
        rng_exposures,
        tables["campaigns"],
        tables["campaign_game_map"],
        tables["players"],
        volumes.campaign_exposures,
    )

    rng_incidents = stream(config.world_seed, "incidents")
    incidents, incident_games = operations.generate_incidents(
        rng_incidents,
        tables["platforms"],
        tables["platform_versions"],
        tables["app_versions"],
        tables["games"],
        total=25,
    )
    tables["incidents"] = incidents
    tables["incident_game_map"] = incident_games

    rng_support = stream(config.world_seed, "support")
    tables["support_cases"] = operations.generate_support_cases(
        rng_support, tables["players"], tables["games"], incidents, volumes.support_cases
    )
    tables["experiments"] = operations.generate_experiments(
        stream(config.world_seed, "experiments")
    )

    rng_sessions = stream(config.world_seed, "sessions")
    devices_by_player: dict[str, list[str]] = {}
    for player_id, device_id, *_ in tables["player_device"]:
        devices_by_player.setdefault(player_id, []).append(device_id)
    app_versions_by_market: dict[str, list[tuple[Any, ...]]] = {}
    for version in tables["app_versions"]:
        app_versions_by_market.setdefault(version[1], []).append(version)
    tables["sessions"] = activity.generate_sessions(
        rng_sessions,
        tables["players"],
        devices_by_player,
        app_versions_by_market,
        volumes.sessions,
    )

    rng_documents = stream(config.world_seed, "documents")
    docs, chunks = documents.generate_documents(
        rng_documents,
        volumes.documents,
        tables["games"],
        incidents,
        tables["campaigns"],
        tables["app_versions"],
        tables["experiments"],
    )
    tables["documents"] = docs
    tables["document_chunks"] = chunks

    market_currency = {row[0]: row[3] for row in tables["markets"]}
    tables["kpi_daily"] = activity.generate_kpi_daily(
        tickets,
        tables["sessions"],
        tables["support_cases"],
        tables["campaign_exposures"],
        market_currency,
    )

    missing = [name for name in _TABLE_ORDER if name not in tables]
    if missing:
        raise RuntimeError(f"generator did not produce tables: {missing}")
    return World(config, tables)
