"""Map source tables and the ontology to graph node rows keyed by label.

Every row carries provenance (``source_system``, ``source_table``,
``source_record_id``), a ``source_timestamp`` where the source table records
when the entity came into being, and a validity window (``valid_from`` /
``valid_to``) where the entity is time-bounded (docs/02-graph-schema-spec.md
section 4). None values are never stored.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from app.datasets.master_data import PRIZE_TYPES
from app.datasets.schema import TABLE_PROVENANCE
from app.graph import mapping
from app.ontology.model import Ontology

NodeRows = dict[str, list[dict[str, Any]]]

# Source columns that record when an entity came into being; a table has at
# most one of them, so the first present one is the node's source_timestamp.
SOURCE_TIMESTAMP_COLUMNS: tuple[str, ...] = (
    "created_at",
    "started_at",
    "opened_at",
    "released_at",
    "registration_date",
    "first_seen_at",
    "start_at",
)


# Source table -> (node label, id column): the one rule for which rows become
# nodes and what id they carry. Ingestion builds every table node through it,
# and the Data Model record view follows a row into the graph by it.
NODE_TABLES: dict[str, tuple[str, str]] = {
    "markets": ("Market", "market_id"),
    "regions": ("Region", "region_id"),
    "languages": ("Language", "language_code"),
    "currencies": ("Currency", "currency_code"),
    "channels": ("Channel", "channel_code"),
    "suppliers": ("Supplier", "supplier_id"),
    "platforms": ("Platform", "platform_id"),
    "platform_versions": ("PlatformVersion", "platform_version_id"),
    "app_versions": ("AppVersion", "app_version_id"),
    "game_families": ("GameFamily", "family_id"),
    "game_categories": ("GameCategory", "category_code"),
    "incident_types": ("IncidentType", "incident_type_id"),
    "support_categories": ("SupportCategory", "support_category_id"),
    "game_mechanics": ("GameMechanic", "mechanic_id"),
    "player_segments": ("PlayerSegment", "segment_id"),
    "payment_providers": ("PaymentProvider", "provider_id"),
    "games": ("Game", "game_id"),
    "draws": ("Draw", "draw_id"),
    "players": ("Player", "player_id"),
    "devices": ("Device", "device_id"),
    "payment_methods": ("PaymentMethod", "payment_method_id"),
    "campaigns": ("Campaign", "campaign_id"),
    "experiments": ("Experiment", "experiment_id"),
    "incidents": ("Incident", "incident_id"),
    "support_cases": ("SupportCase", "support_case_id"),
    "documents": ("Document", "document_id"),
    "document_chunks": ("DocumentChunk", "chunk_id"),
}


def _f(value: Any) -> Any:
    """Decimals are not a Neo4j property type; amounts become floats here.

    Numeric authority for these amounts remains in the Parquet source layer.
    """
    return float(value) if isinstance(value, Decimal) else value


def _clean(props: dict[str, Any]) -> dict[str, Any]:
    return {key: _f(value) for key, value in props.items() if value is not None}


def _source_timestamp(row: dict[str, Any]) -> Any:
    for column in SOURCE_TIMESTAMP_COLUMNS:
        if column in row:
            return row[column]
    return None


def node_identity(table: str) -> tuple[str, str] | None:
    """(node label, id column) of a source table that becomes graph nodes,
    or None for a table that does not (link tables, facts, events)."""
    return NODE_TABLES.get(table)


def _add(nodes: NodeRows, table: str, row: dict[str, Any], props: dict[str, Any]) -> None:
    """One node of ``table``'s label, its id and provenance from ``NODE_TABLES``."""
    label, id_column = NODE_TABLES[table]
    node_id = row[id_column]
    source_system, source_table = TABLE_PROVENANCE[table]
    nodes.setdefault(label, []).append(
        _clean(
            {
                "id": node_id,
                **props,
                "source_timestamp": _source_timestamp(row),
                "source_system": source_system,
                "source_table": source_table,
                "source_record_id": node_id,
            }
        )
    )


def _reference_nodes(nodes: NodeRows, tables: dict[str, list[dict[str, Any]]]) -> None:
    for row in tables["markets"]:
        _add(
            nodes,
            "markets",
            row,
            {
                "market_code": row["market_code"],
                "name": row["market_name"],
                "currency_code": row["currency_code"],
                "primary_language": row["primary_language"],
                "timezone": row["timezone"],
                "digital_maturity": row["digital_maturity"],
                "retail_intensity": row["retail_intensity"],
            },
        )
    for row in tables["regions"]:
        _add(
            nodes,
            "regions",
            row,
            {"name": row["name"], "market_id": row["market_id"]},
        )
    for row in tables["languages"]:
        _add(nodes, "languages", row, {"name": row["name"]})
    for row in tables["currencies"]:
        _add(nodes, "currencies", row, {"name": row["name"]})
    for row in tables["channels"]:
        _add(
            nodes,
            "channels",
            row,
            {"description": row["description"]},
        )
    for row in tables["suppliers"]:
        _add(nodes, "suppliers", row, {"name": row["name"]})
    for row in tables["platforms"]:
        _add(
            nodes,
            "platforms",
            row,
            {
                "name": row["platform_name"],
                "platform_type": row["platform_type"],
                "supplier_id": row["supplier_id"],
            },
        )
    for row in tables["platform_versions"]:
        _add(
            nodes,
            "platform_versions",
            row,
            {
                "platform_id": row["platform_id"],
                "version_label": row["version_label"],
                "released_at": row["released_at"],
                "retired_at": row["retired_at"],
                "valid_from": row["released_at"],
                "valid_to": row["retired_at"],
            },
        )
    for row in tables["app_versions"]:
        _add(
            nodes,
            "app_versions",
            row,
            {
                "market_id": row["market_id"],
                "version_label": row["version_label"],
                "released_at": row["released_at"],
                "min_os_bucket": row["min_os_bucket"],
                "valid_from": row["released_at"],
            },
        )


def _taxonomy_nodes(nodes: NodeRows, tables: dict[str, list[dict[str, Any]]]) -> None:
    """Market-local taxonomy codes: the source side of every MAPS_TO binding."""
    for table in ("game_families", "game_categories", "incident_types", "support_categories"):
        for row in tables[table]:
            _add(
                nodes,
                table,
                row,
                {
                    "market_id": row["market_id"],
                    "name": row["name"],
                    "language_code": row["language_code"],
                },
            )
    for row in tables["game_mechanics"]:
        _add(
            nodes,
            "game_mechanics",
            row,
            {
                "mechanic_code": row["mechanic_code"],
                "name": row["description"],
                "description": row["description"],
                "market_id": row["market_id"],
                "language_code": row["language_code"],
            },
        )
    for row in tables["player_segments"]:
        _add(
            nodes,
            "player_segments",
            row,
            {
                "market_id": row["market_id"],
                "segment_kind": row["segment_kind"],
                "name": row["name"],
                "language_code": row["language_code"],
            },
        )
    for row in tables["payment_providers"]:
        _add(
            nodes,
            "payment_providers",
            row,
            {
                "name": row["name"],
                "home_market_id": row["home_market_id"],
                "platform_id": row["platform_id"],
            },
        )


def _product_nodes(nodes: NodeRows, tables: dict[str, list[dict[str, Any]]]) -> None:
    for row in tables["games"]:
        _add(
            nodes,
            "games",
            row,
            {
                "name": row["game_name"],
                "market_id": row["market_id"],
                "family_id": row["game_family_id"],
                "category_code": row["game_category_code"],
                "launch_date": row["launch_date"],
                "retirement_date": row["retirement_date"],
                "valid_from": row["launch_date"],
                "valid_to": row["retirement_date"],
                "status": row["status"],
                "ticket_price": row["ticket_price"],
                "currency_code": row["currency_code"],
                "draw_frequency_code": row["draw_frequency_code"],
                "jackpot_type_code": row["jackpot_type_code"],
                "prize_model_code": row["prize_model_code"],
                "digital_enabled": row["digital_enabled"],
                "retail_enabled": row["retail_enabled"],
            },
        )
    for row in tables["draws"]:
        _add(
            nodes,
            "draws",
            row,
            {
                "game_id": row["game_id"],
                "draw_timestamp": row["draw_timestamp"],
                "jackpot_amount": row["jackpot_amount"],
                "currency_code": row["currency_code"],
                "rollover_count": row["rollover_count"],
            },
        )
    # Prize types have no world table; they stay master data.
    for prize_type_id, tier, multiplier, _weight in PRIZE_TYPES:
        nodes.setdefault("PrizeType", []).append(
            {
                "id": prize_type_id,
                "tier": tier,
                "multiplier": multiplier,
                "source_system": "warehouse",
                "source_table": "master_data",
                "source_record_id": prize_type_id,
            }
        )


def _player_nodes(nodes: NodeRows, tables: dict[str, list[dict[str, Any]]]) -> None:
    for row in tables["players"]:
        _add(
            nodes,
            "players",
            row,
            {
                "market_id": row["market_id"],
                "age_band": row["synthetic_age_band"],
                "region_id": row["synthetic_region_id"],
                "registration_date": row["registration_date"],
                "acquisition_channel": row["acquisition_channel"],
                "status": row["account_status"],
                "digital_affinity": row["digital_affinity"],
                "retail_affinity": row["retail_affinity"],
            },
        )
    for row in tables["devices"]:
        _add(
            nodes,
            "devices",
            row,
            {
                "device_fingerprint": row["device_fingerprint"],
                "device_family": row["device_family"],
                "os_version_bucket": row["os_version_bucket"],
                "app_capable": row["app_capable"],
                "first_seen_at": row["first_seen_at"],
            },
        )
    for row in tables["payment_methods"]:
        _add(
            nodes,
            "payment_methods",
            row,
            {
                "provider_id": row["provider_id"],
                "payment_type": row["payment_type"],
                "created_at": row["created_at"],
            },
        )


def _operational_nodes(nodes: NodeRows, tables: dict[str, list[dict[str, Any]]]) -> None:
    for row in tables["campaigns"]:
        _add(
            nodes,
            "campaigns",
            row,
            {
                "name": row["campaign_name"],
                "market_id": row["market_id"],
                "objective_code": row["objective_code"],
                "start_at": row["start_at"],
                "end_at": row["end_at"],
                "valid_from": row["start_at"],
                "valid_to": row["end_at"],
            },
        )
    for row in tables["experiments"]:
        _add(
            nodes,
            "experiments",
            row,
            {
                "name": row["experiment_name"],
                "market_id": row["market_id"],
                "hypothesis": row["hypothesis"],
                "start_at": row["start_at"],
                "end_at": row["end_at"],
                "valid_from": row["start_at"],
                "valid_to": row["end_at"],
                "primary_metric": row["primary_metric"],
                "result_summary": row["result_summary"],
            },
        )
    for row in tables["incidents"]:
        _add(
            nodes,
            "incidents",
            row,
            {
                "market_id": row["market_id"],
                "platform_id": row["platform_id"],
                "platform_version_id": row["platform_version_id"],
                "app_version_id": row["app_version_id"],
                "incident_type": row["incident_type"],
                "severity": row["severity"],
                "started_at": row["started_at"],
                "resolved_at": row["resolved_at"],
                # Resolution ends the outage, not the record's validity: no valid_to.
                "valid_from": row["started_at"],
                "summary": row["summary"],
                "root_cause_code": row["root_cause_code"],
            },
        )
    for row in tables["support_cases"]:
        _add(
            nodes,
            "support_cases",
            row,
            {
                "market_id": row["market_id"],
                "opened_at": row["opened_at"],
                "closed_at": row["closed_at"],
                "category_code": row["category_code"],
                "sentiment_score": row["sentiment_score"],
                "summary": row["summary_text"],
            },
        )


def _knowledge_nodes(nodes: NodeRows, tables: dict[str, list[dict[str, Any]]]) -> None:
    for row in tables["documents"]:
        _add(
            nodes,
            "documents",
            row,
            {
                "document_type": row["document_type"],
                "market_id": row["market_id"],
                "language_code": row["language_code"],
                "title": row["title"],
                "created_at": row["created_at"],
                "valid_from": row["valid_from"],
                "valid_to": row["valid_to"],
            },
        )
    for row in tables["document_chunks"]:
        _add(
            nodes,
            "document_chunks",
            row,
            {
                "document_id": row["document_id"],
                "chunk_index": row["chunk_index"],
                "text": row["text"],
                "token_count": row["token_count"],
            },
        )


def build_node_rows(tables: dict[str, list[dict[str, Any]]], ontology: Ontology) -> NodeRows:
    """Map source tables and the ontology to graph node rows keyed by node label."""
    nodes: NodeRows = {}
    for add_nodes in (
        _reference_nodes,
        _taxonomy_nodes,
        _product_nodes,
        _player_nodes,
        _operational_nodes,
        _knowledge_nodes,
    ):
        add_nodes(nodes, tables)
    nodes["BusinessConcept"] = mapping.concept_node_rows(ontology)
    return nodes
