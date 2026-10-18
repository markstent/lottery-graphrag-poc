"""Pure derivation and mapping functions for graph ingestion.

No I/O here: every function maps source rows (dicts) to graph rows so the
mappings are unit-testable and the derivation methods stay explicit
(docs/02-graph-schema-spec.md section 7, docs/03-ontology-spec.md section 6).
Every concept, binding and similarity edge is derived from the ontology
(``app.ontology``); this module holds no concept maps of its own.
"""

from __future__ import annotations

import re
from collections import Counter
from datetime import UTC, datetime
from typing import Any

from app.ontology.model import LANGUAGES, Ontology
from app.ontology.similarity import GameConcepts, cross_market_similar

METHOD_CATALOG_FLAGS = "catalog_flags_v1"
METHOD_OPERATIONAL_DEPENDENCY = "operational_dependency_v1"
METHOD_TICKET_AGGREGATE = "ticket_aggregate_v1"
METHOD_EXPOSURE_AGGREGATE = "exposure_aggregate_v1"
METHOD_ENGAGEMENT_TARGETING = "exposure_engagement_v1"
METHOD_TITLE_REFERENCE = "title_reference_v1"

DIGITAL_PLATFORMS = (
    "PLT_APP_IOS",
    "PLT_APP_ANDROID",
    "PLT_WEB",
    "PLT_PAYMENTS",
    "PLT_IDENTITY",
    "PLT_DRAW",
)
RETAIL_PLATFORMS = ("PLT_RETAIL", "PLT_DRAW")

_DOCUMENT_REFERENCE_LIMIT = 5

_REFERENCE_PATTERN = re.compile(r"\b(GAME|INC|CMP|APPV|EXP)_[A-Z0-9_]+[A-Z0-9]")
_REFERENCE_LABELS: dict[str, str] = {
    "GAME": "Game",
    "INC": "Incident",
    "CMP": "Campaign",
    "APPV": "AppVersion",
    "EXP": "Experiment",
}


def game_available_via(game: dict[str, Any]) -> list[str]:
    """Channels for a game, derived from its catalogue flags."""
    channels: list[str] = []
    if game["digital_enabled"]:
        channels.extend(("APP", "WEB"))
    if game["retail_enabled"]:
        channels.append("RETAIL")
    return channels


def game_runs_on(game: dict[str, Any]) -> list[str]:
    """Platforms a game operationally depends on, from its channel mix."""
    platforms: list[str] = []
    if game["digital_enabled"]:
        platforms.extend(DIGITAL_PLATFORMS)
    if game["retail_enabled"]:
        platforms.extend(RETAIL_PLATFORMS)
    return sorted(set(platforms))


def campaign_target_segments(
    exposures: list[dict[str, Any]], players: dict[str, dict[str, Any]]
) -> list[dict[str, Any]]:
    """Most-engaged behavioural segment per campaign, with its share.

    Derived from engaged exposures only; ties break on segment id.
    """
    engaged_by_campaign: dict[str, Counter[str]] = {}
    for exposure in exposures:
        if not exposure["engaged"]:
            continue
        player = players.get(exposure["player_id"])
        if player is None:
            continue
        engaged_by_campaign.setdefault(exposure["campaign_id"], Counter())[
            player["engagement_segment"]
        ] += 1
    edges: list[dict[str, Any]] = []
    for campaign_id in sorted(engaged_by_campaign):
        counts = engaged_by_campaign[campaign_id]
        segment, count = sorted(counts.items(), key=lambda item: (-item[1], item[0]))[0]
        edges.append(
            {
                "a_id": campaign_id,
                "b_id": segment,
                "props": {
                    "share": round(count / sum(counts.values()), 3),
                    "method": METHOD_ENGAGEMENT_TARGETING,
                },
            }
        )
    return edges


def player_game_edges(tickets: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Aggregate player-game play counts from identified tickets."""
    aggregated: dict[tuple[str, str], dict[str, Any]] = {}
    for ticket in tickets:
        player_id = ticket["player_id"]
        if player_id is None or ticket["ticket_status"] == "VOID":
            continue
        key = (player_id, ticket["game_id"])
        entry = aggregated.setdefault(
            key, {"ticket_count": 0, "last_purchase_at": ticket["purchase_timestamp"]}
        )
        entry["ticket_count"] += 1
        entry["last_purchase_at"] = max(entry["last_purchase_at"], ticket["purchase_timestamp"])
    return [
        {
            "a_id": player_id,
            "b_id": game_id,
            "props": {
                "ticket_count": entry["ticket_count"],
                "last_purchase_at": entry["last_purchase_at"],
                "method": METHOD_TICKET_AGGREGATE,
            },
        }
        for (player_id, game_id), entry in sorted(aggregated.items())
    ]


def player_campaign_edges(exposures: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Aggregate player-campaign exposure counts."""
    aggregated: dict[tuple[str, str], dict[str, Any]] = {}
    for exposure in exposures:
        key = (exposure["player_id"], exposure["campaign_id"])
        entry = aggregated.setdefault(
            key,
            {"exposure_count": 0, "engaged_count": 0, "last_exposed_at": exposure["exposed_at"]},
        )
        entry["exposure_count"] += 1
        entry["engaged_count"] += int(bool(exposure["engaged"]))
        entry["last_exposed_at"] = max(entry["last_exposed_at"], exposure["exposed_at"])
    return [
        {
            "a_id": player_id,
            "b_id": campaign_id,
            "props": {
                "exposure_count": entry["exposure_count"],
                "engaged_count": entry["engaged_count"],
                "last_exposed_at": entry["last_exposed_at"],
                "method": METHOD_EXPOSURE_AGGREGATE,
            },
        }
        for (player_id, campaign_id), entry in sorted(aggregated.items())
    ]


def document_references(title: str, body: str) -> list[dict[str, Any]]:
    """Stable entity references parsed from a document title and body."""
    text = f"{title}\n{body}"
    ordered: list[str] = []
    for match in _REFERENCE_PATTERN.finditer(text):
        reference = match.group(0)
        if reference not in ordered:
            ordered.append(reference)
    return [
        {
            "target_kind": _REFERENCE_LABELS[reference.split("_", 1)[0]],
            "target_id": reference,
            "method": METHOD_TITLE_REFERENCE,
        }
        for reference in ordered[:_DOCUMENT_REFERENCE_LIMIT]
    ]


def mechanics_by_game(mechanic_map: list[dict[str, Any]]) -> dict[str, set[str]]:
    """Group mechanic ids per game."""
    grouped: dict[str, set[str]] = {}
    for row in mechanic_map:
        grouped.setdefault(row["game_id"], set()).add(row["mechanic_id"])
    return grouped


def ingestion_version_now() -> str:
    """Timestamped ingestion version for one ingestion run."""
    return datetime.now(UTC).strftime("ing-%Y%m%dT%H%M%SZ")


# ------------------------------------------------------------ ontology rows
ONTOLOGY_SOURCE_SYSTEM = "ontology"
ONTOLOGY_SOURCE_TABLE = "ontology.yaml"


def _bound_concept(ontology: Ontology, kind: str, code: str) -> str:
    concept_id = ontology.concept_for(kind, code)
    if concept_id is None:
        raise KeyError(f"no ontology binding for {kind} {code}")
    return concept_id


def game_concepts(game: dict[str, Any], mechanics: set[str], ontology: Ontology) -> GameConcepts:
    """A game expressed in ontology concepts via its family, category and mechanic bindings."""
    return GameConcepts(
        game_id=game["game_id"],
        market_id=game["market_id"],
        family_concept=_bound_concept(ontology, "family", game["game_family_id"]),
        category_concept=_bound_concept(ontology, "category", game["game_category_code"]),
        mechanic_concepts=frozenset(
            _bound_concept(ontology, "mechanic", mechanic) for mechanic in mechanics
        ),
    )


def concept_node_rows(ontology: Ontology) -> list[dict[str, Any]]:
    """One BusinessConcept node row per concept, in ontology source order.

    Root concepts carry no ``parent_id`` key (None values are never stored).
    """
    rows: list[dict[str, Any]] = []
    for concept in ontology.concepts:
        row: dict[str, Any] = {
            "id": concept.concept_id,
            "canonical_name": concept.labels["en"],
            "concept_type": concept.concept_type,
            "definition": concept.definition,
            **{f"label_{lang}": concept.labels[lang] for lang in LANGUAGES},
            "synonyms": sorted(
                f"{lang}:{text}" for lang, texts in concept.synonyms.items() for text in texts
            ),
            "ontology_version": ontology.version,
            "source_system": ONTOLOGY_SOURCE_SYSTEM,
            "source_table": ONTOLOGY_SOURCE_TABLE,
            "source_record_id": concept.concept_id,
        }
        if concept.parent_id is not None:
            row["parent_id"] = concept.parent_id
        rows.append(row)
    return rows


def is_a_rows(ontology: Ontology) -> list[dict[str, Any]]:
    """IS_A edges from every non-root concept to its parent."""
    return [
        {
            "a_id": concept.concept_id,
            "b_id": concept.parent_id,
            "props": {"ontology_version": ontology.version},
        }
        for concept in ontology.concepts
        if concept.parent_id is not None
    ]


def maps_to_rows(ontology: Ontology, kind: str, label: str) -> list[dict[str, Any]]:
    """MAPS_TO edges from every bound local code of one kind to its concept.

    ``label`` is the source node label the caller pairs with these rows in its
    relationship key; the rows themselves only carry endpoint ids.
    """
    return [
        {
            "a_id": binding.code,
            "b_id": binding.concept_id,
            "props": {"ontology_version": ontology.version},
        }
        for binding in ontology.bindings
        if binding.kind == kind
    ]


def similar_to_rows(
    games: list[dict[str, Any]], mechanic_map: list[dict[str, Any]], ontology: Ontology
) -> list[dict[str, Any]]:
    """Cross-market SIMILAR_TO edges scored on ontology concepts."""
    mechanics = mechanics_by_game(mechanic_map)
    concepts = [
        game_concepts(game, mechanics.get(game["game_id"], set()), ontology) for game in games
    ]
    return [
        {
            "a_id": edge.a_id,
            "b_id": edge.b_id,
            "props": {
                "score": edge.score,
                "method": edge.method,
                "ontology_version": ontology.version,
            },
        }
        for edge in cross_market_similar(concepts)
    ]
