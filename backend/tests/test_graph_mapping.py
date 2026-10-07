"""Unit tests for graph derivation mappings (no Neo4j required)."""

from __future__ import annotations

from datetime import UTC, datetime

from app.datasets.master_data import GAME_SPECS
from app.graph import mapping


def _game(
    game_id: str, market: str, family: str, category: str, mechanics: tuple[str, ...]
) -> dict:
    return {
        "game_id": game_id,
        "market_id": f"MKT_{market}",
        "game_family_id": family,
        "game_category_code": category,
    }


def test_every_game_family_maps_to_a_concept() -> None:
    families = {spec.family_id for spec in GAME_SPECS}
    assert families <= set(mapping.FAMILY_TO_CONCEPT)


def test_every_incident_type_maps_to_a_concept() -> None:
    assert set(mapping.INCIDENT_TYPE_TO_CONCEPT) == {
        "INC_PAYMENTS",
        "INC_APP_STABILITY",
        "INC_DRAW_DELAY",
        "INC_LOGIN",
        "INC_RETAIL_TERMINAL",
    }


def test_instant_families_share_one_canonical_concept() -> None:
    """Ontology value: two product families unify under one concept."""
    assert (
        mapping.FAMILY_TO_CONCEPT["FAM_INSTANT_WIN"]
        == mapping.FAMILY_TO_CONCEPT["FAM_DIGITAL_INSTANT"]
        == "CONCEPT_INSTANT_PRODUCT"
    )


def test_similarity_score_bounds_and_determinism() -> None:
    mechanics = {"G1": {"MECH_A", "MECH_B"}, "G2": {"MECH_A"}, "G3": set()}
    a = _game("G1", "UK", "FAM_NATIONAL_DRAW", "CAT_DRAW", ("MECH_A",))
    b = _game("G2", "GR", "FAM_NATIONAL_DRAW", "CAT_DRAW", ("MECH_A",))
    c = _game("G3", "AT", "FAM_INSTANT_WIN", "CAT_INSTANT", ())

    assert mapping.similarity_score(a, b, mechanics) == 0.8
    assert mapping.similarity_score(a, c, mechanics) == 0.0
    assert 0.0 <= mapping.similarity_score(a, c, mechanics) <= 1.0


def test_cross_market_similarity_excludes_same_market_and_is_bounded() -> None:
    games = [
        _game("G1", "UK", "FAM_NATIONAL_DRAW", "CAT_DRAW", ("M1",)),
        _game("G2", "UK", "FAM_NATIONAL_DRAW", "CAT_DRAW", ("M1",)),
        _game("G3", "GR", "FAM_NATIONAL_DRAW", "CAT_DRAW", ("M1",)),
        _game("G4", "AT", "FAM_ANNUITY", "CAT_DRAW", ("M1",)),
    ]
    edges = mapping.cross_market_similar_games(
        games, {"G1": {"M1"}, "G2": {"M1"}, "G3": {"M1"}, "G4": {"M1"}}
    )

    assert all(edge["a_id"] != edge["b_id"] for edge in edges)
    assert all(
        next(g for g in games if g["game_id"] == edge["a_id"])["market_id"]
        != next(g for g in games if g["game_id"] == edge["b_id"])["market_id"]
        for edge in edges
    )
    per_game = [edge for edge in edges if edge["a_id"] == "G1"]
    assert len(per_game) <= 3
    assert all(edge["props"]["method"] == "ontology_family_mechanics_v1" for edge in edges)


def test_campaign_target_segment_derivation() -> None:
    players = {
        "P1": {"engagement_segment": "SEG_ENG_ENGAGED"},
        "P2": {"engagement_segment": "SEG_ENG_CASUAL"},
    }
    exposures = [
        {"campaign_id": "C1", "player_id": "P1", "engaged": True},
        {"campaign_id": "C1", "player_id": "P2", "engaged": True},
        {"campaign_id": "C1", "player_id": "P1", "engaged": True},
        {"campaign_id": "C1", "player_id": "P2", "engaged": False},
        {"campaign_id": "C2", "player_id": "P2", "engaged": True},
    ]

    edges = mapping.campaign_target_segments(exposures, players)

    by_campaign = {edge["a_id"]: edge for edge in edges}
    assert by_campaign["C1"]["b_id"] == "SEG_ENG_ENGAGED"
    assert by_campaign["C1"]["props"]["share"] == 0.667
    assert by_campaign["C2"]["b_id"] == "SEG_ENG_CASUAL"


def test_player_game_aggregation_excludes_anonymous_and_void() -> None:
    ts = datetime(2025, 3, 1, tzinfo=UTC)
    tickets = [
        {"player_id": "P1", "game_id": "G1", "ticket_status": "SETTLED", "purchase_timestamp": ts},
        {
            "player_id": "P1",
            "game_id": "G1",
            "ticket_status": "SETTLED",
            "purchase_timestamp": ts.replace(day=2),
        },
        {"player_id": None, "game_id": "G1", "ticket_status": "SETTLED", "purchase_timestamp": ts},
        {"player_id": "P2", "game_id": "G1", "ticket_status": "VOID", "purchase_timestamp": ts},
    ]

    edges = mapping.player_game_edges(tickets)

    assert len(edges) == 1
    assert edges[0]["a_id"] == "P1"
    assert edges[0]["props"]["ticket_count"] == 2
    assert edges[0]["props"]["last_purchase_at"] == ts.replace(day=2)


def test_document_reference_parsing() -> None:
    refs = mapping.document_references(
        "Incident Report: INC_007",
        "Incident INC_007 affected game GAME_UK_03 and campaign CMP_002. See also INC_007 again.",
    )
    targets = [(ref["target_kind"], ref["target_id"]) for ref in refs]

    assert ("Incident", "INC_007") in targets
    assert ("Game", "GAME_UK_03") in targets
    assert ("Campaign", "CMP_002") in targets
    assert targets.count(("Incident", "INC_007")) == 1


def test_document_reference_cap() -> None:
    body = " ".join(f"INC_{i:03d}" for i in range(1, 10))
    refs = mapping.document_references("Report", body)
    assert len(refs) == 5


def test_runs_on_and_available_via_derivation() -> None:
    digital = {"digital_enabled": True, "retail_enabled": False}
    retail = {"digital_enabled": False, "retail_enabled": True}
    both = {"digital_enabled": True, "retail_enabled": True}

    assert "PLT_RETAIL" not in mapping.game_runs_on(digital)
    assert "PLT_DRAW" in mapping.game_runs_on(digital)
    assert "PLT_RETAIL" in mapping.game_runs_on(retail)
    assert set(mapping.game_available_via(both)) == {"APP", "WEB", "RETAIL"}


def test_ingestion_version_format() -> None:
    version = mapping.ingestion_version_now()
    assert version.startswith("ing-")
    assert len(version) == len("ing-YYYYmmddTHHMMSSZ")
