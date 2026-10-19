"""Benchmark bank 2.0.0 integrity tests."""

from __future__ import annotations

from collections import Counter

import pytest
from app.evaluation.bank import (
    ANCHORS_PER_QUESTION,
    BANK,
    BANK_VERSION,
    NAME_ANCHORED,
    STRATA,
    question_by_id,
)
from app.scenarios.catalogue import SCENARIO_CATALOGUE


def test_bank_shape() -> None:
    assert BANK_VERSION == "2.0.0" and len(BANK) == 22
    assert len({q.question_id for q in BANK}) == 22
    counts = Counter((q.stratum, q.sub_stratum) for q in BANK)
    assert counts == {
        ("H3", None): 4,
        ("H1", None): 4,
        ("H2", "id_anchored"): 4,
        ("H2", "name_anchored"): 2,
        ("H5", None): 8,
    }
    assert {q.stratum for q in BANK} == set(STRATA)
    assert ANCHORS_PER_QUESTION == 3
    assert NAME_ANCHORED == "entity resolution through the ontology"


def test_templates_carry_exactly_one_anchor_slot() -> None:
    for q in BANK:
        slots = q.template.count("{anchor}") + q.template.count("{anchor_name}")
        assert slots == 1, q.question_id


def test_name_anchored_questions_quote_the_local_name() -> None:
    for q in BANK:
        assert ("{anchor_name}" in q.template) == (q.sub_stratum == "name_anchored")
        if q.sub_stratum == "name_anchored":
            assert '"{anchor_name}"' in q.template


def test_planted_questions_name_catalogued_scenarios() -> None:
    planted = {q.scenario_id for q in BANK if q.stratum == "H5"}
    assert planted == {
        "SCN-001",
        "SCN-002",
        "SCN-003",
        "SCN-007",
        "SCN-009",
        "SCN-010",
        "SCN-011",
        "SCN-015",
    }
    assert planted <= {spec.scenario_id for spec in SCENARIO_CATALOGUE}
    assert all(q.scenario_id is None for q in BANK if q.stratum != "H5")


def test_h2_questions_are_ontology_dependent() -> None:
    assert all(q.ontology_dependent for q in BANK if q.stratum == "H2")
    assert {q.question_id for q in BANK if q.ontology_dependent} == {
        *(f"L{n:02d}" for n in range(9, 15)),
        "L20",
        "L21",
    }


def test_question_by_id() -> None:
    assert question_by_id("L15").scenario_id == "SCN-001"
    with pytest.raises(KeyError):
        question_by_id("L99")
