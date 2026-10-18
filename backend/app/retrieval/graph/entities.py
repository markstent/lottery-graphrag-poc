"""Entity resolution for graph seeds (docs/08 Phase 9).

A deterministic dictionary resolver: exact graph ids appearing in the
question, market names, and whole ontology concept phrases (canonical name,
labels in every market language and synonyms).
No model call sits inside resolution, so seed selection is reproducible and
auditable. A model-based resolver can be added behind the same protocol
later without touching the pipeline.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

_ID_TOKEN = re.compile(r"\b[A-Z]{2,12}(?:_[A-Z0-9]+)+\b")

# Graph id prefixes that are safe seed candidates. Player-transaction ids are
# never seeds: traversal limits plus the relationship allow-list already keep
# retrieval away from transactional neighbours.
_SEED_PREFIXES = (
    "INC_",
    "MKT_",
    "PLV_",
    "PLT_",
    "GAME_",
    "DOC_",
    "APPV_",
    "CMP_",
    "CONCEPT_",
    "FAM_",
    "CHNK_",
    "PLAYER_",
    "PAY_",
)


@dataclass(frozen=True, slots=True)
class ResolvedEntity:
    """One question mention mapped to a graph node."""

    entity_id: str
    node_label: str
    matched_text: str
    origin: str  # "id" | "market_alias" | "concept"
    confidence: float


class EntityResolver(Protocol):
    def resolve(self, question: str) -> list[ResolvedEntity]:
        """Map question mentions to graph node ids (deduplicated, ordered)."""
        ...


class DictionaryEntityResolver:
    """Resolves ids, market aliases and ontology concept mentions.

    `lookup_node` returns (node_label, exists) for a candidate id or None;
    the Neo4j adapter backs it with one parameterised lookup. Concepts and
    market aliases are small immutable dictionaries loaded once.
    """

    def __init__(
        self,
        *,
        lookup_node: Callable[[str], tuple[str, bool] | None],
        market_aliases: dict[str, str],
        concepts: list[tuple[str, str, tuple[str, ...]]],  # (id, canonical_name, phrases)
    ) -> None:
        self._lookup_node = lookup_node
        self._market_aliases = {alias.lower(): node_id for alias, node_id in market_aliases.items()}
        # Concept match phrases: canonical name plus the given whole phrases,
        # lower-cased and deduplicated in order. Phrases are never split.
        self._concepts: list[tuple[str, list[str]]] = []
        for concept_id, canonical_name, phrases in concepts:
            unique = dict.fromkeys(
                phrase.lower() for phrase in (canonical_name, *phrases) if phrase.strip()
            )
            self._concepts.append((concept_id, list(unique)))

    def resolve(self, question: str) -> list[ResolvedEntity]:
        resolved: list[ResolvedEntity] = []
        seen: set[str] = set()
        lower = question.lower()

        for token in dict.fromkeys(_ID_TOKEN.findall(question)):
            if not token.startswith(_SEED_PREFIXES):
                continue
            found = self._lookup_node(token)
            if found is None:
                continue
            label, exists = found
            if not exists:
                continue
            resolved.append(
                ResolvedEntity(
                    entity_id=token,
                    node_label=label,
                    matched_text=token,
                    origin="id",
                    confidence=1.0,
                )
            )
            seen.add(token)

        for alias, node_id in self._market_aliases.items():
            if node_id in seen:
                continue
            if re.search(rf"\b{re.escape(alias)}\b", lower):
                resolved.append(
                    ResolvedEntity(
                        entity_id=node_id,
                        node_label="Market",
                        matched_text=alias,
                        origin="market_alias",
                        confidence=0.9,
                    )
                )
                seen.add(node_id)

        for concept_id, phrases in self._concepts:
            if concept_id in seen:
                continue
            matched = next(
                (phrase for phrase in phrases if re.search(rf"\b{re.escape(phrase)}\b", lower)),
                None,
            )
            if matched is None:
                continue
            resolved.append(
                ResolvedEntity(
                    entity_id=concept_id,
                    node_label="BusinessConcept",
                    matched_text=matched,
                    origin="concept",
                    confidence=0.7,
                )
            )
            seen.add(concept_id)

        return resolved


class StaticEntityResolver:
    """Pre-seeded resolver for tests and offline runs."""

    def __init__(self, entities: list[ResolvedEntity]) -> None:
        self._entities = entities

    def resolve(self, question: str) -> list[ResolvedEntity]:
        return list(self._entities)
