# Data

This page describes the synthetic world: what it contains, how it is generated, where each table comes from and how provenance is kept.
The graph built on top of it is in [graph-and-ontology.md](graph-and-ontology.md).
The patterns planted into it are in [scenarios.md](scenarios.md).

All data is synthetic.
No real customer, player, employee, transaction or document information is used, and no real company is named.

## Purpose

The world stands in for the existing enterprise data layer of a multinational lottery operator with four markets.
It has to be realistic enough that conventional search, graph traversal and ontology mapping all have something to find, and it has to be reproducible, so that a benchmark can be repeated on the same world.

| Market id | Country | Currency | Document language |
|---|---|---|---|
| `MKT_UK` | United Kingdom | GBP | English |
| `MKT_GR` | Greece | EUR | Greek, with some English |
| `MKT_AT` | Austria | EUR | German, with some English |
| `MKT_CZ` | Czech Republic | CZK | Czech, with some English |

Each market behaves like a separate operator on a separate source system.
It owns its reference data and its codes.
The national draw family is `FAM_UK_NATIONAL_DRAW` in the UK and `FAM_GR_ARITHMOLACHEIO` in Greece, and nothing in the source tables says they are the same kind of thing.
Only the ontology does (see [graph-and-ontology.md](graph-and-ontology.md)).
Channel codes are the one shared taxonomy (D-013).

## Architecture

### Generator

The generator is `backend/app/datasets/`.
It builds a world in memory as named row records, plants the enabled scenarios, validates the whole world, and only then writes Parquet files and a manifest.
A world that fails validation is not written.

```bash
make generate-dev-data      # dev profile, world seed 2026 -> data/generated/dev-seed2026/
make generate-demo-data     # demo profile, world seed 2026, separate truth ledger
```

Direct form, from `backend/`:

```bash
uv run python -m app.datasets --profile dev --world-seed 2026 [--scenario-seed N] [--no-scenarios] [--output-dir DIR]
```

The profiles are `tiny`, `dev`, `demo` and `stress`.
The CLI accepts `tiny`, `dev` and `demo`, and refuses `stress`, which is still gated.
A demo world must write its ledger to a separate path, so a demo run cannot overwrite the development ledger.

| Profile | Players | Tickets | Sessions | Exposures | Incidents | Campaigns per market | Experiments | Documents |
|---|---|---|---|---|---|---|---|---|
| tiny | 200 | 2,000 | 800 | 800 | 25 | 3 | 6 | 24 |
| dev | 10,000 | 250,000 | 100,000 | 100,000 | 40 | 4 | 8 | 250 |
| demo | 100,000 | 5,000,000 | 2,000,000 | 3,000,000 | 120 | 6 | 12 | 2,000 |
| stress | 1,000,000 | 50,000,000 | 20,000,000 | 30,000,000 | 400 | 8 | 16 | 10,000 |

The remaining volumes (retailers, devices, support cases) are in `app/datasets/config.py`.
The game catalogue is 20 games in every profile: five families in each of four markets.
Scaling a profile grows activity, never the catalogue.

The seed 2026 development world, as generated, holds 39 tables.
Its row counts are higher than the profile targets by the rows the scenarios plant.
For example it has 274,473 tickets against a target of 250,000, because SCN-010 plants 24,449 and SCN-002 plants 24.
It has 262 documents against 250, because the scenarios plant 12.

### Determinism

Every world records `generator_version` (0.2.0), `world_seed`, `scenario_seed`, the profile and the configuration in `_manifest.json`.
The same generator version, seeds and configuration reproduce the same world.
Each table generator and each scenario draws from its own random stream, seeded by the generator version, the seed and a component name (`app/datasets/rng.py`).
A golden-hash test pins the written Parquet and the truth ledger across processes (`tests/fixtures/golden/tiny-seed7.json`, `test_golden_world.py`, `test_determinism.py`).
After a change to the generator, the ontology or the ledger version, the fixture is regenerated on purpose with `backend/scripts/golden.py`.

All business timestamps fall inside one fixed window: 365 days from 2025-01-01.
Shared distribution shapes (market splits, segment weights, activity skew, win shares) are named and documented in `app/datasets/distributions.py`.
A shape that belongs to one table or one scenario may stay in its own module when it is named and commented (D-020).

### The tables

The dictionary has 39 tables in seven source systems.
The system names are generic and fictional.

| Source system | Tables |
|---|---|
| `warehouse` (27) | accounts, channels, currencies, devices, draws, experiments, game_categories, game_families, game_mechanic_map, game_mechanics, games, incident_types, kpi_daily, languages, markets, payment_methods, payment_providers, player_device, player_payment_method, player_segments, players, prizes, regions, retailers, suppliers, support_categories, tickets |
| `release_management` (3) | app_versions, platform_versions, platforms |
| `campaign_platform` (3) | campaign_exposures, campaign_game_map, campaigns |
| `document_store` (2) | document_chunks, documents |
| `incident_management` (2) | incident_game_map, incidents |
| `telemetry_platform` (1) | sessions |
| `support_platform` (1) | support_cases |

The authoritative definition of every table, column type, primary key, foreign key and id format is the schema registry, `backend/app/datasets/schema.py`.
The 61 foreign keys are exported from there, and both the validator and the API read them.
Each generation also writes `_data_dictionary.json` beside the Parquet files: one entry per column with its table, type, position, primary key flag, source system and sensitivity (always "none (synthetic)"), plus the foreign keys and id formats.
The Data Model screen and `GET /api/v1/datasets/{dataset_id}/dictionary` read it.

Ids are stable and readable, and a planted row takes the next id in its table's sequence, so an id never reveals a plant (D-014).
Examples: `INC_041`, `GAME_AT_04`, `PLAYER_UK_000605`, `DOC_0251`, `CHNK_0251_00`, `SUP_00012`.

Market-owned reference data exists once per market, with display names in the market language: game families, game categories, game mechanics, incident types, support categories and player segments.
There is no `business_concepts` table, because concepts belong to the ontology and not to the source layer.

### Documents

The document store holds 14 document types: release notes, game rules, incident reports, meeting notes, monthly market reviews, support summaries, product specifications, marketing briefs, campaign evaluations, post-incident reviews, platform documentation, technical integration notes, experiment reports and policies.
In the seed 2026 world, 165 of 262 documents are in English, 45 in Greek, 31 in German and 21 in Czech.
50 have no market, because they are corporate documents.

Rules the generator keeps:

- a document's market matches its subject's market;
- detail sentences refer to entities related to the subject, and no sentence repeats within a document;
- documents name games, incidents and segments by local display name at least as often as by id;
- baseline documents take every shape a planted document takes, so no planted document is structurally unique;
- with probability 0.4 a monthly market review covers the reporting period of its market instead of one game, and its `source_record_id` is empty.

Chunking splits on sentence boundaries into windows of at most 160 words, repeating the last sentence at the start of the next window, so decimals, version labels and ids stay whole.
`CHUNK_MAX_WORDS` and `CHUNK_OVERLAP_SENTENCES` set the rule.
Every pipeline reads the one chunk file, `document_chunks.parquet` (D-011).
In the seed 2026 world every chunk is a whole document, because no document exceeds one window.

### Validation

`validate_world` returns every problem it finds, and the CLI refuses to write a world with any.
It checks:

- referential integrity over all 61 foreign keys, null-aware;
- that a player's segments come from the segment taxonomy of the player's own market;
- market and currency consistency across facts;
- time order, including that a session only runs an app version its market had already released;
- volume targets;
- provenance coverage.

### Derived values

KPIs are derived from the final rows after planting, and injectors never edit `kpi_daily` (D-015).
`conversion_rate` is the share of engaged campaign exposures that converted, per market and day.

## Provenance

Every table has a source system and a source table, recorded in the manifest.
Every graph node carries `source_table` and `source_record_id`, and nodes that come from time-stamped records also carry a source timestamp and a validity window.
The graph properties are in [graph-and-ontology.md](graph-and-ontology.md).
Every serialised record block and every citation carries its source table and record id.
Provenance is metadata about where a fact came from.
It is not the fact itself: authoritative quantities stay in the Parquet tables, and amounts on graph nodes are convenience copies.

Derived evidence names how it was derived.
For example a similarity edge carries `method: "ontology_similarity_v2"` and the ontology version.

## Operation

```bash
make generate-dev-data
make generate-demo-data
```

The first demo generation, measured in October 2026 with generator 0.1.0, took about 100 seconds; it has not been timed since.
Generate before anything live runs.
A fresh clone has no `data/` directory.
Offline tests do not need it, because they build a tiny world in a temporary directory.

The benchmark generates seeds 2027 and 2028 on first use.
The three official worlds are all the dev profile, with the scenario seed equal to the world seed (see [evaluation.md](evaluation.md)).

Where each world is kept:

| World | Directory | Truth ledger |
|---|---|---|
| Development, seed 2026 | `data/generated/dev-seed2026/` | `data/truth/ledger.json` |
| Development, seeds 2027 and 2028 | `data/generated/dev-seed<seed>/` | `data/truth/dev-seed<seed>.json` |
| Demo, seed 2026 | `data/generated/demo-seed2026/` | `data/truth/ledger-demo.json` |

Two more files are written beside a world by later steps: `_graph_stats.json` by graph ingestion, and `vector-index.json` by the index build.

## Configuration

| Variable | Meaning |
|---|---|
| `DATASET_DIR` | The world the API, the graph tools and the index read. Unset means `data/generated/dev-seed2026`. |
| `TRUTH_LEDGER_PATH` | The ledger of that world. Read only inside `app.evaluation`. Unset means `data/truth/ledger.json`. |

The presentation world is whatever `DATASET_DIR` names.
Which world should be the presentation world is an open owner question (see [operations.md](operations.md)).

## Testing

- `test_determinism.py` and `test_golden_world.py`: reproduction within and across processes.
- `test_validation.py`, `test_rows.py`, `test_taxonomies.py`, `test_documents.py`, `test_chunking.py`: the rules above.
- `test_provenance.py`: provenance fields on nodes and records.
- `test_scenarios_v2.py`: the planted data (see [scenarios.md](scenarios.md)).

## Extension points

- A new table needs an entry in `schema.py` (columns, primary key, foreign keys, id format and source system), a row type in `rows.py` and a generator, and the schema registry then feeds the dictionary, the validator and the API.
- A new profile is an entry in `config.py`, and the CLI choices must be extended.
- A new document type is a template in `document_templates.py`.

## Failure modes

| Failure | What happens |
|---|---|
| Validation finds a problem | The CLI prints the first 20 and exits with status 1, and writes nothing. |
| Demo generation without a separate ledger path | The CLI refuses. |
| A table file is missing at ingestion | `FileNotFoundError` before anything is written to the graph. |
| A world's manifest names another generator version or seed | The benchmark regenerates the world before scoring. |

The generator's older specification is archived at [reference/01-synthetic-data-spec.md](reference/01-synthetic-data-spec.md).
