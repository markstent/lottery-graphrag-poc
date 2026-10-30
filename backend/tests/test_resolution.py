"""Entity resolution v2 and query expansion (Phase 2 task 7).

Pipeline B resolves ids and market aliases only; pipeline C adds ontology
terms in every market language, the bound local codes of the question's
market and an expanded query text. Expansion of reached concepts is ranked
by semantic relevance and capped per concept.
"""

from __future__ import annotations

import inspect
import re
from pathlib import Path

import pytest
from app.config import DEFAULT_RANKING_WEIGHTS, DEFAULT_REFERENCE_DATE, GraphRagSettings
from app.datasets.taxonomies import local_name_variants
from app.graph.statements import NODE_LABELS
from app.ontology.loader import load_ontology
from app.ontology.model import BINDING_KINDS, Binding, Concept, Ontology
from app.ontology.terms import TermMatcher, build_term_table
from app.retrieval.graph import resolution
from app.retrieval.graph.resolution import (
    BINDING_KIND_LABELS,
    IdEntityResolver,
    QueryExpansion,
    QueryExpansionResult,
    ResolvedEntity,
    TargetTypeMatcher,
    TermEntityResolver,
    schema_target_phrases,
)
from app.retrieval.graph.traversal import (
    bounded_traversal,
    expand_ontology,
    load_static_provider_from_rows,
)

from tests.test_truth_ledger_isolation import FORBIDDEN_STRINGS, _imported_modules, _tree

# Graph nodes of the modelled world: concepts are not looked up, codes and ids are.
_NODES = {
    "INC_026": "Incident",
    "MKT_AT": "Market",
    "FAM_AT_ZAHLENZIEHUNG": "GameFamily",
    "FAM_AT_RUBBELLOS": "GameFamily",
    "MECH_GR_XYSIMO": "GameMechanic",
    "MECH_AT_RUBBELN": "GameMechanic",
}
_MARKETS = {"greece": "MKT_GR", "austria": "MKT_AT", "österreich": "MKT_AT"}


def _lookup(node_id: str) -> tuple[str, bool] | None:
    label = _NODES.get(node_id)
    return None if label is None else (label, True)


def b_resolver() -> IdEntityResolver:
    return IdEntityResolver(lookup_node=_lookup, market_aliases=_MARKETS)


def c_resolver() -> TermEntityResolver:
    ontology = load_ontology()
    local_names = local_name_variants()
    inner = b_resolver()
    return TermEntityResolver(
        inner=inner,
        matcher=TermMatcher(build_term_table(ontology, local_names)),
        bindings=ontology,
        local_names=local_names,
    )


def concept(concept_id: str) -> ResolvedEntity:
    return ResolvedEntity(
        entity_id=concept_id,
        node_label="BusinessConcept",
        matched_text=concept_id,
        origin="term",
        confidence=0.8,
    )


def test_b_resolver_resolves_ids_and_markets_only() -> None:
    r = IdEntityResolver(
        lookup_node=lambda i: ("Incident", True) if i == "INC_026" else None,
        market_aliases={"greece": "MKT_GR"},
    )
    out = r.resolve("Did INC_026 in Greece involve Zahlenziehung?")
    assert [e.entity_id for e in out] == ["INC_026", "MKT_GR"]


def test_c_resolver_maps_local_term_to_concept_and_bound_code() -> None:
    out = c_resolver().resolve("Wie läuft die Zahlenziehung in Österreich?")
    ids = {e.entity_id for e in out}
    assert {"CONCEPT_NATIONAL_DRAW", "FAM_AT_ZAHLENZIEHUNG", "MKT_AT"} <= ids
    assert (
        next(e for e in out if e.entity_id == "FAM_AT_ZAHLENZIEHUNG").via_concept
        == "CONCEPT_NATIONAL_DRAW"
    )


def test_c_resolver_origins_and_confidences() -> None:
    out = c_resolver().resolve("Wie läuft die Zahlenziehung in Österreich?")
    by_id = {e.entity_id: e for e in out}
    assert [e.entity_id for e in out] == [
        "MKT_AT",
        "CONCEPT_NATIONAL_DRAW",
        "FAM_AT_ZAHLENZIEHUNG",
    ]
    term = by_id["CONCEPT_NATIONAL_DRAW"]
    assert (term.origin, term.confidence, term.node_label) == ("term", 0.8, "BusinessConcept")
    assert term.matched_text == "Zahlenziehung"
    binding = by_id["FAM_AT_ZAHLENZIEHUNG"]
    assert (binding.origin, binding.confidence, binding.node_label) == (
        "concept_binding",
        0.7,
        "GameFamily",
    )
    assert by_id["MKT_AT"].origin == "market_alias"


def test_c_resolver_without_market_binds_no_code_for_a_pure_label_or_synonym() -> None:
    # "nationale Ziehung" is a German synonym and no code's local name.
    out = c_resolver().resolve("Wie läuft die nationale Ziehung?")
    assert [e.entity_id for e in out] == ["CONCEPT_NATIONAL_DRAW"]


def test_c_resolver_binds_a_local_name_that_is_also_a_label_without_a_market() -> None:
    # "Zahlenziehung" is both the German label (term source "label") and the
    # Austrian family's display name: the family binds with no market named.
    out = c_resolver().resolve("Wie läuft die Zahlenziehung?")
    assert [e.entity_id for e in out] == ["CONCEPT_NATIONAL_DRAW", "FAM_AT_ZAHLENZIEHUNG"]
    assert out[1].via_concept == "CONCEPT_NATIONAL_DRAW"


def test_c_resolver_binds_the_code_a_local_name_came_from() -> None:
    # "XYSIMO" is the Greek mechanic's local code, not an ontology label or synonym:
    # the binding comes from the term itself, whatever market the question names.
    out = c_resolver().resolve("Πώς λειτουργεί το XYSIMO;")
    assert [(e.entity_id, e.origin) for e in out] == [
        ("CONCEPT_SYMBOL_REVEAL", "term"),
        ("MECH_GR_XYSIMO", "concept_binding"),
    ]
    ids = [e.entity_id for e in c_resolver().resolve("Is XYSIMO sold in Austria?")]
    assert ids == ["MKT_AT", "CONCEPT_SYMBOL_REVEAL", "MECH_GR_XYSIMO"]


def test_c_resolver_skips_bindings_without_a_graph_node() -> None:
    # MKT_GR's national draw family is absent from the modelled graph nodes.
    ids = [e.entity_id for e in c_resolver().resolve("nationale Ziehung in Greece")]
    assert ids == ["MKT_GR", "CONCEPT_NATIONAL_DRAW"]


def test_c_resolver_market_named_by_id_hints_the_local_code() -> None:
    ids = [e.entity_id for e in c_resolver().resolve("nationale Ziehung in MKT_AT")]
    assert ids == ["MKT_AT", "CONCEPT_NATIONAL_DRAW", "FAM_AT_ZAHLENZIEHUNG"]


def test_c_resolver_deduplicates_in_stable_order() -> None:
    out = c_resolver().resolve("Rubbellos, Scratchcard and Rubbellos again in Austria")
    ids = [e.entity_id for e in out]
    assert ids == ["MKT_AT", "CONCEPT_RETAIL_INSTANT", "FAM_AT_RUBBELLOS"]
    assert out[1].matched_text == "Rubbellos"


def test_query_expansion_adds_labels_once() -> None:
    text = (
        QueryExpansion(load_ontology())
        .expand("Στιγμιαίο Λαχείο", [concept("CONCEPT_RETAIL_INSTANT")])
        .text
    )
    assert len(re.findall(r"(?<!\w)Rubbellos(?!\w)", text)) == 1 and "Scratchcard" in text


def test_query_expansion_format_and_whole_word_skip() -> None:
    result = QueryExpansion(load_ontology()).expand(
        "Scratchcard sales", [concept("CONCEPT_RETAIL_INSTANT")]
    )
    terms = result.added_terms
    assert result.text == f"Scratchcard sales\n{'; '.join(terms)}"
    assert terms[:3] == ("Στιγμιαίο Λαχείο", "Rubbellos", "Stírací los")
    # Skipped: in the question as a whole word, or a casefold duplicate ("stírací los").
    assert "Scratchcard" not in terms and "stírací los" not in terms
    assert {"scratch card", "ξυστό", "ξυστό λαχείο", "Rubbellose", "stírací losy"} <= set(terms)
    assert len({term.casefold() for term in terms}) == len(terms)


def test_query_expansion_uses_the_concept_of_a_binding() -> None:
    binding = ResolvedEntity(
        entity_id="FAM_AT_RUBBELLOS",
        node_label="GameFamily",
        matched_text="Rubbellos",
        origin="concept_binding",
        confidence=0.7,
        via_concept="CONCEPT_RETAIL_INSTANT",
    )
    result = QueryExpansion(load_ontology()).expand("Rubbellos", [binding])
    assert "Scratchcard" in result.added_terms


def test_query_expansion_ignores_ids_and_markets() -> None:
    market = ResolvedEntity(
        entity_id="MKT_AT",
        node_label="Market",
        matched_text="austria",
        origin="market_alias",
        confidence=0.9,
    )
    result = QueryExpansion(load_ontology()).expand("News from Austria", [market])
    assert result == QueryExpansionResult(text="News from Austria", added_terms=())


def _expansion_settings(**overrides: object) -> GraphRagSettings:
    values: dict[str, object] = {
        "max_depth": 1,
        "max_nodes_per_hop": 100,
        "max_edges_per_node_type": 2,
        "max_total_nodes": 200,
        # MAPS_TO excluded so every bound entity must arrive via expansion.
        "relationship_types": ("AFFECTS",),
        "ontology_expansion": True,
        "ranking": DEFAULT_RANKING_WEIGHTS,
        "reference_date": DEFAULT_REFERENCE_DATE,
    }
    values.update(overrides)
    return GraphRagSettings(**values)  # type: ignore[arg-type]


def test_ontology_expansion_is_ranked_and_capped() -> None:
    provider = load_static_provider_from_rows(
        [("CONCEPT_X", "MAPS_TO", f"E{i}", "Incident") for i in range(1, 7)]
    )
    relevance = {"E1": 0.1, "E2": 0.4, "E3": 0.9, "E4": 0.4, "E5": 0.9, "E6": 0.2}
    scored: list[list[tuple[str, str]]] = []

    def semantic(candidates: list[tuple[str, str]]) -> list[float]:
        scored.append(candidates)
        return [relevance[node_id] for node_id, _label in candidates]

    settings = _expansion_settings()
    traversal = bounded_traversal(provider, ["CONCEPT_X"], settings)
    expanded, counts, new_edges = expand_ontology(
        provider, traversal, settings, ["CONCEPT_X"], semantic
    )
    assert [edge.to_id for edge in new_edges] == ["E3", "E5"]
    assert counts == {"CONCEPT_X": 2}
    assert scored == [[(f"E{i}", "Incident") for i in range(1, 7)]]
    assert expanded.relationships["E3"] == "MAPS_TO"
    assert expanded.path_to("E5") == ["CONCEPT_X", "E5"]


def test_ontology_expansion_ties_break_by_id_and_skip_reached_nodes() -> None:
    provider = load_static_provider_from_rows(
        [("CONCEPT_X", "MAPS_TO", f"E{i}", "Incident") for i in range(1, 5)]
    )
    settings = _expansion_settings(max_edges_per_node_type=3)
    traversal = bounded_traversal(provider, ["CONCEPT_X", "E2"], settings)
    _expanded, _counts, new_edges = expand_ontology(
        provider, traversal, settings, ["CONCEPT_X"], lambda c: [0.5] * len(c)
    )
    assert [edge.to_id for edge in new_edges] == ["E1", "E3", "E4"]


@pytest.mark.parametrize(("total", "expected"), [(2, ["E3"]), (1, [])])
def test_ontology_expansion_respects_the_total_node_cap(total: int, expected: list[str]) -> None:
    provider = load_static_provider_from_rows(
        [("CONCEPT_X", "MAPS_TO", f"E{i}", "Incident") for i in range(1, 5)]
    )
    settings = _expansion_settings(max_total_nodes=total)
    traversal = bounded_traversal(provider, ["CONCEPT_X"], settings)
    _expanded, _counts, new_edges = expand_ontology(
        provider,
        traversal,
        settings,
        ["CONCEPT_X"],
        lambda c: [1.0 if node_id == "E3" else 0.0 for node_id, _ in c],
    )
    assert [edge.to_id for edge in new_edges] == expected


# Ported from test_graph_rag.py: the B resolver's id and market behaviour.


def test_id_resolver_ignores_unknown_ids_and_unsafe_prefixes() -> None:
    resolver = IdEntityResolver(
        lookup_node=lambda i: ("Player", True) if i.startswith("PLY_") else None,
        market_aliases={},
    )
    assert resolver.resolve("Look at INC_999 and PLY_0001") == []


def test_id_resolver_never_seeds_documents_chunks_or_concepts() -> None:
    """Documents and chunks reach every pipeline through the document channel,
    and B never starts from the ontology (D-026; design: B resolves ids of
    structural record nodes and market aliases only)."""
    every_id_exists = IdEntityResolver(lookup_node=lambda i: ("Node", True), market_aliases={})
    question = "Compare DOC_S007_UK, CHNK_S007_UK_00, CONCEPT_PLATFORM_INCIDENT and INC_026"
    assert [e.entity_id for e in every_id_exists.resolve(question)] == ["INC_026"]


def test_market_alias_match_is_whole_word() -> None:
    resolver = IdEntityResolver(lookup_node=_lookup, market_aliases={"AT": "MKT_AT"})
    assert resolver.resolve("What happened at the draw?") != []
    assert resolver.resolve("A nationwide flatline") == []


def test_concept_terms_do_not_split_labels_into_words() -> None:
    ids = {e.entity_id for e in c_resolver().resolve("Which incident hit the draw last week?")}
    assert "CONCEPT_PAYMENT_INCIDENT" not in ids
    assert "CONCEPT_PLATFORM_INCIDENT" not in ids


@pytest.mark.parametrize(
    "question",
    ["Was there a payment incident in Austria?", "Gab es einen Zahlungsfehler im März?"],
)
def test_concept_terms_match_whole_phrases_in_any_language(question: str) -> None:
    assert "CONCEPT_PAYMENT_INCIDENT" in {e.entity_id for e in c_resolver().resolve(question)}


def test_concept_term_match_is_whole_word() -> None:
    assert c_resolver().resolve("A withdrawal was delayed") == []


# ------------------------------------------------------------ target types


def _concept(concept_id: str, parent_id: str | None, en: str, de: str) -> Concept:
    return Concept(
        concept_id=concept_id,
        parent_id=parent_id,
        concept_type="product",
        labels={"en": en, "el": f"{en} el", "de": de, "cs": f"{en} cs"},
        synonyms={"en": (f"{en} game",), "de": ()},
        definition=f"{en}.",
    )


def _target_ontology() -> Ontology:
    """Scratch card (bound to a category) with a child bound to a family and a
    grandchild bound to a mechanic; an unbound concept names nothing."""
    return Ontology(
        version="test",
        concepts=(
            _concept("C_SCRATCH", None, "Scratch card", "Rubbellos"),
            _concept("C_ONLINE_SCRATCH", "C_SCRATCH", "Online scratch card", "Online-Rubbellos"),
            _concept("C_REVEAL", "C_ONLINE_SCRATCH", "Reveal", "Aufdecken"),
            _concept("C_UNBOUND", None, "Jackpot", "Jackpot"),
        ),
        bindings=(
            Binding("category", "CAT_UK_SCRATCH", "MKT_UK", "C_SCRATCH"),
            Binding("family", "FAM_AT_RUBBELLOS", "MKT_AT", "C_ONLINE_SCRATCH"),
            Binding("mechanic", "MECH_AT_RUBBELN", "MKT_AT", "C_REVEAL"),
        ),
    )


def test_every_binding_kind_names_a_graph_label() -> None:
    assert BINDING_KIND_LABELS.keys() == BINDING_KINDS
    assert set(BINDING_KIND_LABELS.values()) <= set(NODE_LABELS)


def test_schema_phrases_from_labels_and_tables() -> None:
    phrases = schema_target_phrases()
    assert phrases["platform version"] == {"PlatformVersion"}
    assert phrases["mechanic"] == {"GameMechanic"}
    assert "version" not in phrases
    assert "category" not in phrases
    assert "type" not in phrases
    assert phrases["support cases"] == {"SupportCase"}
    assert phrases["case"] == {"SupportCase"}
    assert phrases["platform"] == {"Platform"}
    assert not {"business concept", "document", "document chunk", "chunk"} & phrases.keys()


def test_matches_whole_words_and_plurals() -> None:
    question = "Which other markets had incidents on the same platform version as incident INC_037?"
    assert TargetTypeMatcher().match(question) == {"Market", "Incident", "PlatformVersion"}


def test_longest_phrase_consumes_its_words() -> None:
    matcher = TargetTypeMatcher()
    assert matcher.match("Which game mechanic is used most?") == {"GameMechanic"}
    assert matcher.match("Which player segments churned?") == {"PlayerSegment"}
    assert matcher.match("Which platform had the outage?") == {"Platform"}
    assert matcher.match("Which game and which platform version?") == {"Game", "PlatformVersion"}


def test_match_is_casefolded_and_whole_word() -> None:
    matcher = TargetTypeMatcher()
    assert matcher.match("PLATFORM VERSIONS released in March") == {"PlatformVersion"}
    assert matcher.match("Supermarkets and gameplay") == frozenset()
    assert matcher.match("GAME_UK_01 sales") == frozenset()


def test_no_match_gives_empty_set() -> None:
    assert TargetTypeMatcher().match("What happened last Tuesday?") == frozenset()


def test_b_matcher_ignores_ontology_terms() -> None:
    assert TargetTypeMatcher().match("How did Rubbellos sell?") == frozenset()
    assert TargetTypeMatcher().match("How did the scratch card sell?") == frozenset()


def test_c_matcher_adds_bound_kind_labels() -> None:
    matcher = TargetTypeMatcher(_target_ontology())
    # The concept's own binding and those of its descendants, recursively.
    expected = {"GameCategory", "GameFamily", "GameMechanic"}
    assert matcher.match("How did the scratch card sell?") == expected
    assert matcher.match("Wie lief Rubbellos?") == expected
    assert matcher.match("Which online scratch cards sold?") == {"GameFamily", "GameMechanic"}
    assert matcher.match("Which Aufdecken titles?") == {"GameMechanic"}
    assert matcher.match("Who won the jackpot?") == frozenset()
    # Schema phrases still match in C, in their own pass: the synonym
    # "scratch card game" does not consume the schema word "game".
    assert matcher.match("How did the scratch card game sell?") == {"Game", *expected}
    assert matcher.match("Which markets sold scratch cards?") == {"Market", *expected}


def test_plural_of_a_last_word_ending_in_y() -> None:
    matcher = TargetTypeMatcher()
    assert matcher.match("Which game categories sold best?") == {"GameCategory"}
    assert matcher.match("Which currencies are used?") == {"Currency"}
    assert matcher.match("Which game category sold best?") == {"GameCategory"}
    assert TargetTypeMatcher(_target_ontology()).match("How do online scratch cards sell?") == {
        "GameFamily",
        "GameMechanic",
    }


@pytest.mark.parametrize("question", ["Which payment incidents happened in Austria?", "draw games"])
def test_c_keeps_what_b_names_with_the_real_ontology(question: str) -> None:
    b = TargetTypeMatcher().match(question)
    c = TargetTypeMatcher(load_ontology()).match(question)
    assert b
    assert c >= b
    assert c > b  # the ontology adds its bound labels on top


def test_c_contains_b_for_every_ontology_term() -> None:
    ontology = load_ontology()
    b_matcher, c_matcher = TargetTypeMatcher(), TargetTypeMatcher(ontology)
    terms = {
        term
        for concept in ontology.concepts
        for term in (
            *concept.labels.values(),
            *(synonym for synonyms in concept.synonyms.values() for synonym in synonyms),
        )
    }
    missing = {
        term: b_matcher.match(term) - c_matcher.match(term)
        for term in sorted(terms)
        if not b_matcher.match(term) <= c_matcher.match(term)
    }
    assert missing == {}


def test_vocabulary_reads_only_schema_and_ontology() -> None:
    path = Path(inspect.getfile(resolution))
    imports = _imported_modules(_tree(path), path)
    forbidden = ("app.evaluation", "app.scenarios", "app.datasets.bank")
    assert not any(name.startswith(forbidden) for name in imports)
    source = path.read_text(encoding="utf-8")
    assert not any(marker in source for marker in FORBIDDEN_STRINGS)
    assert list(inspect.signature(TargetTypeMatcher.__init__).parameters) == ["self", "ontology"]
