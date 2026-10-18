"""World assembly: builds every table for one deterministic generation run.

Table schemas follow docs/01-synthetic-data-spec.md section 6 and 7.
Provenance (docs/01 section 10) is recorded per table in the manifest:
source identity is (source_system, source_table, primary key), and
ingestion_version is stamped when Phase 4 materialises graph nodes.
"""

from __future__ import annotations

import sys
import time
from datetime import UTC, datetime
from typing import Any

from app.datasets import activity, documents, entities, marketing, operations
from app.datasets.config import GENERATOR_VERSION, PROFILES, GenerationConfig
from app.datasets.rng import stream
from app.datasets.rows import AppVersionRow, DocumentChunkRow, DocumentRow
from app.datasets.schema import TABLE_PROVENANCE, TABLE_SCHEMAS
from app.datasets.util import split_columns

_TABLE_ORDER = list(TABLE_SCHEMAS)


class World:
    """One generated world: rows per table plus the reproducibility manifest."""

    def __init__(self, config: GenerationConfig, tables: dict[str, list[Any]]) -> None:
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
    """Generate all tables for the configured profile deterministically.

    Stage progress goes to stderr with elapsed seconds so long profiles
    (demo) report where generation time goes. Determinism is unaffected:
    logging reads the clock, never the generators.
    """
    started = time.perf_counter()
    volumes = PROFILES[config.profile]
    tables: dict[str, list[Any]] = {}

    def _stage(label: str, rows: dict[str, list[Any]]) -> None:
        count = sum(len(values) for values in rows.values())
        print(
            f"[generate] {config.profile} {label}: {count} rows "
            f"({time.perf_counter() - started:.1f}s)",
            file=sys.stderr,
        )

    tables.update(entities.generate_master_rows())
    tables.update(entities.generate_games())
    _stage("master data", tables)

    rng_retailers = stream(config.world_seed, "retailers")
    tables["retailers"] = list(entities.generate_retailers(rng_retailers, volumes.retailers))
    tables.update(entities.generate_platform_layer())
    _stage("retailers + platforms", {"retailers": tables["retailers"]})

    rng_players = stream(config.world_seed, "players")
    tables.update(
        entities.generate_players_and_devices(rng_players, volumes.players, volumes.devices)
    )
    _stage("players + devices", {k: tables[k] for k in ("players", "devices", "player_device")})

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
    _stage("tickets + prizes", {"tickets": tickets, "prizes": prizes})

    rng_campaigns = stream(config.world_seed, "campaigns")
    tables.update(
        marketing.generate_campaigns(
            rng_campaigns, tables["games"], per_market=volumes.campaigns_per_market
        )
    )

    rng_exposures = stream(config.world_seed, "exposures")
    tables["campaign_exposures"] = marketing.generate_exposures(
        rng_exposures,
        tables["campaigns"],
        tables["campaign_game_map"],
        tables["players"],
        volumes.campaign_exposures,
    )
    _stage("campaign exposures", {"campaign_exposures": tables["campaign_exposures"]})

    rng_incidents = stream(config.world_seed, "incidents")
    incidents, incident_games = operations.generate_incidents(
        rng_incidents,
        tables["platforms"],
        tables["platform_versions"],
        tables["app_versions"],
        tables["games"],
        total=volumes.incidents,
    )
    tables["incidents"] = incidents
    tables["incident_game_map"] = incident_games

    rng_support = stream(config.world_seed, "support")
    tables["support_cases"] = operations.generate_support_cases(
        rng_support, tables["players"], tables["games"], incidents, volumes.support_cases
    )
    tables["experiments"] = operations.generate_experiments(
        stream(config.world_seed, "experiments"), total=volumes.experiments
    )

    rng_sessions = stream(config.world_seed, "sessions")
    devices_by_player: dict[str, list[str]] = {}
    for link in tables["player_device"]:
        devices_by_player.setdefault(link.player_id, []).append(link.device_id)
    app_versions_by_market: dict[str, list[AppVersionRow]] = {}
    for version in tables["app_versions"]:
        app_versions_by_market.setdefault(version.market_id, []).append(version)
    tables["sessions"] = activity.generate_sessions(
        rng_sessions,
        tables["players"],
        devices_by_player,
        app_versions_by_market,
        volumes.sessions,
    )
    _stage("sessions", {"sessions": tables["sessions"]})

    rng_documents = stream(config.world_seed, "documents")
    docs, chunks = documents.generate_documents(
        rng_documents,
        volumes.documents,
        tables["games"],
        tables["incidents"],
        tables["campaigns"],
        tables["app_versions"],
        tables["experiments"],
    )
    # Documents move to named rows with their generator; wrap until then.
    tables["documents"] = [DocumentRow(*doc) for doc in docs]
    tables["document_chunks"] = [DocumentChunkRow(*chunk) for chunk in chunks]

    market_currency = {row.market_id: row.currency_code for row in tables["markets"]}
    tables["kpi_daily"] = activity.generate_kpi_daily(
        tickets,
        tables["sessions"],
        tables["support_cases"],
        tables["campaign_exposures"],
        tables["campaigns"],
        market_currency,
    )

    missing = [name for name in _TABLE_ORDER if name not in tables]
    if missing:
        raise RuntimeError(f"generator did not produce tables: {missing}")
    return World(config, tables)
