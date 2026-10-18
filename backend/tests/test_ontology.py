from pathlib import Path

import pytest
from app.ontology import ONTOLOGY_VERSION
from app.ontology.loader import OntologyError, load_ontology


def test_loads_v2_with_hierarchy_and_four_languages() -> None:
    onto = load_ontology()
    assert onto.version == ONTOLOGY_VERSION == "2.0.0"
    assert onto.ancestors("CONCEPT_PAYMENT_INCIDENT") == (
        "CONCEPT_PLATFORM_INCIDENT",
        "CONCEPT_INCIDENT",
    )
    for concept in onto.concepts:
        assert set(concept.labels) == {"en", "el", "de", "cs"}


def test_equivalent_local_families_share_a_concept() -> None:
    onto = load_ontology()
    assert (
        onto.concept_for("family", "FAM_GR_ARITHMOLACHEIO")
        == onto.concept_for("family", "FAM_AT_ZAHLENLOTTO")
        == "CONCEPT_NATIONAL_DRAW"
    )


def test_loader_rejects_unknown_parent(tmp_path: Path) -> None:
    bad = tmp_path / "o.yaml"
    bad.write_text(
        'ontology_version: "2.0.0"\nconcepts:\n'
        "  - {id: X, parent: NOPE, type: T, labels: {en: a, el: b, de: c, cs: d},"
        " synonyms: {}, definition: z}\nbindings: []\n"
    )
    with pytest.raises(OntologyError):
        load_ontology(bad)


def test_navigation_methods() -> None:
    onto = load_ontology()
    assert [c.concept_id for c in onto.roots()] == [
        "CONCEPT_LOTTERY_PRODUCT",
        "CONCEPT_GAME_MECHANIC",
        "CONCEPT_INCIDENT",
        "CONCEPT_SUPPORT_TOPIC",
        "CONCEPT_PLAYER_SEGMENT",
        "CONCEPT_SALES_CHANNEL",
    ]
    assert [c.concept_id for c in onto.children("CONCEPT_INSTANT_PRODUCT")] == [
        "CONCEPT_RETAIL_INSTANT",
        "CONCEPT_DIGITAL_INSTANT",
    ]
    assert onto.ancestors("CONCEPT_LOTTERY_PRODUCT") == ()
    assert onto.concept("CONCEPT_DRAW_GAME").parent_id == "CONCEPT_LOTTERY_PRODUCT"
    with pytest.raises(KeyError):
        onto.concept("CONCEPT_MISSING")
    assert onto.concept_for("family", "FAM_UNBOUND") is None
    assert onto.concept_for("channel", "APP") == "CONCEPT_DIGITAL_CHANNEL"
    digital = onto.codes_for("CONCEPT_DIGITAL_CHANNEL", kind="channel")
    assert {b.code for b in digital} == {"APP", "WEB"}
    assert all(b.market_id is None for b in digital)
    corporate = [b for b in onto.codes_for("CONCEPT_PAYMENT_INCIDENT") if b.market_id is None]
    assert [b.code for b in corporate] == ["ITYPE_CORP_PAYMENT"]


def test_leaf_concepts_have_synonyms_in_every_language_and_a_definition() -> None:
    onto = load_ontology()
    parents = {c.parent_id for c in onto.concepts}
    for concept in onto.concepts:
        assert concept.definition
        if concept.concept_id not in parents:
            assert all(concept.synonyms.get(lang) for lang in ("en", "el", "de", "cs")), (
                concept.concept_id
            )


def _yaml(concepts: str, bindings: str = "[]") -> str:
    return f'ontology_version: "2.0.0"\nconcepts:\n{concepts}bindings: {bindings}\n'


def _concept(cid: str, parent: str = "null", labels: str = "{en: a, el: b, de: c, cs: d}") -> str:
    return (
        f"  - {{id: {cid}, parent: {parent}, type: T, labels: {labels},"
        " synonyms: {}, definition: z}\n"
    )


@pytest.mark.parametrize(
    ("text", "message"),
    [
        (_yaml(_concept("A") + _concept("A")), "duplicate concept id"),
        (_yaml(_concept("A", labels="{en: a, el: b, de: c}")), "missing label"),
        (
            _yaml(
                _concept("A"),
                "[{kind: family, code: F, market: M, concept: A},"
                " {kind: family, code: F, market: M, concept: A}]",
            ),
            "duplicate binding",
        ),
        (
            _yaml(_concept("A"), "[{kind: family, code: F, market: M, concept: B}]"),
            "unknown concept",
        ),
        (
            _yaml(_concept("A"), "[{kind: brand, code: F, market: M, concept: A}]"),
            "unknown binding kind",
        ),
        (_yaml(_concept("A", parent="B") + _concept("B", parent="A")), "cycle"),
        ("concepts: []\n", "ontology_version"),
    ],
)
def test_loader_rejects_invalid_documents(tmp_path: Path, text: str, message: str) -> None:
    bad = tmp_path / "o.yaml"
    bad.write_text(text)
    with pytest.raises(OntologyError, match=message):
        load_ontology(bad)


def test_ontology_error_is_a_value_error() -> None:
    assert issubclass(OntologyError, ValueError)
