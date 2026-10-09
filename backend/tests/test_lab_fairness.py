"""Lab fairness tests (docs/08 Phase 12): the B/C contract is structural.

Pipeline B must be exactly pipeline C minus ontology traversal, so any
measured B/C difference is attributable to the ontology layer and not to
divergent configuration. These tests pin that contract offline.
"""

from __future__ import annotations

import dataclasses

from app.retrieval.graph.lab import FRAUD_RELATIONSHIP_TYPES, bc_graph_settings

from tests.test_graph_rag import make_settings


def diff_labels(base_settings: object, other: object) -> list[str]:
    """Top-level settings fields whose values differ."""
    return [
        field.name
        for field in dataclasses.fields(base_settings)  # type: ignore[arg-type]
        if getattr(base_settings, field.name) != getattr(other, field.name)
    ]


def test_b_and_c_differ_only_in_graph_traversal() -> None:
    base = make_settings()
    settings_b, settings_c = bc_graph_settings(base, profile=None)
    assert diff_labels(base, settings_b) == ["graph"]
    assert diff_labels(base, settings_c) in ([], ["graph"])
    assert diff_labels(settings_b, settings_c) == ["graph"]


def test_c_relationships_are_b_plus_maps_to() -> None:
    base = make_settings()
    settings_b, settings_c = bc_graph_settings(base, profile=None)
    assert "MAPS_TO" in base.graph.relationship_types
    assert "MAPS_TO" not in settings_b.graph.relationship_types
    assert settings_c.graph.relationship_types == base.graph.relationship_types
    # B preserves the C order with MAPS_TO removed: same traversal menu.
    without_maps = tuple(rel for rel in settings_c.graph.relationship_types if rel != "MAPS_TO")
    assert settings_b.graph.relationship_types == without_maps


def test_only_c_expands_the_ontology() -> None:
    base = make_settings()
    settings_b, settings_c = bc_graph_settings(base, profile=None)
    assert settings_b.graph.ontology_expansion is False
    assert settings_c.graph.ontology_expansion is True


def test_fraud_profile_adds_the_same_edges_to_both() -> None:
    base = make_settings()
    settings_b, settings_c = bc_graph_settings(base, profile="fraud")
    plain_b, plain_c = bc_graph_settings(base, profile=None)
    assert settings_b.graph.relationship_types == (
        plain_b.graph.relationship_types + FRAUD_RELATIONSHIP_TYPES
    )
    assert settings_c.graph.relationship_types == (
        plain_c.graph.relationship_types + FRAUD_RELATIONSHIP_TYPES
    )
    assert settings_b.graph.ontology_expansion is False
    assert settings_c.graph.ontology_expansion is True
