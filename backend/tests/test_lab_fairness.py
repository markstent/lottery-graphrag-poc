"""Lab fairness tests (docs/08 Phase 12): the B/C contract is structural.

Pipeline B must be exactly pipeline C minus ontology traversal, so any
measured B/C difference is attributable to the ontology layer and not to
divergent configuration. These tests pin that contract offline.
"""

from __future__ import annotations

import dataclasses

import pytest
from app.config import RetrievalSettings
from app.graph.statements import ONTOLOGY_RELATIONSHIP_TYPES
from app.retrieval.graph.lab import bc_graph_settings

from tests.test_graph_rag import make_settings


def diff_labels(base_settings: object, other: object) -> list[str]:
    """Top-level settings fields whose values differ."""
    return [
        field.name
        for field in dataclasses.fields(base_settings)  # type: ignore[arg-type]
        if getattr(base_settings, field.name) != getattr(other, field.name)
    ]


@pytest.fixture
def base() -> RetrievalSettings:
    return make_settings()


def test_b_and_c_differ_only_in_graph_traversal(base: RetrievalSettings) -> None:
    settings_b, settings_c = bc_graph_settings(base)
    assert diff_labels(base, settings_b) == ["graph"]
    assert diff_labels(base, settings_c) in ([], ["graph"])
    assert diff_labels(settings_b, settings_c) == ["graph"]


def test_b_excludes_every_ontology_relationship_and_nothing_else(
    base: RetrievalSettings,
) -> None:
    settings_b, settings_c = bc_graph_settings(base)
    removed = set(settings_c.graph.relationship_types) - set(settings_b.graph.relationship_types)
    assert removed == set(ONTOLOGY_RELATIONSHIP_TYPES)
    assert not settings_b.graph.ontology_expansion
    assert settings_c.graph.ontology_expansion


def test_b_preserves_the_c_order_for_non_ontology_types(base: RetrievalSettings) -> None:
    settings_b, settings_c = bc_graph_settings(base)
    assert settings_c.graph.relationship_types == base.graph.relationship_types
    expected = tuple(
        rel for rel in settings_c.graph.relationship_types if rel not in ONTOLOGY_RELATIONSHIP_TYPES
    )
    assert settings_b.graph.relationship_types == expected


def test_every_question_traverses_player_instruments(base: RetrievalSettings) -> None:
    settings_b, settings_c = bc_graph_settings(base)
    for relationship in ("USES", "USES_PAYMENT"):
        assert relationship in base.graph.relationship_types
        assert relationship in settings_b.graph.relationship_types
        assert relationship in settings_c.graph.relationship_types


def test_allow_list_sizes_and_mechanic_path(base: RetrievalSettings) -> None:
    settings_b, settings_c = bc_graph_settings(base)
    assert len(settings_c.graph.relationship_types) == 22
    assert len(settings_b.graph.relationship_types) == 19
    assert "HAS_MECHANIC" in settings_b.graph.relationship_types
    assert "HAS_MECHANIC" in settings_c.graph.relationship_types
