"""Idempotent ingestion from a generated dataset into the Neo4j overlay.

Pipeline (docs/data/graph-ingestion.md): read source tables, map to graph
rows with provenance, apply schema, merge nodes, merge typed relationships.
High-volume transactional facts (tickets, prizes, sessions, raw exposures)
stay in the structured layer; the graph holds aggregated relationship
properties that reference them (docs/02 section 8).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from pathlib import Path
from typing import Any

from neo4j import Driver, GraphDatabase
from neo4j import Session as Neo4jSession

from app.datasets.master_data import PLAYER_SEGMENTS, PRIZE_TYPES
from app.datasets.schema import TABLE_PROVENANCE
from app.graph import mapping, statements
from app.graph.config import LABEL_VERSION, GraphConfig
from app.graph.reader import load_dataset

BATCH_SIZE = 2_000
WIPE_STATEMENT = "MATCH (n) DETACH DELETE n"

RelationshipKey = tuple[str, str, str]  # (rel_type, label_a, label_b)


@dataclass(slots=True)
class IngestStats:
    """Row counts pushed to the graph for one ingestion run."""

    ingestion_version: str
    nodes: dict[str, int] = field(default_factory=dict)
    relationships: list[tuple[str, str, str, int]] = field(default_factory=list)

    def relationship_totals(self) -> dict[str, int]:
        totals: dict[str, int] = {}
        for rel_type, _label_a, _label_b, count in self.relationships:
            totals[rel_type] = totals.get(rel_type, 0) + count
        return totals


def _provenance(table: str, record_id: Any) -> dict[str, Any]:
    source_system, source_table = TABLE_PROVENANCE[table]
    return {
        "source_system": source_system,
        "source_table": source_table,
        "source_record_id": record_id,
    }


def _master_provenance(record_id: Any) -> dict[str, Any]:
    return {
        "source_system": "warehouse",
        "source_table": "master_data",
        "source_record_id": record_id,
    }


def _f(value: Any) -> Any:
    """Decimals are not a Neo4j property type; amounts become floats here.

    Numeric authority for these amounts remains in the Parquet source layer.
    """
    return float(value) if isinstance(value, Decimal) else value


def _clean(props: dict[str, Any]) -> dict[str, Any]:
    return {key: _f(value) for key, value in props.items() if value is not None}


def build_node_rows(tables: dict[str, list[dict[str, Any]]]) -> dict[str, list[dict[str, Any]]]:
    """Map source tables to graph node rows keyed by node label."""
    nodes: dict[str, list[dict[str, Any]]] = {}

    def add(label: str, table: str, record_id: Any, props: dict[str, Any]) -> None:
        nodes.setdefault(label, []).append(_clean({**props, **_provenance(table, record_id)}))

    def add_master(label: str, record_id: Any, props: dict[str, Any]) -> None:
        nodes.setdefault(label, []).append(_clean({**props, **_master_provenance(record_id)}))

    for row in tables["markets"]:
        add(
            "Market",
            "markets",
            row["market_id"],
            {
                "id": row["market_id"],
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
        add(
            "Region",
            "regions",
            row["region_id"],
            {
                "id": row["region_id"],
                "name": row["name"],
                "market_id": row["market_id"],
            },
        )
    for row in tables["languages"]:
        add(
            "Language",
            "languages",
            row["language_code"],
            {"id": row["language_code"], "name": row["name"]},
        )
    for row in tables["currencies"]:
        add(
            "Currency",
            "currencies",
            row["currency_code"],
            {"id": row["currency_code"], "name": row["name"]},
        )
    for row in tables["channels"]:
        add(
            "Channel",
            "channels",
            row["channel_code"],
            {"id": row["channel_code"], "description": row["description"]},
        )
    for row in tables["suppliers"]:
        add(
            "Supplier",
            "suppliers",
            row["supplier_id"],
            {"id": row["supplier_id"], "name": row["name"]},
        )
    for row in tables["platforms"]:
        add(
            "Platform",
            "platforms",
            row["platform_id"],
            {
                "id": row["platform_id"],
                "name": row["platform_name"],
                "platform_type": row["platform_type"],
                "supplier_id": row["supplier_id"],
            },
        )
    for row in tables["platform_versions"]:
        add(
            "PlatformVersion",
            "platform_versions",
            row["platform_version_id"],
            {
                "id": row["platform_version_id"],
                "platform_id": row["platform_id"],
                "version_label": row["version_label"],
                "released_at": row["released_at"],
            },
        )
    for row in tables["app_versions"]:
        add(
            "AppVersion",
            "app_versions",
            row["app_version_id"],
            {
                "id": row["app_version_id"],
                "market_id": row["market_id"],
                "version_label": row["version_label"],
                "released_at": row["released_at"],
                "min_os_bucket": row["min_os_bucket"],
            },
        )
    for row in tables["game_families"]:
        add(
            "GameFamily",
            "game_families",
            row["family_id"],
            {"id": row["family_id"], "name": row["name"]},
        )
    for row in tables["game_categories"]:
        add(
            "GameCategory",
            "game_categories",
            row["category_code"],
            {"id": row["category_code"], "name": row["name"]},
        )
    for row in tables["game_mechanics"]:
        add(
            "GameMechanic",
            "game_mechanics",
            row["mechanic_id"],
            {
                "id": row["mechanic_id"],
                "mechanic_code": row["mechanic_code"],
                "description": row["description"],
            },
        )
    for row in tables["games"]:
        add(
            "Game",
            "games",
            row["game_id"],
            {
                "id": row["game_id"],
                "name": row["game_name"],
                "market_id": row["market_id"],
                "family_id": row["game_family_id"],
                "category_code": row["game_category_code"],
                "launch_date": row["launch_date"],
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
        add(
            "Draw",
            "draws",
            row["draw_id"],
            {
                "id": row["draw_id"],
                "game_id": row["game_id"],
                "draw_timestamp": row["draw_timestamp"],
                "jackpot_amount": row["jackpot_amount"],
                "currency_code": row["currency_code"],
                "rollover_count": row["rollover_count"],
            },
        )
    for prize_type_id, tier, multiplier, _weight in PRIZE_TYPES:
        add_master(
            "PrizeType",
            prize_type_id,
            {"id": prize_type_id, "tier": tier, "multiplier": multiplier},
        )
    for segment_id, kind, code, description in PLAYER_SEGMENTS:
        add_master(
            "PlayerSegment",
            segment_id,
            {
                "id": segment_id,
                "segment_kind": kind,
                "code": code,
                "description": description,
            },
        )
    for row in tables["players"]:
        add(
            "Player",
            "players",
            row["player_id"],
            {
                "id": row["player_id"],
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
        add(
            "Device",
            "devices",
            row["device_id"],
            {
                "id": row["device_id"],
                "device_fingerprint": row["device_fingerprint"],
                "device_family": row["device_family"],
                "os_version_bucket": row["os_version_bucket"],
                "app_capable": row["app_capable"],
                "first_seen_at": row["first_seen_at"],
            },
        )
    for row in tables["payment_methods"]:
        add(
            "PaymentMethod",
            "payment_methods",
            row["payment_method_id"],
            {
                "id": row["payment_method_id"],
                "provider_id": row["provider_id"],
                "payment_type": row["payment_type"],
                "created_at": row["created_at"],
            },
        )
    # Shared-pool payment methods exist only as identifiers in the link table.
    known = {row["payment_method_id"] for row in tables["payment_methods"]}
    for row in tables["player_payment_method"]:
        method_id = row["payment_method_id"]
        if method_id not in known:
            known.add(method_id)
            add(
                "PaymentMethod",
                "player_payment_method",
                method_id,
                {
                    "id": method_id,
                    "payment_type": "SHARED_POOL",
                },
            )
    for row in tables["campaigns"]:
        add(
            "Campaign",
            "campaigns",
            row["campaign_id"],
            {
                "id": row["campaign_id"],
                "name": row["campaign_name"],
                "market_id": row["market_id"],
                "objective_code": row["objective_code"],
                "start_at": row["start_at"],
                "end_at": row["end_at"],
            },
        )
    for row in tables["experiments"]:
        add(
            "Experiment",
            "experiments",
            row["experiment_id"],
            {
                "id": row["experiment_id"],
                "name": row["experiment_name"],
                "market_id": row["market_id"],
                "hypothesis": row["hypothesis"],
                "start_at": row["start_at"],
                "end_at": row["end_at"],
                "primary_metric": row["primary_metric"],
                "result_summary": row["result_summary"],
            },
        )
    for row in tables["incidents"]:
        add(
            "Incident",
            "incidents",
            row["incident_id"],
            {
                "id": row["incident_id"],
                "market_id": row["market_id"],
                "platform_id": row["platform_id"],
                "platform_version_id": row["platform_version_id"],
                "app_version_id": row["app_version_id"],
                "incident_type": row["incident_type"],
                "severity": row["severity"],
                "started_at": row["started_at"],
                "resolved_at": row["resolved_at"],
                "summary": row["summary"],
                "root_cause_code": row["root_cause_code"],
            },
        )
    for row in tables["support_cases"]:
        add(
            "SupportCase",
            "support_cases",
            row["support_case_id"],
            {
                "id": row["support_case_id"],
                "market_id": row["market_id"],
                "opened_at": row["opened_at"],
                "closed_at": row["closed_at"],
                "category_code": row["category_code"],
                "sentiment_score": row["sentiment_score"],
                "summary": row["summary_text"],
            },
        )
    for row in tables["documents"]:
        add(
            "Document",
            "documents",
            row["document_id"],
            {
                "id": row["document_id"],
                "document_type": row["document_type"],
                "market_id": row["market_id"],
                "language_code": row["language_code"],
                "title": row["title"],
                "created_at": row["created_at"],
            },
        )
    for row in tables["document_chunks"]:
        add(
            "DocumentChunk",
            "document_chunks",
            row["chunk_id"],
            {
                "id": row["chunk_id"],
                "document_id": row["document_id"],
                "chunk_index": row["chunk_index"],
                "text": row["text"],
                "token_count": row["token_count"],
            },
        )
    for row in tables["business_concepts"]:
        concept_id = row["concept_id"]
        add(
            "BusinessConcept",
            "business_concepts",
            concept_id,
            {
                "id": concept_id,
                "canonical_name": mapping.CONCEPT_CANONICAL_NAMES[concept_id],
                "concept_type": row["concept_type"],
                "description": row["description"],
                "ontology_version": LABEL_VERSION,
            },
        )

    return nodes


def build_relationship_rows(
    tables: dict[str, list[dict[str, Any]]],
) -> dict[RelationshipKey, list[dict[str, Any]]]:
    """Map source tables and derived aggregates to relationship rows."""
    rels: dict[RelationshipKey, list[dict[str, Any]]] = {}

    def put(key: RelationshipKey, rows: list[dict[str, Any]]) -> None:
        rels[key] = rows

    games = tables["games"]
    for row in games:
        put(
            ("INSTANCE_OF", "Game", "GameCategory"),
            [
                *(rels.get(("INSTANCE_OF", "Game", "GameCategory"), [])),
                {"a_id": row["game_id"], "b_id": row["game_category_code"], "props": {}},
            ],
        )
        put(
            ("BELONGS_TO", "Game", "GameFamily"),
            [
                *(rels.get(("BELONGS_TO", "Game", "GameFamily"), [])),
                {"a_id": row["game_id"], "b_id": row["game_family_id"], "props": {}},
            ],
        )
        concept = mapping.FAMILY_TO_CONCEPT[row["game_family_id"]]
        put(
            ("INSTANCE_OF", "Game", "BusinessConcept"),
            [
                *(rels.get(("INSTANCE_OF", "Game", "BusinessConcept"), [])),
                {"a_id": row["game_id"], "b_id": concept, "props": {}},
            ],
        )
        put(
            ("AVAILABLE_IN", "Game", "Market"),
            [
                *(rels.get(("AVAILABLE_IN", "Game", "Market"), [])),
                {"a_id": row["game_id"], "b_id": row["market_id"], "props": {}},
            ],
        )
        put(
            ("AVAILABLE_VIA", "Game", "Channel"),
            [
                *(rels.get(("AVAILABLE_VIA", "Game", "Channel"), [])),
                *[
                    {
                        "a_id": row["game_id"],
                        "b_id": channel,
                        "props": {"method": mapping.METHOD_CATALOG_FLAGS},
                    }
                    for channel in mapping.game_available_via(row)
                ],
            ],
        )
        put(
            ("RUNS_ON", "Game", "Platform"),
            [
                *(rels.get(("RUNS_ON", "Game", "Platform"), [])),
                *[
                    {
                        "a_id": row["game_id"],
                        "b_id": platform,
                        "props": {"method": mapping.METHOD_OPERATIONAL_DEPENDENCY},
                    }
                    for platform in mapping.game_runs_on(row)
                ],
            ],
        )

    mechanic_map = tables["game_mechanic_map"]
    put(
        ("HAS_MECHANIC", "Game", "GameMechanic"),
        [
            {
                "a_id": row["game_id"],
                "b_id": row["mechanic_id"],
                "props": {
                    "importance_weight": row["importance_weight"],
                    "valid_from": row["valid_from"],
                },
            }
            for row in mechanic_map
        ],
    )
    put(
        ("MAPS_TO", "GameMechanic", "BusinessConcept"),
        [
            {"a_id": mechanic_id, "b_id": mapping.MECHANIC_TO_CONCEPT[mechanic_id], "props": {}}
            for mechanic_id in sorted(mapping.MECHANIC_TO_CONCEPT)
        ],
    )
    put(
        ("SIMILAR_TO", "Game", "Game"),
        mapping.cross_market_similar_games(games, mapping.mechanics_by_game(mechanic_map)),
    )
    put(
        ("HAS_DRAW", "Game", "Draw"),
        [{"a_id": row["game_id"], "b_id": row["draw_id"], "props": {}} for row in tables["draws"]],
    )

    for row in tables["players"]:
        put(
            ("BELONGS_TO", "Player", "PlayerSegment"),
            [
                *(rels.get(("BELONGS_TO", "Player", "PlayerSegment"), [])),
                {
                    "a_id": row["player_id"],
                    "b_id": row["value_segment"],
                    "props": {"kind": "VALUE"},
                },
                {
                    "a_id": row["player_id"],
                    "b_id": row["engagement_segment"],
                    "props": {"kind": "ENGAGEMENT"},
                },
            ],
        )
    put(
        ("USES", "Player", "Device"),
        [
            {
                "a_id": row["player_id"],
                "b_id": row["device_id"],
                "props": {
                    "usage_weight": row["usage_weight"],
                    "first_seen_at": row["first_seen_at"],
                    "last_seen_at": row["last_seen_at"],
                },
            }
            for row in tables["player_device"]
        ],
    )
    put(
        ("USES_PAYMENT", "Player", "PaymentMethod"),
        [
            {
                "a_id": row["player_id"],
                "b_id": row["payment_method_id"],
                "props": {
                    "usage_weight": row["usage_weight"],
                    "first_used_at": row["first_used_at"],
                },
            }
            for row in tables["player_payment_method"]
        ],
    )
    put(("PLAYS", "Player", "Game"), mapping.player_game_edges(tables["tickets"]))
    put(
        ("EXPOSED_TO", "Player", "Campaign"),
        mapping.player_campaign_edges(tables["campaign_exposures"]),
    )

    put(
        ("PROMOTES", "Campaign", "Game"),
        [
            {
                "a_id": row["campaign_id"],
                "b_id": row["game_id"],
                "props": {"promotion_weight": row["promotion_weight"]},
            }
            for row in tables["campaign_game_map"]
        ],
    )
    put(
        ("TARGETS", "Campaign", "PlayerSegment"),
        mapping.campaign_target_segments(
            tables["campaign_exposures"],
            {row["player_id"]: row for row in tables["players"]},
        ),
    )
    put(
        ("TARGETS", "Experiment", "PlayerSegment"),
        [
            {"a_id": row["experiment_id"], "b_id": row["target_segment"], "props": {}}
            for row in tables["experiments"]
        ],
    )

    put(
        ("VERSION_OF", "PlatformVersion", "Platform"),
        [
            {"a_id": row["platform_version_id"], "b_id": row["platform_id"], "props": {}}
            for row in tables["platform_versions"]
        ],
    )
    put(
        ("DEPLOYED_TO", "AppVersion", "Market"),
        [
            {"a_id": row["app_version_id"], "b_id": row["market_id"], "props": {}}
            for row in tables["app_versions"]
        ],
    )

    for row in tables["incidents"]:
        if row["platform_version_id"]:
            put(
                ("RELATED_TO_VERSION", "Incident", "PlatformVersion"),
                [
                    *(rels.get(("RELATED_TO_VERSION", "Incident", "PlatformVersion"), [])),
                    {"a_id": row["incident_id"], "b_id": row["platform_version_id"], "props": {}},
                ],
            )
        if row["app_version_id"]:
            put(
                ("RELATED_TO_APP_VERSION", "Incident", "AppVersion"),
                [
                    *(rels.get(("RELATED_TO_APP_VERSION", "Incident", "AppVersion"), [])),
                    {"a_id": row["incident_id"], "b_id": row["app_version_id"], "props": {}},
                ],
            )
        put(
            ("RELATED_TO", "Incident", "Platform"),
            [
                *(rels.get(("RELATED_TO", "Incident", "Platform"), [])),
                {"a_id": row["incident_id"], "b_id": row["platform_id"], "props": {}},
            ],
        )
        if row["market_id"]:
            put(
                ("AFFECTS_MARKET", "Incident", "Market"),
                [
                    *(rels.get(("AFFECTS_MARKET", "Incident", "Market"), [])),
                    {"a_id": row["incident_id"], "b_id": row["market_id"], "props": {}},
                ],
            )
        put(
            ("MAPS_TO", "Incident", "BusinessConcept"),
            [
                *(rels.get(("MAPS_TO", "Incident", "BusinessConcept"), [])),
                {
                    "a_id": row["incident_id"],
                    "b_id": mapping.INCIDENT_TYPE_TO_CONCEPT[row["incident_type"]],
                    "props": {},
                },
            ],
        )
    put(
        ("AFFECTS", "Incident", "Game"),
        [
            {
                "a_id": row["incident_id"],
                "b_id": row["game_id"],
                "props": {"impact_weight": row["impact_weight"]},
            }
            for row in tables["incident_game_map"]
        ],
    )

    for row in tables["support_cases"]:
        put(
            ("FROM_MARKET", "SupportCase", "Market"),
            [
                *(rels.get(("FROM_MARKET", "SupportCase", "Market"), [])),
                {"a_id": row["support_case_id"], "b_id": row["market_id"], "props": {}},
            ],
        )
        if row["game_id"]:
            put(
                ("CONCERNS", "SupportCase", "Game"),
                [
                    *(rels.get(("CONCERNS", "SupportCase", "Game"), [])),
                    {"a_id": row["support_case_id"], "b_id": row["game_id"], "props": {}},
                ],
            )
        if row["incident_id"]:
            put(
                ("RELATED_TO", "SupportCase", "Incident"),
                [
                    *(rels.get(("RELATED_TO", "SupportCase", "Incident"), [])),
                    {"a_id": row["support_case_id"], "b_id": row["incident_id"], "props": {}},
                ],
            )

    put(
        ("HAS_CHUNK", "Document", "DocumentChunk"),
        [
            {
                "a_id": row["document_id"],
                "b_id": row["chunk_id"],
                "props": {"chunk_index": row["chunk_index"]},
            }
            for row in tables["document_chunks"]
        ],
    )
    if any(row["market_id"] for row in tables["documents"]):
        put(
            ("FROM_MARKET", "Document", "Market"),
            [
                {"a_id": row["document_id"], "b_id": row["market_id"], "props": {}}
                for row in tables["documents"]
                if row["market_id"]
            ],
        )
    reference_targets = mapping.DOCUMENT_REFERENCE_LABELS
    doc_reference_rows: dict[str, list[dict[str, Any]]] = {label: [] for label in reference_targets}
    for row in tables["documents"]:
        for reference in mapping.document_references(row["title"], row["body"]):
            doc_reference_rows[reference["target_kind"]].append(
                {
                    "a_id": row["document_id"],
                    "b_id": reference["target_id"],
                    "props": {"method": reference["method"]},
                }
            )
    for label, rows in doc_reference_rows.items():
        if rows:
            put(("REFERENCES", "Document", label), rows)

    put(
        ("MAPS_TO", "PlayerSegment", "BusinessConcept"),
        [
            {"a_id": segment_id, "b_id": mapping.SEGMENT_TO_CONCEPT, "props": {}}
            for segment_id in sorted({row[0] for row in PLAYER_SEGMENTS})
        ],
    )
    put(
        ("MAPS_TO", "Channel", "BusinessConcept"),
        [
            {"a_id": channel, "b_id": concept, "props": {}}
            for channel, concept in sorted(mapping.CHANNEL_TO_CONCEPT.items())
        ],
    )

    return {key: rows for key, rows in rels.items() if rows}


def _run_batched(
    session: Neo4jSession, query: str, rows: list[dict[str, Any]], **params: Any
) -> int:
    pushed = 0
    for start in range(0, len(rows), BATCH_SIZE):
        session.run(query, rows=rows[start : start + BATCH_SIZE], **params).consume()
        pushed += len(rows[start : start + BATCH_SIZE])
    return pushed


def _verify_counts(
    session: Neo4jSession,
    nodes: dict[str, list[dict[str, Any]]],
    rels: dict[RelationshipKey, list[dict[str, Any]]],
) -> None:
    """Verify the database actually holds every row we intended to merge.

    A parameter-key mismatch would otherwise MERGE nothing and pass silently;
    this check turns that into a hard failure.
    """
    for label, rows in nodes.items():
        record = session.run(f"MATCH (n:{label}) RETURN count(n) AS c").single()
        if record is None:
            raise RuntimeError(f"ingestion verification query returned no record for {label}")
        if record["c"] != len(rows):
            raise RuntimeError(
                f"ingestion verification failed for nodes {label}: {record['c']} != {len(rows)}"
            )
    for (rel_type, label_a, label_b), rows in sorted(rels.items()):
        record = session.run(
            f"MATCH (:{label_a})-[r:{rel_type}]->(:{label_b}) RETURN count(r) AS c"
        ).single()
        if record is None:
            raise RuntimeError(f"ingestion verification query returned no record for {rel_type}")
        if record["c"] != len(rows):
            raise RuntimeError(
                f"ingestion verification failed for ({label_a})-[:{rel_type}]->({label_b}): "
                f"{record['c']} != {len(rows)}"
            )


def ingest(
    dataset_dir: Path,
    config: GraphConfig,
    ingestion_version: str | None = None,
    wipe: bool = False,
) -> IngestStats:
    """Ingest one dataset into Neo4j. Safe to re-run for the same dataset."""
    tables = load_dataset(dataset_dir)
    nodes = build_node_rows(tables)
    rels = build_relationship_rows(tables)
    version = ingestion_version or mapping.ingestion_version_now()
    stats = IngestStats(ingestion_version=version)

    driver: Driver = GraphDatabase.driver(config.uri, auth=(config.user, config.password))
    try:
        driver.verify_connectivity()
        with driver.session(database=config.database) as session:
            if wipe:
                session.run(WIPE_STATEMENT).consume()
            for statement in statements.schema_statements():
                session.run(statement).consume()
            for label in statements.NODE_LABELS:
                if label in nodes:
                    stats.nodes[label] = _run_batched(
                        session,
                        statements.node_statement(label),
                        nodes[label],
                        label_version=LABEL_VERSION,
                        ingestion_version=version,
                    )
            for (rel_type, label_a, label_b), rows in sorted(rels.items()):
                pushed = _run_batched(
                    session, statements.relationship_statement(rel_type, label_a, label_b), rows
                )
                stats.relationships.append((rel_type, label_a, label_b, pushed))
            _verify_counts(session, nodes, rels)
    finally:
        driver.close()
    return stats
