"""Unit tests for centralised Cypher statements and example queries."""

from __future__ import annotations

import pytest
from app.graph import statements


def test_node_statements_merge_on_id_with_provenance_parameters() -> None:
    for label in statements.NODE_LABELS:
        query = statements.node_statement(label)
        assert f"MERGE (n:{label} {{id: row.id}})" in query
        assert "n.label_version = $label_version" in query
        assert "n.ingestion_version = $ingestion_version" in query


def test_unknown_node_label_is_rejected() -> None:
    with pytest.raises(KeyError):
        statements.node_statement("NotALabel")


def test_relationship_statements_match_fixed_endpoints() -> None:
    query = statements.relationship_statement("AFFECTS", "Incident", "Game")
    assert "MATCH (a:Incident {id: row.a_id})" in query
    assert "MATCH (b:Game {id: row.b_id})" in query
    assert "MERGE (a)-[r:AFFECTS]->(b)" in query


def test_relationship_type_registry_is_valid() -> None:
    with pytest.raises(KeyError):
        statements.relationship_statement("NOT_A_REL", "Game", "Market")
    with pytest.raises(KeyError):
        statements.relationship_statement("AFFECTS", "NotALabel", "Game")
    with pytest.raises(KeyError):
        statements.relationship_statement("AFFECTS", "Incident", "NotALabel")


def test_schema_statements_cover_constraints_and_indexes() -> None:
    schema = statements.schema_statements()
    constraints = [s for s in schema if "CREATE CONSTRAINT" in s]
    assert len(constraints) == len(statements.NODE_LABELS)
    joined = "\n".join(schema)
    for fragment in (
        "FOR (n:Market) ON (n.market_code)",
        "FOR (n:Game) ON (n.name)",
        "FOR (n:BusinessConcept) ON (n.concept_type)",
        "ON (n.source_record_id)",
    ):
        assert fragment in joined


@pytest.mark.parametrize(
    "name",
    [
        "cross_market_similar_products",
        "ontology_assisted_product_lookup",
        "cross_market_incident_transfer",
        "campaign_transferability",
        "multilingual_concept_lookup",
        "incident_context",
    ],
)
def test_example_queries_are_bounded(name: str) -> None:
    query = statements.example_query(name)
    assert "$limit" in query
    assert "LIMIT $limit" in query


def test_v2_labels_and_relationship_types_are_registered() -> None:
    for label in ("IncidentType", "SupportCategory", "PaymentProvider"):
        assert label in statements.NODE_LABELS
    for rel_type in ("IS_A", "OF_TYPE", "CATEGORISED_AS", "PROVIDED_BY"):
        assert rel_type in statements.RELATIONSHIP_TYPES
    assert len(set(statements.NODE_LABELS)) == len(statements.NODE_LABELS) == 29
    assert len(set(statements.RELATIONSHIP_TYPES)) == len(statements.RELATIONSHIP_TYPES) == 30


def test_ontology_relationship_types_are_declared() -> None:
    assert statements.ONTOLOGY_RELATIONSHIP_TYPES == ("MAPS_TO", "SIMILAR_TO", "IS_A")
    assert set(statements.ONTOLOGY_RELATIONSHIP_TYPES) <= set(statements.RELATIONSHIP_TYPES)


def test_label_count_statement_is_registry_bound() -> None:
    assert "MATCH (n:IncidentType)" in statements.label_count_statement("IncidentType")
    with pytest.raises(KeyError):
        statements.label_count_statement("NotALabel")


def test_relationship_count_statement_is_registry_bound() -> None:
    query = statements.relationship_count_statement("OF_TYPE", "Incident", "IncidentType")
    assert "MATCH (:Incident)-[r:OF_TYPE]->(:IncidentType)" in query
    with pytest.raises(KeyError):
        statements.relationship_count_statement("NOT_A_REL", "Incident", "IncidentType")
    with pytest.raises(KeyError):
        statements.relationship_count_statement("OF_TYPE", "NotALabel", "IncidentType")


def test_retrieval_markets_are_ordered() -> None:
    assert "ORDER BY id" in statements.RETRIEVAL_MARKETS


def test_ontology_read_queries_are_ordered() -> None:
    assert "ORDER BY id" in statements.ONTOLOGY_TREE
    assert "[:MAPS_TO]" in statements.ONTOLOGY_BINDING_COUNTS
    assert "ORDER BY" in statements.ONTOLOGY_BINDING_COUNTS


def test_schema_statements_index_new_labels() -> None:
    joined = "\n".join(statements.schema_statements())
    for label in ("IncidentType", "SupportCategory", "PaymentProvider"):
        assert f"FOR (n:{label}) REQUIRE n.id IS UNIQUE" in joined
    assert "FOR (n:BusinessConcept) ON (n.parent_id)" in joined


def test_graph_schema_yaml_matches_registries() -> None:
    import yaml
    from app.datasets.config import REPO_ROOT

    schema = yaml.safe_load((REPO_ROOT / "schemas/graph/graph-schema.yaml").read_text("utf-8"))
    assert schema["schema_version"] == "2.0.0"
    assert set(schema["node_types"]) == set(statements.NODE_LABELS)
    assert set(schema["relationship_types"]) == set(statements.RELATIONSHIP_TYPES)
    assert tuple(schema["ontology_relationship_types"]) == statements.ONTOLOGY_RELATIONSHIP_TYPES
    for removed in ("Rule", "PREFERS", "DESCRIBES", "DEFINES", "ABOUT", "EQUIVALENT_TO"):
        assert removed not in schema["node_types"] + schema["relationship_types"]


@pytest.mark.parametrize(
    "name", ["multilingual_concept_lookup", "ontology_assisted_product_lookup"]
)
def test_example_queries_do_not_use_removed_game_concept_edge(name: str) -> None:
    assert "INSTANCE_OF]->(concept" not in statements.example_query(name)


def test_example_incident_transfer_goes_through_incident_type() -> None:
    query = statements.example_query("cross_market_incident_transfer")
    assert "[:OF_TYPE]" in query
    assert "(incident)-[:MAPS_TO]" not in query
