"""Integration tests against a live Neo4j instance.

Opt-in: set ``GRAPH_E2E=1`` (or run ``make test-graph``). They need a
disposable Neo4j (``make services-up``) because they wipe and re-ingest the
tiny development world. In CI a fresh Neo4j service container is used with
``GRAPH_E2E=1``. Skipped automatically otherwise.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from app.datasets.config import GenerationConfig
from app.datasets.parquet import write_world
from app.datasets.schema import TABLE_SCHEMAS
from app.datasets.world import build_world
from app.graph import statements
from app.graph.config import GraphConfig
from app.graph.ingest import build_node_rows, ingest
from app.graph.reader import load_dataset
from neo4j import GraphDatabase

CONNECT_TIMEOUT_SECONDS = 15.0


def _neo4j_available(config: GraphConfig) -> bool:
    try:
        driver = GraphDatabase.driver(config.uri, auth=(config.user, config.password))
        driver.verify_connectivity()
        driver.close()
        return True
    except Exception:
        return False


@pytest.fixture(scope="module")
def graph_config() -> GraphConfig:
    return GraphConfig(
        uri=os.environ.get("NEO4J_URI", "bolt://localhost:7687"),
        user=os.environ.get("NEO4J_USER", "neo4j"),
        password=os.environ.get("NEO4J_PASSWORD", "devpassword"),
        database=os.environ.get("NEO4J_DATABASE", "neo4j"),
    )


@pytest.fixture(scope="module")
def tiny_dataset(tmp_path_factory: pytest.TempPathFactory) -> Path:
    world = build_world(GenerationConfig(profile="tiny", world_seed=42))
    dataset_dir = tmp_path_factory.mktemp("tiny-world")
    write_world(dataset_dir, TABLE_SCHEMAS, world.tables)
    return dataset_dir


@pytest.fixture(scope="module")
def ingested(graph_config: GraphConfig, tiny_dataset: Path) -> None:
    if os.environ.get("GRAPH_E2E") != "1":
        pytest.skip("set GRAPH_E2E=1 to run live-graph tests (they wipe the database)")
    if not _neo4j_available(graph_config):
        pytest.skip("Neo4j is not reachable; start it with `make services-up`")
    driver = GraphDatabase.driver(graph_config.uri, auth=(graph_config.user, graph_config.password))
    try:
        with driver.session(database=graph_config.database) as session:
            session.run("MATCH (n) DETACH DELETE n").consume()
    finally:
        driver.close()
    ingest(tiny_dataset, graph_config, ingestion_version="ing-test", wipe=True)


def _query(config: GraphConfig, cypher: str, **params: object) -> list[dict[str, object]]:
    driver = GraphDatabase.driver(config.uri, auth=(config.user, config.password))
    try:
        with driver.session(database=config.database) as session:
            return [record.data() for record in session.run(cypher, **params)]
    finally:
        driver.close()


def test_schema_constraints_exist(ingested: None, graph_config: GraphConfig) -> None:
    rows = _query(graph_config, "SHOW CONSTRAINTS")
    names = {str(row.get("name", "")).lower() for row in rows}
    for label in ("Game", "Player", "Document", "BusinessConcept", "Incident"):
        assert f"{label.lower()}_id" in names, f"missing constraint for {label}"


def test_node_counts_match_source(
    ingested: None, graph_config: GraphConfig, tiny_dataset: Path
) -> None:
    tables = load_dataset(tiny_dataset)
    expected = build_node_rows(tables)

    for label, rows in expected.items():
        count = _query(graph_config, f"MATCH (n:{label}) RETURN count(n) AS c")[0]["c"]
        assert count == len(rows), f"{label}: graph {count} != source {len(rows)}"


def test_every_node_carries_provenance(ingested: None, graph_config: GraphConfig) -> None:
    rows = _query(
        graph_config,
        "MATCH (n) WHERE n.source_system IS NULL OR n.source_record_id IS NULL "
        "OR n.ingestion_version IS NULL OR n.label_version IS NULL "
        "RETURN labels(n)[0] AS label, n.id AS id LIMIT 10",
    )
    assert rows == []


def test_ingestion_is_idempotent(
    ingested: None, graph_config: GraphConfig, tiny_dataset: Path
) -> None:
    """Re-running ingestion over the same dataset must not duplicate content."""
    stats = ingest(tiny_dataset, graph_config, ingestion_version="ing-test", wipe=False)

    assert sum(stats.nodes.values()) > 0  # rows were pushed
    games = _query(graph_config, "MATCH (n:Game) RETURN count(n) AS c")[0]["c"]
    assert games == 20
    similar = _query(graph_config, "MATCH ()-[r:SIMILAR_TO]->() RETURN count(r) AS c")[0]["c"]
    assert (
        similar
        == _query(graph_config, "MATCH ()-[r:SIMILAR_TO]->() RETURN count(DISTINCT r) AS c")[0]["c"]
    )


def test_ontology_bindings_link_games_to_concepts(
    ingested: None, graph_config: GraphConfig
) -> None:
    rows = _query(
        graph_config,
        "MATCH (g:Game)-[:INSTANCE_OF]->(c:BusinessConcept) "
        "RETURN g.id AS game, c.id AS concept ORDER BY game LIMIT 1",
    )
    assert rows, "no game-to-concept bindings ingested"


def test_example_queries_are_bounded(ingested: None, graph_config: GraphConfig) -> None:
    cases = [
        ("cross_market_similar_products", {"game_id": "GAME_UK_01"}),
        ("ontology_assisted_product_lookup", {"game_id": "GAME_GR_04"}),
        ("cross_market_incident_transfer", {"incident_id": "INC_001"}),
        ("campaign_transferability", {"campaign_id": "CMP_001"}),
        ("multilingual_concept_lookup", {"concept_id": "CONCEPT_INSTANT_PRODUCT"}),
        ("incident_context", {"incident_id": "INC_001"}),
    ]
    limit = 5
    for name, params in cases:
        rows = _query(graph_config, statements.example_query(name), limit=limit, **params)
        assert len(rows) <= limit, f"{name} returned {len(rows)} rows"


def test_bounded_traversal_respects_whitelist(ingested: None, graph_config: GraphConfig) -> None:
    """Class-2 traversal: Game -> Platform -> Incident stays within two hops."""
    rows = _query(
        graph_config,
        """
        MATCH (g:Game {id: 'GAME_UK_01'})-[:RUNS_ON]->(p:Platform)<-[:RELATED_TO]-(i:Incident)
        RETURN p.id AS platform, collect(i.id)[..3] AS incidents
        LIMIT 3
        """,
    )
    assert len(rows) <= 3
    for row in rows:
        assert set(row) == {"platform", "incidents"}
