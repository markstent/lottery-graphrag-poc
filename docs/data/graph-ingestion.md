# Graph Ingestion

Neo4j operates as a semantic overlay (ADR-001): the Parquet/DuckDB layer stays
authoritative for transactional facts and amounts, while the graph holds
entities, relationships, ontology bindings and provenance.

## Stages

1. read approved source entities (`app/graph/reader.py`)
2. map to graph rows with provenance (`app/graph/node_rows.py`, `app/graph/relationship_rows.py`, `app/graph/mapping.py`)
3. apply constraints and indexes (`app/graph/statements.py`)
4. create/update graph nodes (MERGE on `id`)
5. create typed relationships
6. bind ontology concepts (`MAPS_TO` from every bound local code, `IS_A` between concepts)
7. calculate allowed derived relationships (methods named on every edge)
8. verify database counts and publish the ingestion version
9. write `_graph_stats.json` beside the dataset (CLI only)

Ingestion is idempotent for the same dataset version. After every run the
pipeline counts every node label and relationship triple in the database and
fails hard if the database does not exactly hold the mapped rows.
Relationship expectations are the number of distinct `(a_id, b_id)` pairs per
`(type, from label, to label)` key, because MERGE collapses rows that share
endpoints.

Row building is linear in the number of source rows: relationship rows
accumulate per key with `setdefault(key, []).append(row)`.

`_graph_stats.json` records what one run pushed:

```json
{
  "ingestion_version": "ing-20261018T120000Z",
  "label_version": "v2",
  "ontology_version": "2.0.0",
  "nodes": {"Game": 20},
  "relationships": [{"type": "PLAYS", "from": "Player", "to": "Game", "count": 1234}]
}
```

## Operation

```bash
make services-up        # Neo4j (and Qdrant) via docker compose
make generate-dev-data  # regenerate data/generated/dev-seed2026/
make ingest-graph       # ingest the development dataset (--wipe by default)
```

Direct CLI: `uv run python -m app.graph [--dataset DIR] [--wipe]` from `backend/`.
Connection settings come from the environment (`NEO4J_URI`, `NEO4J_USER`,
`NEO4J_PASSWORD`, `NEO4J_DATABASE`; see `.env.example`).

## Graph vs source-layer boundary

| In Neo4j | Stays in the structured layer |
|---|---|
| Market, Region, Language, Currency, Channel, Supplier | reference data used for traversal |
| Game, GameFamily, GameCategory, GameMechanic, Draw, PrizeType | product catalogue and draw schedule |
| IncidentType, SupportCategory, PlayerSegment | market-local taxonomies (one node per local code) |
| Platform, PlatformVersion, AppVersion | release history |
| Player, Device, PaymentMethod, PaymentProvider | player entities (dev profile) |
| Campaign, Experiment, Incident, SupportCase | commercial and operational entities |
| Document, DocumentChunk, BusinessConcept | knowledge layer |
| - | **Ticket, Prize, Session, Exposure, kpi_daily rows** |

High-volume transactional facts are never copied into the graph
(docs/02-graph-schema-spec.md section 8). They appear only as aggregated
relationship properties that point back to the source layer:

- `(:Player)-[:PLAYS {ticket_count, last_purchase_at, method}]->(:Game)`
- `(:Player)-[:EXPOSED_TO {exposure_count, engaged_count, method}]->(:Campaign)`

Amounts such as ticket price and jackpot are convenience floats on graph
nodes; the authoritative decimals live in Parquet.

## Provenance

Every node carries (docs/02 section 4, docs/data/provenance-model.md):

```text
id, label_version, source_system, source_table, source_record_id, ingestion_version
```

Where the source table records when an entity came into being, the node also
carries `source_timestamp`, taken from the first present column of
`created_at`, `started_at`, `opened_at`, `released_at`, `registration_date`,
`first_seen_at`, `start_at`.

Time-bounded entities carry a validity window (`valid_to` is omitted while
the entity is still current):

| Label | `valid_from` | `valid_to` |
|---|---|---|
| Game | `launch_date` | `retirement_date` |
| PlatformVersion | `released_at` | `retired_at` |
| AppVersion | `released_at` | - |
| Incident | `started_at` | `resolved_at` |
| Campaign, Experiment | `start_at` | `end_at` |
| Document | `valid_from` | `valid_to` |

`HAS_MECHANIC` edges carry the mapping's own `valid_from` / `valid_to`.
The label version is `v2` (`app/config/__init__.py`).

Every derived relationship names its method, for example
`SIMILAR_TO {score, method: "ontology_similarity_v2", ontology_version}`,
`TARGETS {share, method: "exposure_engagement_v1"}`,
`RUNS_ON {method: "operational_dependency_v1"}`.

## Derived relationships

| Relationship | Derivation |
|---|---|
| `SIMILAR_TO` | cross-market similarity scored on ontology concepts (`app/ontology/similarity.py`) |
| `MAPS_TO` | ontology bindings for all seven binding kinds (family, category, mechanic, incident type, support category, segment, channel) |
| `IS_A` | ontology concept hierarchy |
| `RUNS_ON` | operational dependency from digital/retail catalogue flags |
| `AVAILABLE_VIA` | channel flags |
| `PLAYS`, `EXPOSED_TO` | aggregation over source facts (identified, non-void tickets; all exposures) |
| `TARGETS` | most-engaged behavioural segment per campaign (share of engaged exposures) |
| `REFERENCES` | stable entity ids parsed from document titles/bodies (capped at 5 per document) |

## Cypher organisation

All Cypher lives in `backend/app/graph/statements.py` and the bundled
`backend/app/graph/cypher/*.cypher` example queries. Statements are static
and parameterised; labels and relationship types come from fixed registries.
Never interpolate user text into Cypher.

## Testing

- `tests/test_graph_mapping.py` - derivation functions and row builders (no I/O): validity windows, source timestamps, every relationship endpoint has a node, linear-time relationship building.
- `tests/test_graph_statements.py` - statement shapes, registries, bounded examples.
- `tests/test_graph_ingestion.py` - live Neo4j: constraints, node counts,
  provenance properties, idempotency, bounded traversals. Opt-in because the
  tests wipe the database: run `GRAPH_E2E=1 make test-graph` (or set
  `GRAPH_E2E=1` for pytest) with Neo4j running. CI runs them against a fresh
  Neo4j service container.

## Failure modes

- Neo4j unreachable: CLI exits non-zero with the driver error.
- Dataset table missing: `FileNotFoundError` before anything is written.
- Verification mismatch (e.g. a mapping bug): `RuntimeError` after writing;
  re-run with `--wipe` after fixing. No partial state is reported as success.
