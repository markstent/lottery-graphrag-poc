"""Multilingual term table and whole-word term matcher over ontology concepts."""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from app.ontology.model import Ontology

# Language tag for local display names, which carry no language of their own (ISO 639 "und").
LOCAL_NAME_LANGUAGE = "und"


@dataclass(frozen=True, slots=True)
class Term:
    """A lower-cased surface form that denotes one concept."""

    text: str
    language: str
    concept_id: str
    source: str  # "label", "synonym" or "local_name"


@dataclass(frozen=True, slots=True)
class TermMatch:
    """A term found in a text; `start`/`end` are offsets into the original text."""

    term: Term
    start: int
    end: int


def build_term_table(
    ontology: Ontology, local_names: Mapping[tuple[str, str], Sequence[str]]
) -> tuple[Term, ...]:
    """All labels, synonyms and local display names as terms, deduplicated and sorted.

    `local_names` maps a binding's `(kind, code)` to the display names the generator gives it
    (`app.datasets.taxonomies.local_name_variants()`).
    Duplicates on `(text, concept_id)` keep the first source seen: label, synonym, local_name.
    """
    seen: dict[tuple[str, str], Term] = {}

    def add(text: str, language: str, concept_id: str, source: str) -> None:
        folded = text.casefold().strip()
        if folded:
            seen.setdefault((folded, concept_id), Term(folded, language, concept_id, source))

    for concept in ontology.concepts:
        for language, label in concept.labels.items():
            add(label, language, concept.concept_id, "label")
    for concept in ontology.concepts:
        for language, synonyms in concept.synonyms.items():
            for synonym in synonyms:
                add(synonym, language, concept.concept_id, "synonym")
    for binding in ontology.bindings:
        for name in local_names.get((binding.kind, binding.code), ()):
            add(name, LOCAL_NAME_LANGUAGE, binding.concept_id, "local_name")
    return tuple(sorted(seen.values(), key=lambda t: (t.text, t.concept_id, t.language)))


class TermMatcher:
    """Finds terms in text: whole-word, case-insensitive, longest match first, no overlaps."""

    def __init__(self, terms: Sequence[Term]) -> None:
        self._by_text: dict[str, list[Term]] = {}
        for term in sorted(terms, key=lambda t: (t.concept_id, t.language, t.source)):
            self._by_text.setdefault(term.text, []).append(term)
        # Longest alternatives first so the regex engine prefers the longest term at a position.
        # \w covers Unicode letters, digits and "_", so "GAME_UK_01" does not contain "uk".
        alternatives = "|".join(
            re.escape(t) for t in sorted(self._by_text, key=lambda t: (-len(t), t))
        )
        self._pattern = re.compile(rf"(?<!\w)(?:{alternatives})(?!\w)") if alternatives else None

    def match(self, text: str) -> tuple[TermMatch, ...]:
        """Matches ordered by position; concepts sharing a text give one match each."""
        if self._pattern is None:
            return ()
        folded_chars: list[str] = []
        owner: list[int] = []  # folded offset -> index of the original character it came from
        for index, char in enumerate(text):
            folded = char.casefold()
            folded_chars.append(folded)
            owner.extend([index] * len(folded))
        return tuple(
            TermMatch(term, owner[m.start()], owner[m.end() - 1] + 1)
            for m in self._pattern.finditer("".join(folded_chars))
            for term in self._by_text[m.group()]
        )
