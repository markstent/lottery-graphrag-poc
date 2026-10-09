"""Pure derivation and mapping functions for graph ingestion.

No I/O here: every function maps source rows (dicts) to graph rows so the
mappings are unit-testable and the derivation methods stay explicit
(docs/02-graph-schema-spec.md section 7, docs/03-ontology-spec.md section 6).
"""

from __future__ import annotations

import re
from collections import Counter
from datetime import UTC, datetime
from typing import Any

# ------------------------------------------------------------ ontology maps
# Canonical concepts are the BusinessConcept master rows generated with the
# dataset (docs/03-ontology-spec.md layer B/C subset, version 1).
ONTOLOGY_VERSION = "1.0.0"

FAMILY_TO_CONCEPT: dict[str, str] = {
    "FAM_NATIONAL_DRAW": "CONCEPT_NATIONAL_DRAW",
    "FAM_ANNUITY": "CONCEPT_NATIONAL_DRAW",
    "FAM_FIXED_PRIZE": "CONCEPT_NATIONAL_DRAW",
    "FAM_MULTINATIONAL_JACKPOT": "CONCEPT_MULTINATIONAL_JACKPOT",
    "FAM_HIGH_FREQUENCY": "CONCEPT_HIGH_FREQUENCY_GAME",
    "FAM_INSTANT_WIN": "CONCEPT_INSTANT_PRODUCT",
    "FAM_DIGITAL_INSTANT": "CONCEPT_INSTANT_PRODUCT",
    "FAM_ADD_ON": "CONCEPT_ADD_ON_PRODUCT",
}

MECHANIC_TO_CONCEPT: dict[str, str] = {
    "MECH_PROGRESSIVE_JACKPOT": "CONCEPT_PROGRESSIVE_JACKPOT",
}

SEGMENT_TO_CONCEPT = "CONCEPT_PLAYER_SEGMENT"
CHANNEL_TO_CONCEPT: dict[str, str] = {
    "RETAIL": "CONCEPT_RETAIL_CHANNEL",
    "APP": "CONCEPT_DIGITAL_CHANNEL",
    "WEB": "CONCEPT_DIGITAL_CHANNEL",
}
INCIDENT_TYPE_TO_CONCEPT: dict[str, str] = {
    "INC_PAYMENTS": "CONCEPT_PLATFORM_INCIDENT",
    "INC_APP_STABILITY": "CONCEPT_PLATFORM_INCIDENT",
    "INC_DRAW_DELAY": "CONCEPT_PLATFORM_INCIDENT",
    "INC_LOGIN": "CONCEPT_PLATFORM_INCIDENT",
    "INC_RETAIL_TERMINAL": "CONCEPT_PLATFORM_INCIDENT",
}

# Labels a document reference may point at (one REFERENCES statement each).
DOCUMENT_REFERENCE_LABELS: tuple[str, ...] = (
    "Game",
    "Incident",
    "Campaign",
    "AppVersion",
    "Experiment",
)

CONCEPT_CANONICAL_NAMES: dict[str, str] = {
    "CONCEPT_NATIONAL_DRAW": "National Draw",
    "CONCEPT_MULTINATIONAL_JACKPOT": "Multinational Jackpot",
    "CONCEPT_HIGH_FREQUENCY_GAME": "High Frequency Game",
    "CONCEPT_INSTANT_PRODUCT": "Instant Product",
    "CONCEPT_ADD_ON_PRODUCT": "Add-on Product",
    "CONCEPT_PROGRESSIVE_JACKPOT": "Progressive Jackpot",
    "CONCEPT_PLAYER_SEGMENT": "Player Segment",
    "CONCEPT_RETAIL_CHANNEL": "Retail Channel",
    "CONCEPT_DIGITAL_CHANNEL": "Digital Channel",
    "CONCEPT_PLATFORM_INCIDENT": "Platform Incident",
}

METHOD_CATALOG_FLAGS = "catalog_flags_v1"
METHOD_OPERATIONAL_DEPENDENCY = "operational_dependency_v1"
METHOD_SIMILARITY = "ontology_family_mechanics_v1"
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

_SIMILAR_TOP_K = 3
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


def similarity_score(
    game_a: dict[str, Any], game_b: dict[str, Any], mechanics: dict[str, set[str]]
) -> float:
    """Structural similarity in [0, 1]: family 0.4, category 0.2, mechanics 0.4."""
    family = 0.4 if game_a["game_family_id"] == game_b["game_family_id"] else 0.0
    category = 0.2 if game_a["game_category_code"] == game_b["game_category_code"] else 0.0
    set_a = mechanics.get(game_a["game_id"], set())
    set_b = mechanics.get(game_b["game_id"], set())
    union = set_a | set_b
    mechanic = 0.4 * (len(set_a & set_b) / len(union) if union else 0.0)
    return round(family + category + mechanic, 3)


def cross_market_similar_games(
    games: list[dict[str, Any]], mechanics: dict[str, set[str]], top_k: int = _SIMILAR_TOP_K
) -> list[dict[str, Any]]:
    """Top-k SIMILAR_TO edges per game across markets, deterministically ordered.

    Rows follow the ingestion contract: ``a_id``/``b_id`` endpoints plus a
    ``props`` map for relationship properties.
    """
    edges: list[dict[str, Any]] = []
    for game in games:
        candidates = (
            (other, similarity_score(game, other, mechanics))
            for other in games
            if other["market_id"] != game["market_id"]
        )
        ranked = sorted(candidates, key=lambda pair: (-pair[1], pair[0]["game_id"]))
        for other, score in ranked[:top_k]:
            if score <= 0.0:
                continue
            edges.append(
                {
                    "a_id": game["game_id"],
                    "b_id": other["game_id"],
                    "props": {"score": score, "method": METHOD_SIMILARITY},
                }
            )
    return edges


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
