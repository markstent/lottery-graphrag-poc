"""Entity resolution and query expansion for graph seeds (docs/reference/retrieval/graph-rag.md).

Pipeline B resolves exact graph ids and market names (`IdEntityResolver`).
Pipeline C adds the ontology layer (`TermEntityResolver`): every concept
label, synonym and local display name in the four market languages, and the
local code a concept is bound to in the question's market. `QueryExpansion`
appends the resolved concepts' labels and synonyms to the question so C's
document channel searches in every market language.

Resolution is deterministic and model-free, so seed selection is
reproducible and auditable.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Iterator, Mapping, Sequence
from dataclasses import dataclass
from typing import Protocol

from app.ontology.model import LANGUAGES, Concept, Ontology
from app.ontology.terms import TermMatcher
from app.retrieval.graph.source_lookup import SEED_ID_PREFIXES

_ID_TOKEN = re.compile(r"\b[A-Z]{2,12}(?:_[A-Z0-9]+)+\b")

# Id prefixes that are safe seed candidates, one per seedable record table
# (``source_lookup.SEED_ID_PREFIXES``). Player-transaction ids are never
# seeds: traversal limits plus the relationship allow-list already keep
# retrieval away from transactional neighbours. Documents and chunks are not seeds
# (their text reaches every pipeline through the document channel, D-026),
# and concept ids are not seeds for the id resolver, so pipeline B never
# starts from the ontology.
_SEED_PREFIXES = tuple(SEED_ID_PREFIXES.values())

TERM_CONFIDENCE = 0.8
BINDING_CONFIDENCE = 0.7
CONCEPT_LABEL = "BusinessConcept"


@dataclass(frozen=True, slots=True)
class ResolvedEntity:
    """One question mention mapped to a graph node."""

    entity_id: str
    node_label: str
    matched_text: str
    origin: str  # "id" | "market_alias" | "term" | "concept_binding" | "vector_fallback"
    # Resolver confidence in [0, 1]; None for the vector fallback seed,
    # whose fused retrieval score is reported as ``fused_score`` instead.
    confidence: float | None
    # The concept a "concept_binding" entity was reached through.
    via_concept: str | None = None


class EntityResolver(Protocol):
    def resolve(self, question: str) -> list[ResolvedEntity]:
        """Map question mentions to graph node ids (deduplicated, ordered)."""
        ...


NodeLookup = Callable[[str], tuple[str, bool] | None]


class IdEntityResolver:
    """Pipeline B: exact graph ids and whole-word market aliases; no concepts.

    `lookup_node` returns (node_label, exists) for a candidate id or None;
    the Neo4j adapter backs it with one parameterised lookup.
    """

    def __init__(self, *, lookup_node: NodeLookup, market_aliases: Mapping[str, str]) -> None:
        self.lookup_node = lookup_node
        self._market_aliases = {alias.lower(): node_id for alias, node_id in market_aliases.items()}

    def resolve(self, question: str) -> list[ResolvedEntity]:
        resolved: list[ResolvedEntity] = []
        seen: set[str] = set()
        for token in dict.fromkeys(_ID_TOKEN.findall(question)):
            if not token.startswith(_SEED_PREFIXES):
                continue
            found = self.lookup_node(token)
            if found is None or not found[1]:
                continue
            resolved.append(ResolvedEntity(token, found[0], token, "id", 1.0))
            seen.add(token)
        lower = question.lower()
        for alias, market_id in self._market_aliases.items():
            if market_id in seen or not re.search(rf"\b{re.escape(alias)}\b", lower):
                continue
            resolved.append(ResolvedEntity(market_id, "Market", alias, "market_alias", 0.9))
            seen.add(market_id)
        return resolved


class TermEntityResolver:
    """Pipeline C: the B resolver plus ontology terms and their bound local codes.

    Each term match yields its concept. When the matched text is the local
    display name of some of the concept's codes, it also yields those codes,
    whatever the term's source (a local name equal to a label, such as
    "Zahlenziehung", arrives as a label term). Otherwise it yields the
    concept's codes in the first market the id resolver found, if any.
    Codes without a graph node are skipped. Duplicates are removed in
    first-seen order.
    """

    def __init__(
        self,
        *,
        inner: IdEntityResolver,
        matcher: TermMatcher,
        bindings: Ontology,
        local_names: Mapping[tuple[str, str], Sequence[str]],
    ) -> None:
        self._inner = inner
        self._matcher = matcher
        self._ontology = bindings
        self._local_names = {
            key: {name.casefold().strip() for name in names} for key, names in local_names.items()
        }

    def resolve(self, question: str) -> list[ResolvedEntity]:
        resolved = self._inner.resolve(question)
        seen = {entity.entity_id for entity in resolved}
        market = next((e.entity_id for e in resolved if e.node_label == "Market"), None)
        for match in self._matcher.match(question):
            term = match.term
            matched_text = question[match.start : match.end]
            candidates = [
                ResolvedEntity(
                    term.concept_id, CONCEPT_LABEL, matched_text, "term", TERM_CONFIDENCE
                ),
                *self._bound_codes(term.concept_id, term.text, market, matched_text),
            ]
            for entity in candidates:
                if entity.entity_id not in seen:
                    resolved.append(entity)
                    seen.add(entity.entity_id)
        return resolved

    def _bound_codes(
        self, concept_id: str, text: str, market: str | None, matched_text: str
    ) -> Iterator[ResolvedEntity]:
        bindings = self._ontology.codes_for(concept_id)
        named = [b for b in bindings if text in self._local_names.get((b.kind, b.code), ())]
        chosen = named or [b for b in bindings if market is not None and b.market_id == market]
        for binding in chosen:
            found = self._inner.lookup_node(binding.code)
            if found is None or not found[1]:
                continue
            yield ResolvedEntity(
                binding.code,
                found[0],
                matched_text,
                "concept_binding",
                BINDING_CONFIDENCE,
                via_concept=concept_id,
            )


class StaticEntityResolver:
    """Pre-seeded resolver for tests and offline runs."""

    def __init__(self, entities: list[ResolvedEntity]) -> None:
        self._entities = entities

    def resolve(self, question: str) -> list[ResolvedEntity]:
        return list(self._entities)


@dataclass(frozen=True, slots=True)
class QueryExpansionResult:
    """The search text (question plus added terms) and the terms added, in order."""

    text: str
    added_terms: tuple[str, ...]


class QueryExpansion:
    """Appends the resolved concepts' labels and synonyms to the question (pipeline C).

    The added terms follow the question on a new line, joined by "; ": the
    label in each market language (English first: the canonical name), then
    the synonyms. Each distinct term (casefold) is added once, and not at all
    when the question already contains it as a whole word.
    """

    def __init__(self, ontology: Ontology) -> None:
        self._ontology = ontology

    def expand(self, question: str, resolved: Sequence[ResolvedEntity]) -> QueryExpansionResult:
        folded_question = question.casefold()
        added: dict[str, str] = {}
        for concept_id in _concepts_of(resolved):
            for text in self._terms_of(concept_id):
                folded = text.casefold()
                if folded in added or re.search(
                    rf"(?<!\w){re.escape(folded)}(?!\w)", folded_question
                ):
                    continue
                added[folded] = text
        terms = tuple(added.values())
        text = f"{question}\n{'; '.join(terms)}" if terms else question
        return QueryExpansionResult(text=text, added_terms=terms)

    def _terms_of(self, concept_id: str) -> Iterator[str]:
        concept = self._ontology.concept(concept_id)
        for language in LANGUAGES:
            yield concept.labels[language]
        for language in LANGUAGES:
            yield from concept.synonyms.get(language, ())


def concept_text(concept: Concept) -> str:
    """A BusinessConcept node's text, from the ontology (pipeline C).

    "Concept <canonical name>: <definition> Labels: <language>: <label>; ...
    Synonyms: <language>: <synonym>, ...; ..." with the English label as the
    canonical name and languages in market order.
    """
    labels = "; ".join(f"{language}: {concept.labels[language]}" for language in LANGUAGES)
    synonyms = "; ".join(
        f"{language}: {', '.join(concept.synonyms[language])}"
        for language in LANGUAGES
        if concept.synonyms.get(language)
    )
    text = f"Concept {concept.labels['en']}: {concept.definition} Labels: {labels}."
    return f"{text} Synonyms: {synonyms}." if synonyms else text


def _concepts_of(resolved: Sequence[ResolvedEntity]) -> list[str]:
    """Concept ids of term and binding entities, first-seen order."""
    concepts: dict[str, None] = {}
    for entity in resolved:
        if entity.origin == "term":
            concepts.setdefault(entity.entity_id)
        elif entity.origin == "concept_binding" and entity.via_concept is not None:
            concepts.setdefault(entity.via_concept)
    return list(concepts)
