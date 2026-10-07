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
