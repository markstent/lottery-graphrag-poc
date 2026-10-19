"""Entity resolution v2 and query expansion (Phase 2 task 7).

Pipeline B resolves ids and market aliases only; pipeline C adds ontology
terms in every market language, the bound local codes of the question's
market and an expanded query text. Expansion of reached concepts is ranked
by semantic relevance and capped per concept.
"""

from __future__ import annotations

import re

import pytest
from app.config import DEFAULT_RANKING_WEIGHTS, DEFAULT_REFERENCE_DATE, GraphRagSettings
from app.datasets.taxonomies import local_name_variants
from app.ontology.loader import load_ontology
from app.ontology.terms import TermMatcher, build_term_table
from app.retrieval.graph.resolution import (
    IdEntityResolver,
    QueryExpansion,
    QueryExpansionResult,
    ResolvedEntity,
    TermEntityResolver,
)
from app.retrieval.graph.traversal import (
    bounded_traversal,
    expand_ontology,
    load_static_provider_from_rows,
)

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
