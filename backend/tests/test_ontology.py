from pathlib import Path

import pytest
from app.ontology import ONTOLOGY_VERSION
from app.ontology.loader import OntologyError, load_ontology
from app.ontology.similarity import GameConcepts, concept_similarity, cross_market_similar
from app.ontology.terms import Term, TermMatcher, build_term_table


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
        == onto.concept_for("family", "FAM_AT_ZAHLENLOTTERIE")
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


def test_term_matcher_finds_local_and_synonym_terms() -> None:
    onto = load_ontology()
    table = build_term_table(onto, {("family", "FAM_AT_ZAHLENLOTTERIE"): ("Zahlenlotterie",)})
    matcher = TermMatcher(table)
    hits = {m.term.concept_id for m in matcher.match("Wie läuft die Zahlenlotterie in Österreich?")}
    assert "CONCEPT_NATIONAL_DRAW" in hits


def test_term_matcher_is_whole_word_and_non_overlapping() -> None:
    matcher = TermMatcher(
        [
            Term("draw game", "en", "CONCEPT_DRAW_GAME", "label"),
            Term("draw", "en", "CONCEPT_X", "label"),
        ]
    )
    matches = matcher.match("A draw game and a withdrawal.")
    assert [m.term.concept_id for m in matches] == ["CONCEPT_DRAW_GAME"]


def test_term_matcher_matches_greek_inside_a_sentence_with_offsets() -> None:
    matcher = TermMatcher([Term("λαχείο", "el", "CONCEPT_LOTTERY", "label")])
    text = "Πόσα λαχείο πουλήθηκαν;"
    (match,) = matcher.match(text)
    assert text[match.start : match.end] == "λαχείο"


def test_term_matcher_does_not_match_inside_identifiers() -> None:
    matcher = TermMatcher([Term("uk", "en", "CONCEPT_UK", "synonym")])
    assert matcher.match("GAME_UK_01") == ()
    assert len(matcher.match("sales in the UK.")) == 1


def test_shared_synonym_yields_one_match_per_concept() -> None:
    matcher = TermMatcher(
        [Term("bet", "en", "CONCEPT_B", "synonym"), Term("bet", "en", "CONCEPT_A", "synonym")]
    )
    matches = matcher.match("Place a bet")
    assert [m.term.concept_id for m in matches] == ["CONCEPT_A", "CONCEPT_B"]
    assert {(m.start, m.end) for m in matches} == {(8, 11)}


def test_term_table_is_lowercase_deduplicated_and_sorted() -> None:
    table = build_term_table(
        load_ontology(),
        {
            ("family", "FAM_AT_ZAHLENLOTTERIE"): (" Zahlenlotterie ",),
            ("family", "FAM_GR_ARITHMOLACHEIO"): (" Arithmolacheio Plus ",),
        },
    )
    assert all(t.text == t.text.casefold().strip() and t.text for t in table)
    keys = [(t.text, t.concept_id, t.language) for t in table]
    assert keys == sorted(keys)
    assert len({(t.text, t.concept_id) for t in table}) == len(table)
    assert any(t.source == "local_name" and t.text == "arithmolacheio plus" for t in table)
    assert not any(t.source == "local_name" and t.text == "zahlenlotterie" for t in table)


def test_similarity_links_equivalent_products_across_markets() -> None:
    gr = GameConcepts(
        "GAME_GR_01",
        "MKT_GR",
        "CONCEPT_NATIONAL_DRAW",
        "CONCEPT_DRAW_GAME",
        frozenset({"CONCEPT_NUMBER_SELECTION", "CONCEPT_QUICK_PICK"}),
    )
    at = GameConcepts(
        "GAME_AT_01",
        "MKT_AT",
        "CONCEPT_NATIONAL_DRAW",
        "CONCEPT_DRAW_GAME",
        frozenset({"CONCEPT_NUMBER_SELECTION"}),
    )
    assert concept_similarity(gr, at) == 0.8
    assert cross_market_similar([gr, at])[0].method == "ontology_similarity_v2"


def test_cross_market_similar_excludes_same_market_and_zero_and_caps_top_k() -> None:
    def game(gid: str, market: str, family: str, cat: str = "C") -> GameConcepts:
        return GameConcepts(gid, market, family, cat, frozenset())

    games = [
        game("A1", "M1", "F"),
        game("A2", "M1", "F"),
        game("B1", "M2", "F"),
        game("B2", "M2", "F"),
        game("C1", "M3", "Z", "Y"),
    ]
    edges = cross_market_similar(games, top_k=1)
    assert [(e.a_id, e.b_id) for e in edges if e.a_id == "A1"] == [("A1", "B1")]
    assert all(e.score > 0 for e in edges)
    assert not any(e.a_id in {"A1", "A2"} and e.b_id in {"A1", "A2"} for e in edges)
    assert not any("C1" in (e.a_id, e.b_id) for e in edges)


def test_term_matcher_maps_offsets_when_casefold_changes_length() -> None:
    onto = load_ontology()
    matcher = TermMatcher(build_term_table(onto, {("family", "X"): ("Außenstelle",)}))
    assert not matcher.match("nothing here")
    matcher = TermMatcher([Term("außenstelle".casefold(), "de", "CONCEPT_S", "local_name")])
    text = "Die Außenstelle meldet Zahlungsfehler."
    (match,) = matcher.match(text)
    assert text[match.start : match.end] == "Außenstelle"


def test_term_matcher_handles_greek_final_sigma() -> None:
    term = "κληρώσεις".casefold()
    matcher = TermMatcher([Term(term, "el", "CONCEPT_DRAW", "label")])
    text = "Πόσες ΚΛΗΡΏΣΕΙΣ έγιναν;"
    (match,) = matcher.match(text)
    assert text[match.start : match.end] == "ΚΛΗΡΏΣΕΙΣ"


def test_term_matcher_does_not_match_inside_longer_word() -> None:
    matcher = TermMatcher([Term("draw", "en", "CONCEPT_X", "label")])
    assert matcher.match("a drawn card") == ()


def test_term_matcher_prefers_longer_greek_term() -> None:
    matcher = TermMatcher(
        [
            Term("κληρώσεις".casefold(), "el", "CONCEPT_A", "label"),
            Term("συχνές κληρώσεις".casefold(), "el", "CONCEPT_B", "label"),
        ]
    )
    matches = matcher.match("Συχνές Κληρώσεις")
    assert [m.term.concept_id for m in matches] == ["CONCEPT_B"]


def test_every_local_code_has_exactly_one_binding_and_vice_versa() -> None:
    from app.datasets.taxonomies import local_name_variants, local_names

    onto = load_ontology()
    codes = set(local_names())
    assert set(local_name_variants()) == codes
    bound = {(b.kind, b.code) for b in onto.bindings}
    assert codes == bound
    assert len(onto.bindings) == len(bound)
    assert all(onto.concept(b.concept_id) for b in onto.bindings)


def test_mechanic_codes_and_local_descriptions_are_both_terms() -> None:
    from app.datasets.taxonomies import GAME_MECHANICS, local_name_variants

    variants = local_name_variants()
    mechanics = [key for key in variants if key[0] == "mechanic"]
    assert len(mechanics) == len(GAME_MECHANICS)
    assert all(len(variants[key]) == 2 for key in mechanics)
    matcher = TermMatcher(build_term_table(load_ontology(), variants))
    hits = matcher.match("Spieler nutzen Zufällig gewählte Zahlenreihen am Wochenende.")
    assert {m.term.concept_id for m in hits} >= {"CONCEPT_QUICK_PICK"}
    assert any(
        m.term.source == "local_name" and m.term.concept_id == "CONCEPT_QUICK_PICK" for m in hits
    )
