"""Neo4j adapters for graph retrieval.

Thin read-side wrappers over the centralised statements
(app.graph.statements). No Cypher lives here: neighbours, node lookups,
market aliases and ontology concepts all run the shared static statements.
"""

from __future__ import annotations

from typing import Any

from app.graph import statements
from app.graph.config import GraphConfig
from app.retrieval.graph.entities import DictionaryEntityResolver, ResolvedEntity
from app.retrieval.graph.traversal import NeighbourEdge


class GraphReader:
    """Read access used by retrieval; one session per call, small results."""

    def __init__(self, config: GraphConfig) -> None:
        from neo4j import GraphDatabase  # imported lazily: heavy import

        self._driver: Any = GraphDatabase.driver(config.uri, auth=(config.user, config.password))
        self._database = config.database

    def close(self) -> None:
        self._driver.close()

    def __enter__(self) -> GraphReader:
        return self

    def __exit__(self, *exc_info: object) -> None:
        self.close()

    def lookup_node(self, node_id: str) -> tuple[str, bool] | None:
        """(label, exists) for an id, or None when the id is unknown."""
        records = self._driver.execute_query(
            statements.RETRIEVAL_NODE, {"id": node_id}, database_=self._database
        ).records
        if not records:
            return None
        return str(records[0]["node_label"]), True

    def neighbours(
        self,
        ids: list[str],
        rel_types: tuple[str, ...],
        per_type: int,
    ) -> list[NeighbourEdge]:
        """Edges from the given ids after per-type caps.

        The statement carries its own hard safety LIMIT; the hop-level and
        total caps are applied by the traversal, which orders edges by
        relationship strength so the cut is never alphabetical.
        """
        records = self._driver.execute_query(
            statements.RETRIEVAL_NEIGHBOURS,
            {"ids": ids, "rel_types": list(rel_types), "per_type": per_type},
            database_=self._database,
        ).records
        return [
            NeighbourEdge(
                from_id=str(record["from_id"]),
                rel_type=str(record["rel_type"]),
                to_id=str(record["to_id"]),
                to_label=str(record["to_label"]),
            )
            for record in records
        ]

    def concept_bound(self, concept_id: str, limit: int) -> list[tuple[str, str]]:
        """Entities bound to a BusinessConcept via MAPS_TO (id, label)."""
        records = self._driver.execute_query(
            statements.RETRIEVAL_CONCEPT_BOUND,
            {"concept_id": concept_id, "limit": limit},
            database_=self._database,
        ).records
        return [(str(record["entity_id"]), str(record["entity_label"])) for record in records]

    def markets(self) -> dict[str, str]:
        """Alias -> market id for the resolver."""
        records = self._driver.execute_query(
            statements.RETRIEVAL_MARKETS, {}, database_=self._database
        ).records
        aliases: dict[str, str] = {}
        for record in records:
            market_id = str(record["id"])
            for name in (record["name"], record["market_code"]):
                if name:
                    aliases[str(name)] = market_id
        return aliases

    def concepts(self) -> list[tuple[str, str, str]]:
        records = self._driver.execute_query(
            statements.RETRIEVAL_CONCEPTS, {}, database_=self._database
        ).records
        # The resolver's keyword text is the concept's other-language labels
        # plus its synonyms (stripped of their "<lang>:" prefix).
        return [
            (
                str(record["id"]),
                str(record["canonical_name"] or ""),
                " ".join(
                    [
                        *(str(record[f"labels_{lang}"] or "") for lang in ("el", "de", "cs")),
                        *(_synonym_text(str(entry)) for entry in record["synonyms"] or []),
                    ]
                ),
            )
            for record in records
        ]


def _synonym_text(entry: str) -> str:
    """Synonym text without its "<lang>:" prefix."""
    _lang, _sep, text = entry.partition(":")
    return text


def build_resolver(reader: GraphReader) -> DictionaryEntityResolver:
    """Dictionary resolver backed by the live graph."""
    return DictionaryEntityResolver(
        lookup_node=reader.lookup_node,
        market_aliases=reader.markets(),
        concepts=reader.concepts(),
    )


def resolved_ids(entities: list[ResolvedEntity]) -> list[str]:
    return [entity.entity_id for entity in entities]
