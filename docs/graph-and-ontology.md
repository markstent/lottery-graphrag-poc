# Graph and ontology

This page describes the Neo4j overlay, how the synthetic world is loaded into it, and the enterprise ontology that connects the four markets' vocabularies.
The source tables are in [data.md](data.md).
How pipelines B and C walk the graph is in [retrieval.md](retrieval.md).

## Purpose

The graph is an augmentation layer above the source tables.
It does not copy the warehouse.
It holds:

- entities that matter for navigation (games, incidents, platform versions, campaigns, segments, documents and others);
- the relationships between them;
- the ontology: canonical business concepts and the mappings from each market's local codes to those concepts;
- a reference from every node back to its source row.

Authoritative quantities stay in the Parquet tables.
High-volume transactional facts (tickets, prizes, sessions, raw campaign exposures, daily KPIs) are never copied into the graph.
They appear only as aggregated properties on a relationship that point back to the source layer, such as the ticket count on `(:Player)-[:PLAYS]->(:Game)`.
Amounts such as a ticket price on a graph node are convenience copies.

The ontology exists to be measured on its own.
Pipeline B has the graph without it, and pipeline C has the graph with it, so the difference between B and C is the value of the ontology.

## Architecture

### Graph model

The model has 29 node labels and 30 relationship types.
The code registry is `backend/app/graph/statements.py` (`NODE_LABELS`, `RELATIONSHIP_TYPES`, `RELATIONSHIP_ENDPOINTS`), and the Data Model screen reads it live.
The label version is `v2` (`LABEL_VERSION` in `app/config/__init__.py`).

Node labels:

- Market, Region, Language, Currency, Channel, Supplier;
- Platform, PlatformVersion, AppVersion;
- GameFamily, GameCategory, GameMechanic, Game, Draw, PrizeType;
- PlayerSegment, Player, Device, PaymentMethod, PaymentProvider;
- Campaign, Experiment;
- Incident, IncidentType, SupportCase, SupportCategory;
- Document, DocumentChunk;
- BusinessConcept, which comes from the ontology and not from a table.

Families, categories, mechanics, incident types, support categories and segments have one node for each market-local code.

Relationship types: AFFECTS, AFFECTS_MARKET, AVAILABLE_IN, AVAILABLE_VIA, BELONGS_TO, CATEGORISED_AS, CONCERNS, DEPLOYED_TO, EXPOSED_TO, FROM_MARKET, HAS_CHUNK, HAS_DRAW, HAS_MECHANIC, INSTANCE_OF, IS_A, MAPS_TO, OF_TYPE, PLAYS, PROMOTES, PROVIDED_BY, REFERENCES, RELATED_TO, RELATED_TO_APP_VERSION, RELATED_TO_VERSION, RUNS_ON, SIMILAR_TO, TARGETS, USES, USES_PAYMENT and VERSION_OF.
They join 44 distinct (type, from label, to label) triples, and a test keeps that list in step with ingestion.

### Provenance and validity

Every node carries:

| Property | Meaning |
|---|---|
| `id` | The record id, unique within its label (a uniqueness constraint exists for every label) |
| `source_table`, `source_record_id` | The table and row it came from |
| `label_version` | The graph model version, `v2` |
| `ingestion_version` | The ingestion run that wrote it, for example `ing-20261020T202038Z` |
| `source_timestamp` | The first present of `created_at`, `started_at`, `opened_at`, `released_at`, `registration_date`, `first_seen_at` and `start_at` on the source row |

Time-bounded entities also carry `valid_from`, and most carry `valid_to`:

| Label | `valid_from` | `valid_to` |
|---|---|---|
| Game | `launch_date` | `retirement_date` |
| PlatformVersion | `released_at` | `retired_at` |
| AppVersion | `released_at` | none, an app version is open-ended |
| Campaign, Experiment | `start_at` | `end_at` |
| Incident | `started_at` | none |
| Document | `valid_from` | `valid_to` |

An incident has no `valid_to`, because its resolution ends the outage and not the record, which stays true as history.
Null values are omitted.
Pipelines B and C read these windows for the temporal validity component of the ranking score.

Derived relationships name their method.
`SIMILAR_TO` carries `method: "ontology_similarity_v2"` and the ontology version.
Other methods are `catalog_flags_v1` (`AVAILABLE_VIA`), `operational_dependency_v1` (`RUNS_ON`), `ticket_aggregate_v1` (`PLAYS`), `exposure_aggregate_v1` (`EXPOSED_TO`), `exposure_engagement_v1` (`TARGETS`) and `title_reference_v1` (`REFERENCES`, parsed from document titles and bodies).

### Ingestion

The code is `backend/app/graph/`: `reader.py` reads the Parquet tables, `node_rows.py` and `relationship_rows.py` build graph rows with provenance, `statements.py` holds the Cypher, and `ingest.py` runs the load.

1. Read the source tables.
2. Map them to node rows and relationship rows, with provenance.
3. Apply constraints and indexes.
4. Merge nodes in batches of 2,000, keyed on `id`.
5. Merge typed relationships.
6. Bind the ontology: a `MAPS_TO` edge from every bound local code, and an `IS_A` edge between concepts.
7. Derive the allowed relationships, with a method on every edge.
8. Verify the counts.
   The load counts every label and every relationship triple in the database and fails if it does not hold exactly the mapped rows.
   The expected relationship count is the number of distinct endpoint pairs, because a merge collapses rows that share endpoints.
9. Write `_graph_stats.json` beside the dataset (command line only).

Ingestion is idempotent for the same dataset.
Neo4j holds one world at a time, because node ids repeat across worlds.

For the seed 2026 development world, `_graph_stats.json` records 29 labels, including 10,000 Player, 12,008 Device, 9,686 PaymentMethod, 2,292 Draw, 2,038 SupportCase, 262 Document, 262 DocumentChunk, 44 Incident, 42 BusinessConcept and 20 Game nodes.

### What is in the graph and what is not

| In Neo4j | Stays in the source layer |
|---|---|
| Reference data used for navigation: markets, regions, languages, currencies, channels, suppliers | Tickets, prizes, sessions, campaign exposures, daily KPIs |
| Game catalogue, draws, mechanics and the market-local taxonomies | Row-level detail of every table |
| Release history: platforms, platform versions, app versions | Authoritative decimals, amounts and dates |
| Players, devices, payment methods and providers | |
| Campaigns, experiments, incidents, support cases | |
| Documents and chunks, as nodes, and concepts | The text of documents (it lives in the vector layer) |

Document nodes exist in the graph, but retrieval never traverses to them: documents reach every pipeline through the shared vector layer (D-026).

### Traversal allow-list

Retrieval walks 22 of the 30 relationship types, the structured allow-list in `DEFAULT_RELATIONSHIP_TYPES` (`app/config/__init__.py`).
Eight are left out on purpose.

| Left out | Why |
|---|---|
| `HAS_CHUNK`, `REFERENCES` | Document edges. The vector layer owns document retrieval for every pipeline. |
| `PLAYS`, `EXPOSED_TO`, `AVAILABLE_VIA`, `PROMOTES`, `HAS_DRAW`, `DEPLOYED_TO` | Transactional or high fan-out edges that would flood the traversal budget. |

Pipeline C walks all 22.
Pipeline B walks 19: the 22 minus the three ontology relationship types `MAPS_TO`, `SIMILAR_TO` and `IS_A` (D-017).
That split is what makes B equal to C without the ontology.

The traversal caps are depth 2, 100 nodes per hop, 4 edges per node and relationship type, and 200 nodes in total.
They are configurable (`GRAPH_DEPTH`, `GRAPH_MAX_NODES_PER_HOP`, `GRAPH_MAX_EDGES_PER_NODE_TYPE`, `GRAPH_MAX_TOTAL_NODES`), and the one neighbour query also carries a hard `LIMIT 5000`.
`GET /api/v1/graph/schema` returns the allow-lists, the caps and the ranking weights.

### Cypher

All Cypher is in `backend/app/graph/statements.py` and the `cypher/` folder beside it.
Statements are static and parameterised.
Relationship types and labels come from fixed registries and never from user text.
Six example queries are bundled in `app/graph/cypher/`: campaign transferability, cross-market incident transfer, cross-market similar products, incident context, multilingual concept lookup and ontology-assisted product lookup.

## The ontology

The ontology is the dictionary that the four source systems lack.
Its version is 2.0.0 (`ONTOLOGY_VERSION` in `backend/app/ontology/__init__.py`).

### Source and model

`schemas/ontology/ontology.yaml` is the only source of concepts, labels, synonyms and bindings (D-012).
`backend/app/ontology/loader.py` loads it into an immutable model (`model.py`).
The ontology package does not depend on the generator, the scenarios or the evaluator.

A concept has an id, a parent, a type, a definition, a label in each of four languages (English, Greek, German, Czech) and synonyms in each.
A binding maps one market-local code to a concept and has a kind, a code, a market (none for a shared code) and a concept id.

### Concept tree

There are 42 concepts under six roots.

| Root | Concepts below it |
|---|---|
| `CONCEPT_LOTTERY_PRODUCT` | Draw game (national draw, multinational jackpot, annuity draw, fixed prize draw), high-frequency game, instant product (scratchcard, online instant), add-on game |
| `CONCEPT_GAME_MECHANIC` | Number selection, quick pick, symbol reveal, instant rounds, progressive jackpot, second chance |
| `CONCEPT_INCIDENT` | Platform incident, with payment, application, identity, draw and retail incidents below it |
| `CONCEPT_SUPPORT_TOPIC` | Payment complaint, account access, game query, technical fault |
| `CONCEPT_PLAYER_SEGMENT` | Value segments (high, mainstream, low) and engagement segments (engaged, casual, dormant) |
| `CONCEPT_SALES_CHANNEL` | Retail and digital |

### Bindings

117 bindings map market-local codes to concepts.

| Kind | Bindings |
|---|---|
| family | 20 |
| category | 13 |
| mechanic | 16 |
| incident type | 25 |
| support category | 16 |
| segment | 24 |
| channel | 3 |

Channel bindings are shared across markets (D-013).
Every other binding names its market.
`CONCEPT_PROGRESSIVE_JACKPOT` is intentionally unbound (D-019), because a progressive jackpot is a game attribute (`jackpot_type_code`) and not a market mechanic code.
In the graph each binding is a `MAPS_TO` edge, and each parent link is an `IS_A` edge.

### Cross-market mappings

Cross-market equivalence lives only in the ontology.
The national draw is the worked example.
Each market has its own family code and its own display name, and all four map to one concept, `CONCEPT_NATIONAL_DRAW`.

| Market | Local family | Local name | Maps to |
|---|---|---|---|
| UK | `FAM_UK_NATIONAL_DRAW` | National Draw | `CONCEPT_NATIONAL_DRAW` |
| Greece | `FAM_GR_ARITHMOLACHEIO` | Αριθμολαχείο | `CONCEPT_NATIONAL_DRAW` |
| Austria | `FAM_AT_ZAHLENZIEHUNG` | Zahlenziehung | `CONCEPT_NATIONAL_DRAW` |
| Czech Republic | `FAM_CZ_CISELNA_LOTERIE` | Číselná loterie | `CONCEPT_NATIONAL_DRAW` |

A question that names one market's local term can then reach the equivalent games in the other three, through the concept.
Without the ontology, no edge in the source layer links them.
Incident types, support categories, mechanics and player segments are mapped the same way.

### Term table and matching

`app/ontology/terms.py` builds one table of lower-cased terms from three sources: concept labels, concept synonyms and the local display names the generator gives each code (`local_name_variants()` in `datasets/taxonomies.py`).
Each term records its language, its concept and its source.
A whole-word matcher over the table resolves question text to concepts.
The table is built from the ontology and the master data only, before any grounding exists, and a test asserts that the ontology package imports nothing from the question bank or the scenarios.
Pipeline C uses it for entity resolution and query expansion (see [retrieval.md](retrieval.md)).

### Similarity

`ontology_similarity_v2` (`app/ontology/similarity.py`) scores two games in different markets from their concepts only.
A family match adds 0.4, a category match adds 0.2, and 0.4 times the Jaccard index of their mechanic concepts is added.
Each game keeps its three best cross-market matches as `SIMILAR_TO` edges.
With market-local codes the score cannot be computed from the source layer, so these edges are an ontology artefact available to pipeline C only.

## Operation

```bash
make services-up          # Neo4j and Qdrant, via Docker Compose
make ingest-graph         # load the development world, wiping the graph first
make ingest-demo-graph    # load the demo world instead
```

Direct form, from `backend/`: `uv run python -m app.graph [--dataset DIR] [--wipe]`.
Without `--wipe` the load merges into whatever the graph holds.

After a load, check `GET /api/v1/health/ready`.
The `graph` check fails with "the graph holds another world" when the node counts differ from the active dataset's `_graph_stats.json`.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `NEO4J_URI` | `bolt://localhost:7687` | The Bolt address |
| `NEO4J_USER`, `NEO4J_PASSWORD`, `NEO4J_DATABASE` | `neo4j`, `devpassword`, `neo4j` | The connection. The default password matches `docker-compose.yml` and is for local use only. |
| `NEO4J_TIMEOUT_S` | 10 | Seconds to connect, and to run one retrieval query |
| `GRAPH_DEPTH`, `GRAPH_MAX_NODES_PER_HOP`, `GRAPH_MAX_EDGES_PER_NODE_TYPE`, `GRAPH_MAX_TOTAL_NODES` | 2, 100, 4, 200 | The traversal caps |
| `GRAPH_REFERENCE_DATE` | end of the dataset window | Records whose validity ended before this date rank as superseded |

Two settings have no variable, because they are fixed design.
Concept expansion is on for C and off for B, and the excluded node label is `Document` (D-026).
The excluded label is recorded with every benchmark run.

## Testing

- `test_graph_mapping.py`: node and relationship row builders without I/O, validity windows, source timestamps, and linear-time building.
- `test_graph_statements.py`: statement shapes and registries.
- `test_ontology.py`: loading, bindings, the term table and similarity.
- `test_provenance.py`: provenance on nodes.
- `test_graph_ingestion.py`: live Neo4j, with constraints, counts, provenance, idempotency and bounded traversals.
  It wipes the database, so it only runs under `GRAPH_E2E=1` (`make test-graph`).
  CI runs it against a fresh Neo4j service.

## Extension points

- A new market-local code needs an entry in `datasets/taxonomies.py` and a binding in `ontology.yaml`.
- A new concept is an entry in `ontology.yaml`, and the ontology version changes if the meaning changes.
- A new relationship type needs an entry in the registry, an endpoint triple, a row builder and a decision about whether it joins the traversal allow-list.
  Joining the allow-list is a method change.
- Whether the ontology should declare its allowed relationships, instead of the Data Model screen deriving them from ingestion, is an open owner question from the CP2 package.

## Failure modes

| Failure | What happens |
|---|---|
| Neo4j unreachable | The ingestion CLI exits non-zero with the driver error. A run of B or C records a `GRAPH_QUERY_ERROR`. |
| A table file is missing | `FileNotFoundError` before anything is written. |
| The database does not hold exactly the mapped rows | `RuntimeError` after writing. Fix the cause and re-run with `--wipe`. No partial state is reported as success. |
| Another world is in the graph | Readiness fails, the Data Model graph routes answer 409, and B and C runs are refused. Run `make ingest-graph`. |

The archived graph and ontology specifications are [reference/02-graph-schema-spec.md](reference/02-graph-schema-spec.md) and [reference/03-ontology-spec.md](reference/03-ontology-spec.md).
