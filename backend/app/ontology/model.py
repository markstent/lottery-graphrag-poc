"""Immutable ontology model: concepts, local-code bindings and navigation."""

from __future__ import annotations

from dataclasses import dataclass, field

LANGUAGES: tuple[str, ...] = ("en", "el", "de", "cs")
BINDING_KINDS: frozenset[str] = frozenset(
    {"family", "category", "mechanic", "incident_type", "support_category", "segment", "channel"}
)


@dataclass(frozen=True, slots=True)
class Concept:
    """A canonical business concept with labels and synonyms in every market language."""

    concept_id: str
    parent_id: str | None
    concept_type: str
    labels: dict[str, str]
    synonyms: dict[str, tuple[str, ...]]
    definition: str


@dataclass(frozen=True, slots=True)
class Binding:
    """Maps one local reference code to a concept; `market_id` is None for shared codes."""

    kind: str
    code: str
    market_id: str | None
    concept_id: str


@dataclass(frozen=True)
class Ontology:
    """A validated concept hierarchy with its bindings, in source order."""

    version: str
    concepts: tuple[Concept, ...]
    bindings: tuple[Binding, ...]
    _by_id: dict[str, Concept] = field(init=False, repr=False, compare=False)
    _by_code: dict[tuple[str, str], str] = field(init=False, repr=False, compare=False)

    def __post_init__(self) -> None:
        object.__setattr__(self, "_by_id", {c.concept_id: c for c in self.concepts})
        object.__setattr__(
            self, "_by_code", {(b.kind, b.code): b.concept_id for b in self.bindings}
        )

    def concept(self, concept_id: str) -> Concept:
        """The concept with this id; raises KeyError when unknown."""
        return self._by_id[concept_id]

    def children(self, concept_id: str) -> tuple[Concept, ...]:
        """Direct children of a concept, in source order."""
        return tuple(c for c in self.concepts if c.parent_id == concept_id)

    def ancestors(self, concept_id: str) -> tuple[str, ...]:
        """Ancestor ids, nearest first, excluding the concept itself."""
        chain: list[str] = []
        parent = self.concept(concept_id).parent_id
        while parent is not None:
            chain.append(parent)
            parent = self.concept(parent).parent_id
        return tuple(chain)

    def concept_for(self, kind: str, code: str) -> str | None:
        """Concept id bound to a local code, or None when the code is unbound."""
        return self._by_code.get((kind, code))

    def codes_for(self, concept_id: str, kind: str | None = None) -> tuple[Binding, ...]:
        """Bindings to a concept, optionally restricted to one kind, in source order."""
        return tuple(
            b
            for b in self.bindings
            if b.concept_id == concept_id and (kind is None or b.kind == kind)
        )

    def roots(self) -> tuple[Concept, ...]:
        """Top-level concepts, in source order."""
        return tuple(c for c in self.concepts if c.parent_id is None)
