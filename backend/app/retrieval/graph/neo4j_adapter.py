"""Neo4j adapters for graph retrieval.

Thin read-side wrappers over the centralised statements
(app.graph.statements). No Cypher lives here: neighbours, node lookups,
and market aliases all run the shared static statements.
"""

from __future__ import annotations

from typing import Any

from app.config import GraphConfig
from app.datasets.taxonomies import local_name_variants
from app.graph import statements
from app.ontology.model import Ontology
from app.ontology.terms import TermMatcher
from app.retrieval.graph.resolution import IdEntityResolver, TermEntityResolver
from app.retrieval.graph.traversal import NeighbourEdge


class GraphReader:
    """Read access used by retrieval; one session per call, small results."""

    def __init__(self, config: GraphConfig) -> None:
        from neo4j import GraphDatabase  # imported lazily: heavy import

        self._driver: Any = GraphDatabase.driver(
            config.uri, auth=(config.user, config.password), connection_timeout=config.timeout_s
        )
        self._database = config.database
        self._timeout_s = config.timeout_s

    def _records(self, statement: str, params: dict[str, Any]) -> list[Any]:
        """Run one statement under the configured transaction timeout."""
        from neo4j import Query

        result = self._driver.execute_query(
            Query(statement, timeout=self._timeout_s), params, database_=self._database
        )
        return list(result.records)

    def ping(self) -> None:
        """Run the trivial statement once, without the driver's retries, so
        an unreachable database fails within the configured timeout."""
        from neo4j import Query

        with self._driver.session(database=self._database) as session:
            session.run(Query(statements.PING, timeout=self._timeout_s)).consume()

    def edge_summary(self, label: str, node_id: str) -> list[tuple[str, str, int]]:
        """(relationship type, direction, count) of every relationship
        meeting one node. Like ``ping`` it runs once, without the driver's
        retries, so an unreachable database fails within the timeout."""
        from neo4j import Query

        query = Query(statements.record_edge_summary_statement(label), timeout=self._timeout_s)
        params = {"id": node_id, "limit": statements.RECORD_EDGE_SUMMARY_LIMIT}
        with self._driver.session(database=self._database) as session:
            records = list(session.run(query, params))
        return [
            (str(record["rel_type"]), str(record["direction"]), int(record["count"]))
            for record in records
        ]

    def close(self) -> None:
        self._driver.close()

    def __enter__(self) -> GraphReader:
        return self

    def __exit__(self, *exc_info: object) -> None:
        self.close()

    def lookup_node(self, node_id: str) -> tuple[str, bool] | None:
        """(label, exists) for an id, or None when the id is unknown."""
        records = self._records(statements.RETRIEVAL_NODE, {"id": node_id})
        if not records:
            return None
        return str(records[0]["node_label"]), True

    def neighbours(
        self,
        ids: list[str],
        rel_types: tuple[str, ...],
        per_type: int,
        excluded_labels: tuple[str, ...],
    ) -> list[NeighbourEdge]:
        """Edges from the given ids after per-type caps; excluded target
        labels are dropped before the cap.

        The statement carries its own hard safety LIMIT; the hop-level and
        total caps are applied by the traversal, which orders edges by
        relationship strength so the cut is never alphabetical.
        """
        records = self._records(
            statements.RETRIEVAL_NEIGHBOURS,
            {
                "ids": ids,
                "rel_types": list(rel_types),
                "per_type": per_type,
                "excluded_labels": list(excluded_labels),
            },
        )
        return [
            NeighbourEdge(
                from_id=str(record["from_id"]),
                rel_type=str(record["rel_type"]),
                to_id=str(record["to_id"]),
                to_label=str(record["to_label"]),
            )
            for record in records
        ]

    def concept_bound(
        self, concept_id: str, limit: int, excluded_labels: tuple[str, ...]
    ) -> list[tuple[str, str]]:
        """Entities bound to a BusinessConcept via MAPS_TO (id, label)."""
        records = self._records(
            statements.RETRIEVAL_CONCEPT_BOUND,
            {"concept_id": concept_id, "limit": limit, "excluded_labels": list(excluded_labels)},
        )
        return [(str(record["entity_id"]), str(record["entity_label"])) for record in records]

    def markets(self) -> dict[str, str]:
        """Alias -> market id for the resolver."""
        records = self._records(statements.RETRIEVAL_MARKETS, {})
        aliases: dict[str, str] = {}
        for record in records:
            market_id = str(record["id"])
            for name in (record["name"], record["market_code"]):
                if name:
                    aliases[str(name)] = market_id
        return aliases


def build_resolvers(
    reader: GraphReader, ontology: Ontology, matcher: TermMatcher
) -> tuple[IdEntityResolver, TermEntityResolver]:
    """Pipeline B's id resolver and pipeline C's term resolver over the live graph.

    The term resolver wraps the id resolver, so ids and market names resolve
    identically in both pipelines; C adds the ontology terms and the codes
    they bind to. The matcher is built once by the lab.
    """
    ids = IdEntityResolver(lookup_node=reader.lookup_node, market_aliases=reader.markets())
    terms = TermEntityResolver(
        inner=ids,
        matcher=matcher,
        bindings=ontology,
        local_names=local_name_variants(),
    )
    return ids, terms
