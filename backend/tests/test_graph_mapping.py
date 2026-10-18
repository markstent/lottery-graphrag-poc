"""Unit tests for graph derivation mappings (no Neo4j required)."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from app.datasets.config import GenerationConfig
from app.datasets.world import World, build_world
from app.graph import mapping
from app.ontology.loader import load_ontology
from app.ontology.model import BINDING_KINDS, Ontology
from app.ontology.similarity import METHOD

BINDING_LABELS: dict[str, str] = {
    "family": "GameFamily",
    "category": "GameCategory",
    "mechanic": "GameMechanic",
    "incident_type": "IncidentType",
    "support_category": "SupportCategory",
    "segment": "PlayerSegment",
    "channel": "Channel",
}


@pytest.fixture(scope="module")
def onto() -> Ontology:
    return load_ontology()


@pytest.fixture(scope="module")
def tiny_world() -> World:
    return build_world(GenerationConfig(profile="tiny", world_seed=42))


def test_concept_rows_carry_four_labels_and_parent(onto: Ontology) -> None:
    rows = {r["id"]: r for r in mapping.concept_node_rows(onto)}
    row = rows["CONCEPT_PAYMENT_INCIDENT"]
    assert row["parent_id"] == "CONCEPT_PLATFORM_INCIDENT"
    assert all(row[f"label_{lang}"] for lang in ("en", "el", "de", "cs"))
    assert row["canonical_name"] == row["label_en"]
    assert row["ontology_version"] == "2.0.0"
    assert row["source_system"] == "ontology"
    assert row["source_table"] == "ontology.yaml"
    assert row["source_record_id"] == "CONCEPT_PAYMENT_INCIDENT"


def test_concept_rows_cover_every_concept_with_prefixed_sorted_synonyms(onto: Ontology) -> None:
    rows = mapping.concept_node_rows(onto)
    assert [r["id"] for r in rows] == [c.concept_id for c in onto.concepts]
    row = next(r for r in rows if r["id"] == "CONCEPT_PAYMENT_INCIDENT")
    assert row["synonyms"] == sorted(row["synonyms"])
    assert "el:αποτυχία πληρωμής" in row["synonyms"]
    assert {s.split(":", 1)[0] for s in row["synonyms"]} == {"en", "el", "de", "cs"}


def test_root_concept_rows_omit_parent(onto: Ontology) -> None:
    rows = {r["id"]: r for r in mapping.concept_node_rows(onto)}
    for root in onto.roots():
        assert "parent_id" not in rows[root.concept_id]


def test_is_a_rows_link_every_non_root_to_its_parent(onto: Ontology) -> None:
    rows = mapping.is_a_rows(onto)
    expected = {(c.concept_id, c.parent_id) for c in onto.concepts if c.parent_id is not None}
    assert {(r["a_id"], r["b_id"]) for r in rows} == expected
    assert len(rows) == len(expected)
    assert all(r["props"] == {"ontology_version": onto.version} for r in rows)


def test_maps_to_rows_cover_every_binding_kind(onto: Ontology) -> None:
    assert set(BINDING_LABELS) == BINDING_KINDS
    total = sum(
        len(mapping.maps_to_rows(onto, kind, label)) for kind, label in BINDING_LABELS.items()
    )
    assert total == len(onto.bindings)


def test_maps_to_rows_point_codes_at_bound_concepts(onto: Ontology) -> None:
    rows = mapping.maps_to_rows(onto, "incident_type", "IncidentType")
    assert rows
    for row in rows:
        assert onto.concept_for("incident_type", row["a_id"]) == row["b_id"]
        assert row["props"] == {"ontology_version": onto.version}


def test_game_concepts_resolve_through_bindings(onto: Ontology) -> None:
    game = {
        "game_id": "GAME_UK_01",
        "market_id": "MKT_UK",
        "game_family_id": "FAM_UK_NATIONAL_DRAW",
        "game_category_code": "CAT_UK_DRAW",
    }
    concepts = mapping.game_concepts(game, {"MECH_UK_NUMBER_MATCH"}, onto)
    assert concepts.family_concept == onto.concept_for("family", "FAM_UK_NATIONAL_DRAW")
    assert concepts.category_concept == onto.concept_for("category", "CAT_UK_DRAW")
    assert concepts.mechanic_concepts == {onto.concept_for("mechanic", "MECH_UK_NUMBER_MATCH")}


def test_game_concepts_reject_unbound_codes(onto: Ontology) -> None:
    game = {
        "game_id": "GAME_X",
        "market_id": "MKT_UK",
        "game_family_id": "FAM_NOT_BOUND",
        "game_category_code": "CAT_UK_DRAW",
    }
    with pytest.raises(KeyError, match="FAM_NOT_BOUND"):
        mapping.game_concepts(game, set(), onto)


def test_similar_to_is_ontology_derived_and_cross_market(tiny_world: World, onto: Ontology) -> None:
    rows = mapping.similar_to_rows(
        [g._asdict() for g in tiny_world.tables["games"]],
        [m._asdict() for m in tiny_world.tables["game_mechanic_map"]],
        onto,
    )
    assert rows and all(r["props"]["method"] == METHOD == "ontology_similarity_v2" for r in rows)
    assert all(r["props"]["ontology_version"] == onto.version for r in rows)
    assert all(0.0 < r["props"]["score"] <= 1.0 for r in rows)
    market = {g.game_id: g.market_id for g in tiny_world.tables["games"]}
    assert all(market[r["a_id"]] != market[r["b_id"]] for r in rows)
    keys = [(r["a_id"], -r["props"]["score"], r["b_id"]) for r in rows]
    assert keys == sorted(keys)


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
