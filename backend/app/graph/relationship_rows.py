"""Map source tables, derived aggregates and the ontology to relationship rows.

Rows accumulate linearly per ``(rel_type, label_a, label_b)`` key; derived
rows come from ``app.graph.mapping`` in their own sorted order.
"""

from __future__ import annotations

from typing import Any

from app.graph import mapping
from app.ontology.model import Ontology

RelationshipKey = tuple[str, str, str]  # (rel_type, label_a, label_b)
RelationshipRows = dict[RelationshipKey, list[dict[str, Any]]]

# Source node label for every ontology binding kind (MAPS_TO edges).
BINDING_LABELS: dict[str, str] = {
    "family": "GameFamily",
    "category": "GameCategory",
    "mechanic": "GameMechanic",
    "incident_type": "IncidentType",
    "support_category": "SupportCategory",
    "segment": "PlayerSegment",
    "channel": "Channel",
}


def _edge(a_id: Any, b_id: Any, props: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"a_id": a_id, "b_id": b_id, "props": props or {}}


def _game_edges(rels: RelationshipRows, tables: dict[str, list[dict[str, Any]]]) -> None:
    for row in tables["games"]:
        game_id = row["game_id"]
        rels.setdefault(("INSTANCE_OF", "Game", "GameCategory"), []).append(
            _edge(game_id, row["game_category_code"])
        )
        rels.setdefault(("BELONGS_TO", "Game", "GameFamily"), []).append(
            _edge(game_id, row["game_family_id"])
        )
        rels.setdefault(("AVAILABLE_IN", "Game", "Market"), []).append(
            _edge(game_id, row["market_id"])
        )
        for channel in mapping.game_available_via(row):
            rels.setdefault(("AVAILABLE_VIA", "Game", "Channel"), []).append(
                _edge(game_id, channel, {"method": mapping.METHOD_CATALOG_FLAGS})
            )
        for platform in mapping.game_runs_on(row):
            rels.setdefault(("RUNS_ON", "Game", "Platform"), []).append(
                _edge(game_id, platform, {"method": mapping.METHOD_OPERATIONAL_DEPENDENCY})
            )
    rels[("HAS_MECHANIC", "Game", "GameMechanic")] = [
        _edge(
            row["game_id"],
            row["mechanic_id"],
            {
                "importance_weight": row["importance_weight"],
                "valid_from": row["valid_from"],
                "valid_to": row["valid_to"],
            },
        )
        for row in tables["game_mechanic_map"]
    ]
    rels[("HAS_DRAW", "Game", "Draw")] = [
        _edge(row["game_id"], row["draw_id"]) for row in tables["draws"]
    ]


def _player_edges(rels: RelationshipRows, tables: dict[str, list[dict[str, Any]]]) -> None:
    segments = rels.setdefault(("BELONGS_TO", "Player", "PlayerSegment"), [])
    for row in tables["players"]:
        segments.append(_edge(row["player_id"], row["value_segment"], {"kind": "VALUE"}))
        segments.append(_edge(row["player_id"], row["engagement_segment"], {"kind": "ENGAGEMENT"}))
    rels[("USES", "Player", "Device")] = [
        _edge(
            row["player_id"],
            row["device_id"],
            {
                "usage_weight": row["usage_weight"],
                "first_seen_at": row["first_seen_at"],
                "last_seen_at": row["last_seen_at"],
            },
        )
        for row in tables["player_device"]
    ]
    rels[("USES_PAYMENT", "Player", "PaymentMethod")] = [
        _edge(
            row["player_id"],
            row["payment_method_id"],
            {"usage_weight": row["usage_weight"], "first_used_at": row["first_used_at"]},
        )
        for row in tables["player_payment_method"]
    ]
    rels[("PROVIDED_BY", "PaymentMethod", "PaymentProvider")] = [
        _edge(row["payment_method_id"], row["provider_id"]) for row in tables["payment_methods"]
    ]
    rels[("PLAYS", "Player", "Game")] = mapping.player_game_edges(tables["tickets"])
    rels[("EXPOSED_TO", "Player", "Campaign")] = mapping.player_campaign_edges(
        tables["campaign_exposures"]
    )


def _commercial_edges(rels: RelationshipRows, tables: dict[str, list[dict[str, Any]]]) -> None:
    rels[("PROMOTES", "Campaign", "Game")] = [
        _edge(row["campaign_id"], row["game_id"], {"promotion_weight": row["promotion_weight"]})
        for row in tables["campaign_game_map"]
    ]
    rels[("TARGETS", "Campaign", "PlayerSegment")] = mapping.campaign_target_segments(
        tables["campaign_exposures"], {row["player_id"]: row for row in tables["players"]}
    )
    rels[("TARGETS", "Experiment", "PlayerSegment")] = [
        _edge(row["experiment_id"], row["target_segment"]) for row in tables["experiments"]
    ]


def _operational_edges(rels: RelationshipRows, tables: dict[str, list[dict[str, Any]]]) -> None:
    rels[("VERSION_OF", "PlatformVersion", "Platform")] = [
        _edge(row["platform_version_id"], row["platform_id"]) for row in tables["platform_versions"]
    ]
    rels[("DEPLOYED_TO", "AppVersion", "Market")] = [
        _edge(row["app_version_id"], row["market_id"]) for row in tables["app_versions"]
    ]
    for row in tables["incidents"]:
        incident_id = row["incident_id"]
        rels.setdefault(("OF_TYPE", "Incident", "IncidentType"), []).append(
            _edge(incident_id, row["incident_type"])
        )
        rels.setdefault(("RELATED_TO", "Incident", "Platform"), []).append(
            _edge(incident_id, row["platform_id"])
        )
        if row["platform_version_id"]:
            rels.setdefault(("RELATED_TO_VERSION", "Incident", "PlatformVersion"), []).append(
                _edge(incident_id, row["platform_version_id"])
            )
        if row["app_version_id"]:
            rels.setdefault(("RELATED_TO_APP_VERSION", "Incident", "AppVersion"), []).append(
                _edge(incident_id, row["app_version_id"])
            )
        if row["market_id"]:
            rels.setdefault(("AFFECTS_MARKET", "Incident", "Market"), []).append(
                _edge(incident_id, row["market_id"])
            )
    rels[("AFFECTS", "Incident", "Game")] = [
        _edge(row["incident_id"], row["game_id"], {"impact_weight": row["impact_weight"]})
        for row in tables["incident_game_map"]
    ]
    for row in tables["support_cases"]:
        case_id = row["support_case_id"]
        rels.setdefault(("FROM_MARKET", "SupportCase", "Market"), []).append(
            _edge(case_id, row["market_id"])
        )
        rels.setdefault(("CATEGORISED_AS", "SupportCase", "SupportCategory"), []).append(
            _edge(case_id, row["category_code"])
        )
        if row["game_id"]:
            rels.setdefault(("CONCERNS", "SupportCase", "Game"), []).append(
                _edge(case_id, row["game_id"])
            )
        if row["incident_id"]:
            rels.setdefault(("RELATED_TO", "SupportCase", "Incident"), []).append(
                _edge(case_id, row["incident_id"])
            )


def _document_edges(rels: RelationshipRows, tables: dict[str, list[dict[str, Any]]]) -> None:
    rels[("HAS_CHUNK", "Document", "DocumentChunk")] = [
        _edge(row["document_id"], row["chunk_id"], {"chunk_index": row["chunk_index"]})
        for row in tables["document_chunks"]
    ]
    for row in tables["documents"]:
        if row["market_id"]:
            rels.setdefault(("FROM_MARKET", "Document", "Market"), []).append(
                _edge(row["document_id"], row["market_id"])
            )
        for reference in mapping.document_references(row["title"], row["body"]):
            rels.setdefault(("REFERENCES", "Document", reference["target_kind"]), []).append(
                _edge(row["document_id"], reference["target_id"], {"method": reference["method"]})
            )


def _ontology_edges(
    rels: RelationshipRows, tables: dict[str, list[dict[str, Any]]], ontology: Ontology
) -> None:
    rels[("SIMILAR_TO", "Game", "Game")] = mapping.similar_to_rows(
        tables["games"], tables["game_mechanic_map"], ontology
    )
    rels[("IS_A", "BusinessConcept", "BusinessConcept")] = mapping.is_a_rows(ontology)
    for kind, label in BINDING_LABELS.items():
        rels[("MAPS_TO", label, "BusinessConcept")] = mapping.maps_to_rows(ontology, kind, label)


def build_relationship_rows(
    tables: dict[str, list[dict[str, Any]]], ontology: Ontology
) -> RelationshipRows:
    """Map source tables, derived aggregates and the ontology to relationship rows."""
    rels: RelationshipRows = {}
    _game_edges(rels, tables)
    _player_edges(rels, tables)
    _commercial_edges(rels, tables)
    _operational_edges(rels, tables)
    _document_edges(rels, tables)
    _ontology_edges(rels, tables, ontology)
    return {key: rows for key, rows in rels.items() if rows}
