"""Entity resolution and query expansion for graph seeds (docs/reference/retrieval/graph-rag.md).

Pipeline B resolves exact graph ids and market names (`IdEntityResolver`).
Pipeline C adds the ontology layer (`TermEntityResolver`): every concept
label, synonym and local display name in the four market languages, and the
local code a concept is bound to in the question's market. `QueryExpansion`
appends the resolved concepts' labels and synonyms to the question so C's
document channel searches in every market language.

`TargetTypeMatcher` finds the graph node types a question asks about (the
"target type" of docs/evaluation/v0.3-method-proposal.md section 4.1, D-083).
Its vocabulary comes from the graph schema and, in C, the ontology; never
from the question bank, answer keys, truth ledger or hand labels.

- Schema phrases (B and C, `schema_target_phrases`): for every node label
  except `BusinessConcept`, `Document` and `DocumentChunk`, the label split
  into lower-case words ("platform version"); its last word alone when no
  other label ends in that word ("mechanic", "case"; not "version",
  "category" or "type"); and the label's `NODE_SOURCES` table with "_" as a
  space ("platform versions").
- Ontology phrases (C only): every concept label and synonym in every
  language names the graph labels of the binding kinds (`BINDING_KIND_LABELS`)
  bound to that concept or any of its descendants. A concept with no
  bindings in its subtree names nothing.

A phrase matches as whole words, casefolded, with an optional plural "s" or
"es" on its last word; a last word ending in "y" also matches with "ies"
("game categories", "currencies"). Matching is leftmost-longest and
non-overlapping: the question is scanned from the left; at each position the
longest phrase that matches wins, and the words it consumes do not also match
a shorter phrase. So "game mechanic" names `GameMechanic` and not `Game`,
and "platform version" names `PlatformVersion` and not `Platform`, while
"platform" on its own names `Platform`.

The schema phrases and the ontology phrases are matched in two separate
passes, each leftmost-longest, and their labels are united. So C always
names every label B names: an ontology term such as "payment incident"
adds its bound labels without consuming the schema word "incident". Within
one pass, a phrase given by several labels or concepts names all of them.

Resolution is deterministic and model-free, so seed selection is
reproducible and auditable.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Iterator, Mapping, Sequence
from dataclasses import dataclass
from typing import Protocol

from app.graph.statements import NODE_LABELS
from app.ontology.model import LANGUAGES, Concept, Ontology
from app.ontology.terms import TermMatcher
from app.retrieval.graph.source_lookup import NODE_SOURCES, SEED_ID_PREFIXES

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


# ------------------------------------------------------------ target types

# Graph label of the local codes of each ontology binding kind.
BINDING_KIND_LABELS: dict[str, str] = {
    "family": "GameFamily",
    "category": "GameCategory",
    "mechanic": "GameMechanic",
    "incident_type": "IncidentType",
    "support_category": "SupportCategory",
    "segment": "PlayerSegment",
    "channel": "Channel",
}

# Labels that are not record types a question asks for: concepts are the
# ontology itself, documents reach every pipeline through the document channel.
_NON_TARGET_LABELS = frozenset({CONCEPT_LABEL, "Document", "DocumentChunk"})
_LABEL_WORD = re.compile(r"[A-Z][a-z]*")


def schema_target_phrases() -> dict[str, frozenset[str]]:
    """Casefolded schema phrase -> the graph labels it names (see the module docstring)."""
    words = {
        label: [w.casefold() for w in _LABEL_WORD.findall(label)]
        for label in NODE_LABELS
        if label not in _NON_TARGET_LABELS
    }
    last_word_owners: dict[str, int] = {}
    for label_words in words.values():
        last_word_owners[label_words[-1]] = last_word_owners.get(label_words[-1], 0) + 1
    phrases: dict[str, set[str]] = {}
    for label, label_words in words.items():
        found = {" ".join(label_words)}
        if last_word_owners[label_words[-1]] == 1:
            found.add(label_words[-1])
        if label in NODE_SOURCES:
            found.add(NODE_SOURCES[label][0].replace("_", " "))
        for phrase in found:
            phrases.setdefault(phrase, set()).add(label)
    return {phrase: frozenset(labels) for phrase, labels in phrases.items()}


def _ontology_target_phrases(ontology: Ontology) -> dict[str, frozenset[str]]:
    """Casefolded concept label or synonym -> graph labels bound in its subtree."""

    def subtree_labels(concept_id: str) -> set[str]:
        labels = {BINDING_KIND_LABELS[b.kind] for b in ontology.codes_for(concept_id)}
        for child in ontology.children(concept_id):
            labels |= subtree_labels(child.concept_id)
        return labels

    phrases: dict[str, set[str]] = {}
    for concept in ontology.concepts:
        labels = subtree_labels(concept.concept_id)
        if not labels:
            continue
        terms = [*concept.labels.values(), *(s for syn in concept.synonyms.values() for s in syn)]
        for term in terms:
            folded = " ".join(term.casefold().split())
            if folded:
                phrases.setdefault(folded, set()).update(labels)
    return {phrase: frozenset(labels) for phrase, labels in phrases.items()}


def _phrase_pattern(
    phrases: Mapping[str, frozenset[str]],
) -> tuple[re.Pattern[str], dict[str | None, frozenset[str]]]:
    """One leftmost-longest pattern over `phrases` and the labels of each alternative.

    Alternatives are sorted longest first, so the regex engine's leftmost-first
    alternation takes the longest phrase at each position. Alternative i is the
    named group "p<i>" and holds no other capturing group, so a match's
    `lastgroup` keys its labels.
    """
    labels: dict[str | None, frozenset[str]] = {}
    alternatives: list[str] = []
    for index, phrase in enumerate(sorted(phrases, key=lambda p: (-len(p), p))):
        labels[f"p{index}"] = phrases[phrase]
        *head, last = phrase.split()
        if last.endswith("y"):
            last_pattern = rf"{re.escape(last[:-1])}(?:ies|y(?:e?s)?)"
        else:
            last_pattern = rf"{re.escape(last)}(?:e?s)?"
        body = r"\s+".join([*(re.escape(word) for word in head), last_pattern])
        alternatives.append(rf"(?P<p{index}>{body})")
    return re.compile(rf"(?<!\w)(?:{'|'.join(alternatives)})(?!\w)"), labels


class TargetTypeMatcher:
    """The graph labels a question asks about: schema phrases, and in C ontology terms.

    B passes no ontology. C adds a second pass over the ontology phrases, so
    its result always contains B's (see the module docstring).
    """

    def __init__(self, ontology: Ontology | None = None) -> None:
        sources = [schema_target_phrases()]
        if ontology is not None:
            sources.append(_ontology_target_phrases(ontology))
        self._passes = [_phrase_pattern(phrases) for phrases in sources if phrases]

    def match(self, question: str) -> frozenset[str]:
        """Graph labels named by the question's phrases; empty when none match."""
        folded = question.casefold()
        found: set[str] = set()
        for pattern, labels in self._passes:
            for m in pattern.finditer(folded):
                found |= labels[m.lastgroup]
        return frozenset(found)
