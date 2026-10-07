# Graph Ingestion

Neo4j operates as a semantic overlay (ADR-001): the Parquet/DuckDB layer stays
authoritative for transactional facts and amounts, while the graph holds
entities, relationships, ontology bindings and provenance.

## Stages

1. read approved source entities (`app/graph/reader.py`)
2. map to graph rows with provenance (`app/graph/ingest.py`, `app/graph/mapping.py`)
3. apply constraints and indexes (`app/graph/statements.py`)
4. create/update graph nodes (MERGE on `id`)
5. create typed relationships
6. bind ontology concepts (`MAPS_TO` / `INSTANCE_OF`)
7. calculate allowed derived relationships (methods named on every edge)
8. verify database counts and publish the ingestion version

Ingestion is idempotent for the same dataset version. After every run the
pipeline counts every node label and relationship type in the database and
fails hard if the database does not exactly hold the mapped rows.

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
| Platform, PlatformVersion, AppVersion | release history |
| PlayerSegment, Player, Device, PaymentMethod | player entities (dev profile) |
| Campaign, Experiment, Incident, SupportCase | commercial and operational entities |
| Document, DocumentChunk, BusinessConcept | knowledge layer |
| — | **Ticket, Prize, Session, Exposure, kpi_daily rows** |

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

Every derived relationship names its method, for example
`SIMILAR_TO {score, method: "ontology_family_mechanics_v1"}`,
`TARGETS {share, method: "exposure_engagement_v1"}`,
`RUNS_ON {method: "operational_dependency_v1"}`.

## Derived relationships

| Relationship | Derivation |
|---|---|
| `SIMILAR_TO` | cross-market structural similarity: family 0.4 + category 0.2 + mechanic overlap 0.4; top 3 per game |
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

- `tests/test_graph_mapping.py` — derivation functions (no I/O).
- `tests/test_graph_statements.py` — statement shapes, registries, bounded examples.
- `tests/test_graph_ingestion.py` — live Neo4j: constraints, node counts,
  provenance properties, idempotency, bounded traversals. Opt-in because the
  tests wipe the database: run `GRAPH_E2E=1 make test-graph` (or set
  `GRAPH_E2E=1` for pytest) with Neo4j running. CI runs them against a fresh
  Neo4j service container.

## Failure modes

- Neo4j unreachable: CLI exits non-zero with the driver error.
- Dataset table missing: `FileNotFoundError` before anything is written.
- Verification mismatch (e.g. a mapping bug): `RuntimeError` after writing;
  re-run with `--wipe` after fixing. No partial state is reported as success.
