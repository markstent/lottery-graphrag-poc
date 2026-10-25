"""Idempotent ingestion from a generated dataset into the Neo4j overlay.

Pipeline (docs/reference/data/graph-ingestion.md): read source tables, map to graph
rows with provenance (``node_rows``, ``relationship_rows``), apply schema,
merge nodes, merge typed relationships, verify counts. High-volume
transactional facts (tickets, prizes, sessions, raw exposures) stay in the
structured layer; the graph holds aggregated relationship properties that
reference them (docs/reference/02 section 8).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from neo4j import Driver, GraphDatabase
from neo4j import Session as Neo4jSession

from app.config import LABEL_VERSION, GraphConfig
from app.graph import mapping, statements
from app.graph.node_rows import NodeRows, build_node_rows
from app.graph.reader import load_dataset
from app.graph.relationship_rows import RelationshipKey, RelationshipRows, build_relationship_rows
from app.ontology.loader import load_ontology

BATCH_SIZE = 2_000
# Written beside the dataset by the ingestion CLI; the API reads it.
GRAPH_STATS_FILE = "_graph_stats.json"


@dataclass(slots=True)
class IngestStats:
    """Row counts pushed to the graph for one ingestion run."""

    ingestion_version: str
    label_version: str
    ontology_version: str
    nodes: dict[str, int] = field(default_factory=dict)
    relationships: list[tuple[str, str, str, int]] = field(default_factory=list)

    def to_json(self) -> dict[str, Any]:
        """Serialisable form persisted beside the dataset as ``_graph_stats.json``."""
        return {
            "ingestion_version": self.ingestion_version,
            "label_version": self.label_version,
            "ontology_version": self.ontology_version,
            "nodes": dict(sorted(self.nodes.items())),
            "relationships": [
                {"type": rel_type, "from": label_a, "to": label_b, "count": count}
                for rel_type, label_a, label_b, count in sorted(self.relationships)
            ],
        }


def expected_relationship_counts(rels: RelationshipRows) -> dict[RelationshipKey, int]:
    """Relationships the database should hold per key after MERGE.

    MERGE collapses rows that share endpoints, so the expectation is the
    number of distinct ``(a_id, b_id)`` pairs rather than the row count.
    """
    return {key: len({(row["a_id"], row["b_id"]) for row in rows}) for key, rows in rels.items()}


def _run_batched(
    session: Neo4jSession, query: str, rows: list[dict[str, Any]], **params: Any
) -> int:
    pushed = 0
    for start in range(0, len(rows), BATCH_SIZE):
        batch = rows[start : start + BATCH_SIZE]
        session.run(query, rows=batch, **params).consume()
        pushed += len(batch)
    return pushed


def _count(session: Neo4jSession, query: str, subject: str) -> int:
    record = session.run(query).single()
    if record is None:
        raise RuntimeError(f"ingestion verification query returned no record for {subject}")
    count: int = record["count"]
    return count


def _verify_counts(session: Neo4jSession, nodes: NodeRows, rels: RelationshipRows) -> None:
    """Verify the database actually holds every row we intended to merge.

    A parameter-key mismatch or a dangling endpoint would otherwise MERGE
    nothing and pass silently; this check turns that into a hard failure.
    """
    for label, rows in nodes.items():
        actual = _count(session, statements.label_count_statement(label), label)
        if actual != len(rows):
            raise RuntimeError(
                f"ingestion verification failed for nodes {label}: {actual} != {len(rows)}"
            )
    for (rel_type, label_a, label_b), expected in sorted(
        expected_relationship_counts(rels).items()
    ):
        subject = f"({label_a})-[:{rel_type}]->({label_b})"
        query = statements.relationship_count_statement(rel_type, label_a, label_b)
        actual = _count(session, query, subject)
        if actual != expected:
            raise RuntimeError(
                f"ingestion verification failed for {subject}: {actual} != {expected}"
            )


def ingest(
    dataset_dir: Path,
    config: GraphConfig,
    ingestion_version: str | None = None,
    wipe: bool = False,
) -> IngestStats:
    """Ingest one dataset into Neo4j. Safe to re-run for the same dataset."""
    tables = load_dataset(dataset_dir)
    ontology = load_ontology()
    nodes = build_node_rows(tables, ontology)
    rels = build_relationship_rows(tables, ontology)
    version = ingestion_version or mapping.ingestion_version_now()
    stats = IngestStats(
        ingestion_version=version,
        label_version=LABEL_VERSION,
        ontology_version=ontology.version,
    )

    driver: Driver = GraphDatabase.driver(
        config.uri, auth=(config.user, config.password), connection_timeout=config.timeout_s
    )
    try:
        driver.verify_connectivity()
        with driver.session(database=config.database) as session:
            if wipe:
                session.run(statements.WIPE).consume()
            for statement in statements.schema_statements():
                session.run(statement).consume()
            for label in statements.NODE_LABELS:
                if label in nodes:
                    stats.nodes[label] = _run_batched(
                        session,
                        statements.node_statement(label),
                        nodes[label],
                        label_version=LABEL_VERSION,
                        ingestion_version=version,
                    )
            for (rel_type, label_a, label_b), rows in sorted(rels.items()):
                pushed = _run_batched(
                    session, statements.relationship_statement(rel_type, label_a, label_b), rows
                )
                stats.relationships.append((rel_type, label_a, label_b, pushed))
            _verify_counts(session, nodes, rels)
    finally:
        driver.close()
    return stats
