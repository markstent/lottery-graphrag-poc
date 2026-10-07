"""Centralised Cypher for the Neo4j overlay.

All Cypher lives here (docs/02-graph-schema-spec.md section 11; AGENTS.md
"Centralise Cypher"). Statements are static strings driven by parameters;
labels and relationship types come only from the fixed registries below,
never from user input.

Node and relationship statements follow one shape each:

    UNWIND $rows AS row
    MERGE (n:Label {id: row.id})
    SET n += row, n.label_version = $label_version, n.ingestion_version = $ingestion_version

Rows carry their own ``source_system`` / ``source_record_id`` provenance so
every node satisfies docs/02 section 4.
"""

from __future__ import annotations

from importlib import resources

# ------------------------------------------------------------------ registry

NODE_LABELS: tuple[str, ...] = (
    "Market",
    "Region",
    "Language",
    "Currency",
    "Channel",
    "Supplier",
    "Platform",
    "PlatformVersion",
    "AppVersion",
    "GameFamily",
    "GameCategory",
    "GameMechanic",
    "Game",
    "Draw",
    "PrizeType",
    "PlayerSegment",
    "Player",
    "Device",
    "PaymentMethod",
    "Campaign",
    "Experiment",
    "Incident",
    "SupportCase",
    "Document",
    "DocumentChunk",
    "BusinessConcept",
)

RELATIONSHIP_TYPES: tuple[str, ...] = (
    "AFFECTS",
    "AFFECTS_MARKET",
    "AVAILABLE_IN",
    "AVAILABLE_VIA",
    "BELONGS_TO",
    "CONCERNS",
    "DEPLOYED_TO",
    "EXPOSED_TO",
    "FROM_MARKET",
    "HAS_CHUNK",
    "HAS_DRAW",
    "HAS_MECHANIC",
    "INSTANCE_OF",
    "MAPS_TO",
    "PLAYS",
    "PROMOTES",
    "REFERENCES",
    "RELATED_TO",
    "RELATED_TO_VERSION",
    "RELATED_TO_APP_VERSION",
    "RUNS_ON",
    "SIMILAR_TO",
    "TARGETS",
    "USES",
    "USES_PAYMENT",
    "VERSION_OF",
)

# Document references point at several target labels; one statement each.
DOCUMENT_REFERENCE_LABELS: tuple[str, ...] = (
    "Game",
    "Incident",
    "Campaign",
    "AppVersion",
    "Experiment",
)

_SCHEMA_STATEMENTS: tuple[str, ...] = (
    *(
        f"CREATE CONSTRAINT {label.lower()}_id IF NOT EXISTS "
        f"FOR (n:{label}) REQUIRE n.id IS UNIQUE;"
        for label in NODE_LABELS
    ),
    "CREATE INDEX market_code IF NOT EXISTS FOR (n:Market) ON (n.market_code);",
    "CREATE INDEX game_name IF NOT EXISTS FOR (n:Game) ON (n.name);",
    "CREATE INDEX concept_type IF NOT EXISTS FOR (n:BusinessConcept) ON (n.concept_type);",
    *(
        f"CREATE INDEX {label.lower()}_src IF NOT EXISTS FOR (n:{label}) ON (n.source_record_id);"
        for label in ("Game", "Player", "Document", "Incident")
    ),
)

_NODE_STATEMENT = """
UNWIND $rows AS row
MERGE (n:{label} {{id: row.id}})
SET n += row,
    n.label_version = $label_version,
    n.ingestion_version = $ingestion_version
"""

_RELATIONSHIP_STATEMENT = """
UNWIND $rows AS row
MATCH (a:{label_a} {{id: row.a_id}})
MATCH (b:{label_b} {{id: row.b_id}})
MERGE (a)-[r:{rel_type}]->(b)
SET r += row.props
"""


def node_statement(label: str) -> str:
    """MERGE statement for one node label."""
    if label not in NODE_LABELS:
        raise KeyError(f"unknown node label: {label}")
    return _NODE_STATEMENT.format(label=label)


def relationship_statement(rel_type: str, label_a: str, label_b: str) -> str:
    """MERGE statement for one relationship type between two fixed labels."""
    if rel_type not in RELATIONSHIP_TYPES:
        raise KeyError(f"unknown relationship type: {rel_type}")
    return _RELATIONSHIP_STATEMENT.format(rel_type=rel_type, label_a=label_a, label_b=label_b)


def schema_statements() -> list[str]:
    """Constraints and indexes (docs/02-graph-schema-spec.md section 10)."""
    return list(_SCHEMA_STATEMENTS)


def example_query(name: str) -> str:
    """Load an example Cypher query from the bundled cypher/ directory."""
    resource = resources.files("app.graph").joinpath(f"cypher/{name}.cypher")
    return resource.read_text(encoding="utf-8")
