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
    "PaymentProvider",
    "Campaign",
    "Experiment",
    "Incident",
    "IncidentType",
    "SupportCase",
    "SupportCategory",
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
    "CATEGORISED_AS",
    "CONCERNS",
    "DEPLOYED_TO",
    "EXPOSED_TO",
    "FROM_MARKET",
    "HAS_CHUNK",
    "HAS_DRAW",
    "HAS_MECHANIC",
    "INSTANCE_OF",
    "IS_A",
    "MAPS_TO",
    "OF_TYPE",
    "PLAYS",
    "PROMOTES",
    "PROVIDED_BY",
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

# Edges that exist only because of the enterprise ontology. Configuration B
# (graph relationships) excludes them; configuration C adds them.
ONTOLOGY_RELATIONSHIP_TYPES: tuple[str, ...] = ("MAPS_TO", "SIMILAR_TO", "IS_A")

# Every (relationship type, from label, to label) ingestion builds
# (app.graph.relationship_rows); tests/test_api_graph_model.py keeps the two
# in step. The graph schema route serves it.
RELATIONSHIP_ENDPOINTS: tuple[tuple[str, str, str], ...] = (
    ("AFFECTS", "Incident", "Game"),
    ("AFFECTS_MARKET", "Incident", "Market"),
    ("AVAILABLE_IN", "Game", "Market"),
    ("AVAILABLE_VIA", "Game", "Channel"),
    ("BELONGS_TO", "Game", "GameFamily"),
    ("BELONGS_TO", "Player", "PlayerSegment"),
    ("CATEGORISED_AS", "SupportCase", "SupportCategory"),
    ("CONCERNS", "SupportCase", "Game"),
    ("DEPLOYED_TO", "AppVersion", "Market"),
    ("EXPOSED_TO", "Player", "Campaign"),
    ("FROM_MARKET", "Document", "Market"),
    ("FROM_MARKET", "SupportCase", "Market"),
    ("HAS_CHUNK", "Document", "DocumentChunk"),
    ("HAS_DRAW", "Game", "Draw"),
    ("HAS_MECHANIC", "Game", "GameMechanic"),
    ("INSTANCE_OF", "Game", "GameCategory"),
    ("IS_A", "BusinessConcept", "BusinessConcept"),
    ("MAPS_TO", "Channel", "BusinessConcept"),
    ("MAPS_TO", "GameCategory", "BusinessConcept"),
    ("MAPS_TO", "GameFamily", "BusinessConcept"),
    ("MAPS_TO", "GameMechanic", "BusinessConcept"),
    ("MAPS_TO", "IncidentType", "BusinessConcept"),
    ("MAPS_TO", "PlayerSegment", "BusinessConcept"),
    ("MAPS_TO", "SupportCategory", "BusinessConcept"),
    ("OF_TYPE", "Incident", "IncidentType"),
    ("PLAYS", "Player", "Game"),
    ("PROMOTES", "Campaign", "Game"),
    ("PROVIDED_BY", "PaymentMethod", "PaymentProvider"),
    ("REFERENCES", "Document", "AppVersion"),
    ("REFERENCES", "Document", "Campaign"),
    ("REFERENCES", "Document", "Experiment"),
    ("REFERENCES", "Document", "Game"),
    ("REFERENCES", "Document", "Incident"),
    ("RELATED_TO", "Incident", "Platform"),
    ("RELATED_TO", "SupportCase", "Incident"),
    ("RELATED_TO_APP_VERSION", "Incident", "AppVersion"),
    ("RELATED_TO_VERSION", "Incident", "PlatformVersion"),
    ("RUNS_ON", "Game", "Platform"),
    ("SIMILAR_TO", "Game", "Game"),
    ("TARGETS", "Campaign", "PlayerSegment"),
    ("TARGETS", "Experiment", "PlayerSegment"),
    ("USES", "Player", "Device"),
    ("USES_PAYMENT", "Player", "PaymentMethod"),
    ("VERSION_OF", "PlatformVersion", "Platform"),
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
    "CREATE INDEX concept_parent IF NOT EXISTS FOR (n:BusinessConcept) ON (n.parent_id);",
    *(
        f"CREATE INDEX {label.lower()}_market IF NOT EXISTS FOR (n:{label}) ON (n.market_id);"
        for label in ("IncidentType", "SupportCategory", "PlayerSegment")
    ),
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
    _require_label(label)
    return _NODE_STATEMENT.format(label=label)


def relationship_statement(rel_type: str, label_a: str, label_b: str) -> str:
    """MERGE statement for one relationship type between two fixed labels."""
    _require_relationship_type(rel_type)
    _require_label(label_a)
    _require_label(label_b)
    return _RELATIONSHIP_STATEMENT.format(rel_type=rel_type, label_a=label_a, label_b=label_b)


WIPE = "MATCH (n) DETACH DELETE n"

_LABEL_COUNT_STATEMENT = "MATCH (n:{label}) RETURN count(n) AS count"
_RELATIONSHIP_COUNT_STATEMENT = (
    "MATCH (:{label_a})-[r:{rel_type}]->(:{label_b}) RETURN count(r) AS count"
)


def _require_label(label: str) -> None:
    if label not in NODE_LABELS:
        raise KeyError(f"unknown node label: {label}")


def _require_relationship_type(rel_type: str) -> None:
    if rel_type not in RELATIONSHIP_TYPES:
        raise KeyError(f"unknown relationship type: {rel_type}")


def label_count_statement(label: str) -> str:
    """Node count for one registered label.

    Schema statistics are one statement per label (and per relationship
    triple below): Community Edition without APOC cannot count dynamic labels
    in a single statement.
    """
    _require_label(label)
    return _LABEL_COUNT_STATEMENT.format(label=label)


def relationship_count_statement(rel_type: str, label_a: str, label_b: str) -> str:
    """Relationship count for one registered type between two registered labels."""
    _require_relationship_type(rel_type)
    _require_label(label_a)
    _require_label(label_b)
    return _RELATIONSHIP_COUNT_STATEMENT.format(rel_type=rel_type, label_a=label_a, label_b=label_b)


def schema_statements() -> list[str]:
    """Constraints and indexes (docs/02-graph-schema-spec.md section 10)."""
    return list(_SCHEMA_STATEMENTS)


def example_query(name: str) -> str:
    """Load an example Cypher query from the bundled cypher/ directory."""
    resource = resources.files("app.graph").joinpath(f"cypher/{name}.cypher")
    return resource.read_text(encoding="utf-8")


# --------------------------------------------------- retrieval (Phase 9)
# Read-side queries for graph retrieval. Static strings, parameter-driven;
# relationship types and limits always come from configured values, never
# from user input. Traversal is per-hop so the pipeline can emit one
# telemetry event per traversed edge (docs/07 section 8).

RETRIEVAL_NEIGHBOURS = """
UNWIND $ids AS fid
CALL (fid) {
  MATCH (a {id: fid})-[r]-(b)
  WHERE type(r) IN $rel_types AND coalesce(b.id, '') <> fid
    AND NOT labels(b)[0] IN $excluded_labels
  WITH type(r) AS rel_type, b.id AS to_id, labels(b)[0] AS to_label
  ORDER BY rel_type, to_id
  WITH rel_type, collect({to_id: to_id, to_label: to_label}) AS items
  WITH rel_type, items[.. $per_type] AS trimmed
  UNWIND trimmed AS item
  RETURN item.to_id AS to_id, item.to_label AS to_label, rel_type
}
RETURN fid AS from_id, rel_type, to_id, to_label
ORDER BY from_id, to_id
LIMIT 5000
"""

RETRIEVAL_CONCEPT_BOUND = """
MATCH (e)-[:MAPS_TO]->(c {id: $concept_id})
WHERE NOT labels(e)[0] IN $excluded_labels
RETURN e.id AS entity_id, labels(e)[0] AS entity_label
ORDER BY entity_id
LIMIT $limit
"""

# Readiness: the database answers a trivial query.
PING = "RETURN 1 AS ok"

RETRIEVAL_NODE = """
MATCH (n {id: $id})
RETURN labels(n)[0] AS node_label, properties(n) AS props
"""

RETRIEVAL_MARKETS = """
MATCH (m:Market)
RETURN m.id AS id, m.name AS name, m.market_code AS market_code
ORDER BY id
"""

# ------------------------------------------------------------ record reads

# Relationships meeting one record node, counted per type and direction
# (Data Model record view). The label comes from the fixed registry, so the
# lookup uses the label's id constraint; the LIMIT bounds the result to every
# registered type in both directions.
_RECORD_EDGE_SUMMARY = """
MATCH (n:{label} {{id: $id}})-[r]-()
WITH type(r) AS rel_type,
     CASE WHEN startNode(r) = n THEN 'out' ELSE 'in' END AS direction,
     count(r) AS count
RETURN rel_type, direction, count
ORDER BY rel_type, direction
LIMIT $limit
"""
RECORD_EDGE_SUMMARY_LIMIT = 2 * len(RELATIONSHIP_TYPES)


def record_edge_summary_statement(label: str) -> str:
    """Per-type, per-direction relationship counts of one node of a registered label."""
    _require_label(label)
    return _RECORD_EDGE_SUMMARY.format(label=label)


# ------------------------------------------------------------ graph explorer reads

# Live node count of every registered label in one statement: each branch is
# a count-store lookup, so it costs the same on any world size. Compared with
# a dataset's _graph_stats.json to tell which world the graph holds.
LABEL_COUNTS = "\nUNION ALL\n".join(
    f"MATCH (n:{label}) RETURN '{label}' AS label, count(n) AS count" for label in NODE_LABELS
)

# One node by id. Ingestion gives every node an id unique across labels; the
# LIMIT of 2 lets the caller refuse an id that is not.
GRAPH_NODE = """
MATCH (n {id: $id})
RETURN labels(n) AS labels, properties(n) AS props
LIMIT 2
"""

# The relationships meeting one node, optionally of one type ($rel_type null
# for every type), in a stable order and cut at $limit. The caller asks for
# one more than it shows to learn whether the list was cut.
GRAPH_NEIGHBOURS = """
MATCH (n {id: $id})-[r]-(m)
WHERE $rel_type IS NULL OR type(r) = $rel_type
WITH type(r) AS rel_type,
     CASE WHEN startNode(r) = n THEN 'out' ELSE 'in' END AS direction,
     m
RETURN rel_type, direction, labels(m) AS labels, properties(m) AS props
ORDER BY rel_type, direction, m.id
LIMIT $limit
"""


# ------------------------------------------------------------ ontology reads

ONTOLOGY_TREE = """
MATCH (c:BusinessConcept)
RETURN c.id AS id,
       c.parent_id AS parent_id,
       c.concept_type AS concept_type,
       c.canonical_name AS canonical_name,
       c.label_en AS label_en,
       c.label_el AS label_el,
       c.label_de AS label_de,
       c.label_cs AS label_cs,
       c.synonyms AS synonyms,
       c.definition AS definition
ORDER BY id
"""

ONTOLOGY_BINDING_COUNTS = """
MATCH (e)-[:MAPS_TO]->(c:BusinessConcept)
RETURN c.id AS concept_id,
       labels(e)[0] AS entity_label,
       e.market_id AS market_id,
       count(e) AS count
ORDER BY concept_id, entity_label, market_id
"""
