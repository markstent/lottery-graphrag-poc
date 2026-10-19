"""Unit tests for graph derivation mappings (no Neo4j required)."""

from __future__ import annotations

import time
from datetime import UTC, date, datetime
from typing import Any

import pytest
from app.datasets.config import GenerationConfig
from app.datasets.schema import TABLE_SCHEMAS
from app.datasets.world import World, build_world
from app.graph import mapping, statements
from app.graph.config import LABEL_VERSION
from app.graph.ingest import IngestStats, expected_relationship_counts
from app.graph.node_rows import build_node_rows
from app.graph.relationship_rows import BINDING_LABELS, RelationshipKey, build_relationship_rows
from app.ontology.loader import load_ontology
from app.ontology.model import BINDING_KINDS, Ontology
from app.ontology.similarity import METHOD


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
    tickets: list[dict[str, Any]] = [
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


# ------------------------------------------------------------ row builders
LINEAR_PLAYERS = 20_000
LINEAR_BUDGET_SECONDS = 2.0


@pytest.fixture(scope="module")
def tiny_tables(tiny_world: World) -> dict[str, list[dict[str, Any]]]:
    return {name: [r._asdict() for r in rows] for name, rows in tiny_world.tables.items()}


@pytest.fixture(scope="module")
def tiny_nodes(
    tiny_tables: dict[str, list[dict[str, Any]]], onto: Ontology
) -> dict[str, list[dict[str, Any]]]:
    return build_node_rows(tiny_tables, onto)


@pytest.fixture(scope="module")
def tiny_rels(
    tiny_tables: dict[str, list[dict[str, Any]]], onto: Ontology
) -> dict[RelationshipKey, list[dict[str, Any]]]:
    return build_relationship_rows(tiny_tables, onto)


def test_node_rows_carry_validity_and_source_timestamp(
    tiny_nodes: dict[str, list[dict[str, Any]]],
) -> None:
    game = tiny_nodes["Game"][0]
    assert game["valid_from"] == game["launch_date"]
    assert "valid_to" not in game or game["valid_to"] == game["retirement_date"]
    incident = tiny_nodes["Incident"][0]
    assert incident["valid_from"] == incident["started_at"]
    assert all("valid_to" not in row for row in tiny_nodes["Incident"])
    assert incident["source_timestamp"] == incident["started_at"]
    document = tiny_nodes["Document"][0]
    assert document["source_timestamp"] == document["created_at"]
    campaign = tiny_nodes["Campaign"][0]
    assert (campaign["valid_from"], campaign["valid_to"]) == (
        campaign["start_at"],
        campaign["end_at"],
    )
    assert campaign["source_timestamp"] == campaign["start_at"]
    version = tiny_nodes["PlatformVersion"][0]
    assert version["valid_from"] == version["source_timestamp"] == version["released_at"]
    assert all("source_timestamp" not in row for row in tiny_nodes["GameFamily"])
    assert (
        tiny_nodes["IncidentType"]
        and tiny_nodes["SupportCategory"]
        and tiny_nodes["PaymentProvider"]
        and tiny_nodes["BusinessConcept"]
    )


def test_taxonomy_nodes_come_from_world_tables(
    tiny_tables: dict[str, list[dict[str, Any]]], tiny_nodes: dict[str, list[dict[str, Any]]]
) -> None:
    segments = {row["id"]: row for row in tiny_nodes["PlayerSegment"]}
    assert set(segments) == {row["segment_id"] for row in tiny_tables["player_segments"]}
    segment = next(iter(segments.values()))
    assert {"market_id", "segment_kind", "name", "language_code"} <= set(segment)
    assert "code" not in segment and "description" not in segment
    assert segment["source_table"] == "player_segments"
    family = tiny_nodes["GameFamily"][0]
    assert {"market_id", "name", "language_code"} <= set(family)
    provider = tiny_nodes["PaymentProvider"][0]
    assert {"name", "platform_id", "source_record_id"} <= set(provider)
    assert all(row["payment_type"] != "SHARED_POOL" for row in tiny_nodes["PaymentMethod"])


def test_relationship_rows_have_no_game_to_concept_instance_edges(
    tiny_rels: dict[RelationshipKey, list[dict[str, Any]]],
) -> None:
    assert ("INSTANCE_OF", "Game", "BusinessConcept") not in tiny_rels
    assert ("INSTANCE_OF", "Game", "GameCategory") in tiny_rels
    assert ("OF_TYPE", "Incident", "IncidentType") in tiny_rels
    assert ("CATEGORISED_AS", "SupportCase", "SupportCategory") in tiny_rels
    assert ("PROVIDED_BY", "PaymentMethod", "PaymentProvider") in tiny_rels
    assert ("IS_A", "BusinessConcept", "BusinessConcept") in tiny_rels
    assert ("SIMILAR_TO", "Game", "Game") in tiny_rels
    for label in BINDING_LABELS.values():
        assert ("MAPS_TO", label, "BusinessConcept") in tiny_rels


def test_has_mechanic_props_carry_validity(
    tiny_rels: dict[RelationshipKey, list[dict[str, Any]]],
) -> None:
    rows = tiny_rels[("HAS_MECHANIC", "Game", "GameMechanic")]
    assert all({"valid_from", "valid_to"} <= set(row["props"]) for row in rows)


def test_every_relationship_endpoint_has_a_node(
    tiny_nodes: dict[str, list[dict[str, Any]]],
    tiny_rels: dict[RelationshipKey, list[dict[str, Any]]],
) -> None:
    ids = {label: {row["id"] for row in rows} for label, rows in tiny_nodes.items()}
    for (rel_type, label_a, label_b), rows in tiny_rels.items():
        missing_a = {row["a_id"] for row in rows} - ids[label_a]
        missing_b = {row["b_id"] for row in rows} - ids[label_b]
        assert not missing_a, f"({label_a})-[:{rel_type}]->({label_b}) sources: {missing_a}"
        assert not missing_b, f"({label_a})-[:{rel_type}]->({label_b}) targets: {missing_b}"


def test_expected_relationship_counts_collapse_duplicate_pairs() -> None:
    rels: dict[RelationshipKey, list[dict[str, Any]]] = {
        ("PLAYS", "Player", "Game"): [
            {"a_id": "P1", "b_id": "G1", "props": {}},
            {"a_id": "P1", "b_id": "G1", "props": {"ticket_count": 2}},
            {"a_id": "P1", "b_id": "G2", "props": {}},
        ]
    }
    assert expected_relationship_counts(rels) == {("PLAYS", "Player", "Game"): 2}


def test_ingest_stats_to_json(onto: Ontology) -> None:
    stats = IngestStats(
        ingestion_version="ing-test",
        label_version=LABEL_VERSION,
        ontology_version=onto.version,
        nodes={"Game": 20},
        relationships=[("PLAYS", "Player", "Game", 7)],
    )
    assert LABEL_VERSION == "v2"
    assert stats.to_json() == {
        "ingestion_version": "ing-test",
        "label_version": "v2",
        "ontology_version": onto.version,
        "nodes": {"Game": 20},
        "relationships": [{"type": "PLAYS", "from": "Player", "to": "Game", "count": 7}],
    }


def _synthetic_tables(players: int) -> dict[str, list[dict[str, Any]]]:
    """Minimal dict tables with many players and the rows they reference."""
    tables: dict[str, list[dict[str, Any]]] = {name: [] for name in TABLE_SCHEMAS}
    seen = datetime(2025, 1, 1, tzinfo=UTC)
    for n in range(players):
        player_id = f"PLAYER_UK_{n:06d}"
        tables["players"].append(
            {
                "player_id": player_id,
                "value_segment": "SEG_UK_VALUE_HIGH",
                "engagement_segment": "SEG_UK_ENG_ENGAGED",
            }
        )
        tables["player_device"].append(
            {
                "player_id": player_id,
                "device_id": f"DEV_UK_{n:06d}",
                "usage_weight": 1.0,
                "first_seen_at": seen,
                "last_seen_at": seen,
            }
        )
        tables["player_payment_method"].append(
            {
                "player_id": player_id,
                "payment_method_id": f"PAY_UK_{n:07d}",
                "usage_weight": 1.0,
                "first_used_at": seen,
            }
        )
        tables["payment_methods"].append(
            {"payment_method_id": f"PAY_UK_{n:07d}", "provider_id": "PROV_CARD"}
        )
        tables["support_cases"].append(
            {
                "support_case_id": f"SUP_{n:05d}",
                "market_id": "MKT_UK",
                "game_id": None,
                "incident_id": None,
                "category_code": "SUPCAT_UK_ACCOUNT",
            }
        )
    tables["game_mechanic_map"] = []
    tables["documents"] = [
        {
            "document_id": "DOC_0001",
            "market_id": None,
            "title": "Note",
            "body": "",
            "created_at": seen,
            "valid_from": date(2025, 1, 1),
        }
    ]
    return tables


def test_relationship_building_is_linear(onto: Ontology) -> None:
    tables = _synthetic_tables(players=LINEAR_PLAYERS)
    started = time.perf_counter()
    rels = build_relationship_rows(tables, onto)
    elapsed = time.perf_counter() - started
    assert len(rels[("BELONGS_TO", "Player", "PlayerSegment")]) == 2 * LINEAR_PLAYERS
    assert elapsed < LINEAR_BUDGET_SECONDS


def test_every_registered_label_has_node_rows(
    tiny_nodes: dict[str, list[dict[str, Any]]],
) -> None:
    assert set(tiny_nodes) == set(statements.NODE_LABELS)
    assert all(rows for rows in tiny_nodes.values())
