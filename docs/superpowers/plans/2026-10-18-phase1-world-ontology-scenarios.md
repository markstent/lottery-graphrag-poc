# Phase 1: World v2, Ontology v2 and Scenarios Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Regenerate the synthetic enterprise so that each market has its own vocabulary and language, materialise a real multilingual ontology that is the only thing connecting the markets, ingest both into Neo4j with a clean B/C split, and plant eight scenarios with ids that do not reveal themselves.

**Architecture:** The generator (`app/datasets`) produces per-market reference data and coherent multilingual documents with named rows and documented constants. A new `app/ontology` package loads `schemas/ontology/ontology.yaml` (concept hierarchy, four-language labels, synonyms, bindings from every market-local code to a canonical concept) and derives concept-based similarity. Graph ingestion maps source tables to structural nodes and edges, and maps the ontology to `BusinessConcept` nodes, `IS_A` and `MAPS_TO` edges and `SIMILAR_TO` edges; pipeline B's allow-list excludes every ontology edge. The scenario engine gains an id allocator and four injectors, and KPIs are derived after planting so planted facts produce their own signals.

**Tech Stack:** Python 3.13, uv, DuckDB, PyArrow, PyYAML (new), Neo4j 5.26 driver, pytest, ruff, mypy strict.

**Spec:** `docs/superpowers/specs/2026-10-18-overhaul-design.md` sections 5.1, 5.2, 5.3 and the B/C allow-list part of 5.4.

## Global Constraints

- Never use the real employer name or the word `Atlas` anywhere; all data synthetic (AGENTS.md).
- Never use real lottery brand names for local product families (for example the Greek, Austrian or Czech branded draw games); use generic local-language terms only.
- Generation is deterministic: identical `GENERATOR_VERSION`, `world_seed`, `scenario_seed` and profile reproduce byte-identical Parquet.
- `GENERATOR_VERSION = "0.2.0"`, `ONTOLOGY_VERSION = "2.0.0"`, `LEDGER_VERSION = "2"`.
- The truth ledger stays evaluator-only: nothing under `app/retrieval`, `app/api`, `app/datasets`, `app/graph`, `app/ontology` imports `app.evaluation` or names the truth path (existing AST test; extend `ISOLATED_NAMESPACES` with `ontology`).
- The ontology package never imports `app.evaluation`, `app.scenarios` or the bank; its term table is built from `ontology.yaml` and `master_data` only.
- Shared distribution shapes live in `app/datasets/distributions.py` with a one-line comment; shape numbers specific to one table or one scenario may stay in their module when they are named and commented (D-020).
- No positional tuple indexing in `app/datasets`, `app/scenarios` or `app/graph`; rows are `NamedTuple` instances accessed by field name.
- Planted ids continue the baseline id sequence of their table; no id contains a scenario marker such as `S007`.
- Markdown written by this plan puts each sentence on its own line and uses plain dashes.
- Run before every commit: `uv run ruff format . && uv run ruff check . && uv run mypy && uv run pytest` from `backend/`; all green.
- Commit messages carry no agent co-author line (owner rule).

## Review Focus

1. A Greek, German or Czech display name containing a comma, apostrophe or non-Latin letters flows through document templates, chunking, Parquet, DuckDB and Neo4j without mangling; test pinned in Task 9 (chunker) and Task 16 (ingestion round trip).
2. A document whose body contains a decimal price, a semantic version label and an abbreviation with a trailing dot stays in one chunk when it fits the window; test pinned in Task 9.
3. Regenerating with the same seeds in a fresh process produces identical Parquet bytes and an identical ledger, including planted ids from the allocator; test pinned in Task 20.
4. A profile whose market has fewer eligible players or games than a scenario needs fails loudly with the scenario id in the message, never plants a partial pattern; test pinned in Task 14.
5. Every market-local code that appears in any generated table has exactly one ontology binding, and every binding points at a concept that exists; test pinned in Task 11.

---

## File structure

Created:

- `backend/app/datasets/schema.py`: `TABLE_SCHEMAS`, `TABLE_PROVENANCE`, `FOREIGN_KEYS`, `ID_FORMATS` (one place for the relational contract).
- `backend/app/datasets/rows.py`: one `NamedTuple` per table, field names identical to the DDL columns.
- `backend/app/datasets/distributions.py`: every named distribution constant.
- `backend/app/datasets/taxonomies.py`: market-local reference data (families, categories, mechanics, incident types, support categories, segments, payment providers).
- `backend/app/ontology/__init__.py`, `model.py`, `loader.py`, `terms.py`, `similarity.py`.
- `backend/app/scenarios/planter.py`, `inject_topology.py`, `inject_operations.py`, `inject_ontology.py`, `inject_documents.py`.
- `backend/tests/fixtures/golden/tiny-seed7.json`.
- `backend/tests/test_rows.py`, `test_taxonomies.py`, `test_ontology.py`, `test_documents.py`, `test_chunking.py`, `test_golden_world.py`, `test_scenarios_v2.py` (replaces `test_scenarios.py`).

Modified:

- `backend/app/datasets/{config,master_data,util,entities,activity,operations,marketing,documents,world,validation,parquet,__main__}.py`
- `backend/app/graph/{mapping,statements,ingest,__main__}.py`
- `backend/app/scenarios/{plant,engine,ledger,catalogue}.py`
- `backend/app/config/__init__.py`, `backend/app/retrieval/graph/lab.py`, `backend/app/retrieval/graph/source_lookup.py`, `backend/app/evaluation/grounding.py`, `backend/app/api/queries.py`
- `backend/pyproject.toml`, `schemas/ontology/ontology.yaml`, `schemas/graph/graph-schema.yaml`
- `docs/01-synthetic-data-spec.md`, `docs/02-graph-schema-spec.md`, `docs/03-ontology-spec.md`, `docs/04-scenario-catalogue.md`, `DECISIONS.md`, `.env.example` (no change expected; verify)

Deleted:

- `backend/app/datasets/master_data.py` content that moves to `taxonomies.py` (the file stays for `GAME_SPECS`, `PLATFORMS`, `SUPPLIERS`, `MARKETS`, `REGIONS`, `CURRENCIES`, `LANGUAGES`, `CHANNELS`, `PRIZE_TYPES`, `CAMPAIGN_OBJECTIVES`).
- `BUSINESS_CONCEPTS` from master data and the `business_concepts` table (the ontology is not a warehouse table).
- `backend/app/graph/cypher/ontology_assisted_product_lookup.cypher` and any other example Cypher that references removed codes (check with grep; update rather than delete if still valid).

---

### Task 1: Relational contract module and named rows

**Files:**
- Create: `backend/app/datasets/schema.py`
- Create: `backend/app/datasets/rows.py`
- Modify: `backend/app/datasets/world.py` (import `TABLE_SCHEMAS`, `TABLE_PROVENANCE` from `schema`; delete the local copies)
- Modify: `backend/app/datasets/validation.py:34-80` (read `FOREIGN_KEYS` from `schema`)
- Test: `backend/tests/test_rows.py`

**Interfaces:**
- Produces: `schema.TABLE_SCHEMAS: dict[str, str]`, `schema.TABLE_PROVENANCE: dict[str, tuple[str, str]]`, `schema.FOREIGN_KEYS: tuple[ForeignKey, ...]` with `ForeignKey(child_table: str, child_column: str, parent_table: str, nullable: bool)`, `schema.ID_FORMATS: dict[str, str]` mapping table to a format string such as `"INC_{n:03d}"`, `schema.column_names(table: str) -> list[str]`, `schema.column_index(table: str, column: str) -> int`.
- Produces: `rows.<Table>Row` NamedTuple classes named in PascalCase singular (`MarketRow`, `GameRow`, `TicketRow`, `DocumentChunkRow`, ...) and `rows.ROW_TYPES: dict[str, type[tuple]]` keyed by table name.
- New tables in `TABLE_SCHEMAS` (added here, populated in later tasks):
  - `incident_types`: `incident_type_id VARCHAR, market_id VARCHAR, name VARCHAR, language_code VARCHAR`
  - `support_categories`: `support_category_id VARCHAR, market_id VARCHAR, name VARCHAR, language_code VARCHAR`
  - `player_segments`: `segment_id VARCHAR, market_id VARCHAR, segment_kind VARCHAR, name VARCHAR, language_code VARCHAR`
  - `payment_providers`: `provider_id VARCHAR, name VARCHAR, home_market_id VARCHAR, platform_id VARCHAR`
- Changed tables: `game_families` gains `market_id VARCHAR, language_code VARCHAR`; `game_categories` gains `market_id VARCHAR, language_code VARCHAR`; `game_mechanics` gains `market_id VARCHAR, language_code VARCHAR`; `business_concepts` is removed; `campaign_exposures.exposure_id` format becomes `EXPO_{n:07d}`.
- `FOREIGN_KEYS` adds: `games.game_family_id -> game_families`, `games.game_category_code -> game_categories`, `incidents.incident_type -> incident_types`, `support_cases.category_code -> support_categories`, `players.value_segment -> player_segments`, `players.engagement_segment -> player_segments`, `payment_methods.provider_id -> payment_providers`, `player_payment_method.payment_method_id -> payment_methods` (not nullable; the shared pool becomes real rows in Task 5), `game_families.market_id -> markets`, `game_categories.market_id -> markets`, `game_mechanics.market_id -> markets`, `incident_types.market_id -> markets` (nullable), `support_categories.market_id -> markets`, `player_segments.market_id -> markets`, `payment_providers.home_market_id -> markets` (nullable), `payment_providers.platform_id -> platforms`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_rows.py
from app.datasets import rows, schema

def test_every_table_has_a_row_type_with_matching_fields() -> None:
    for table, ddl in schema.TABLE_SCHEMAS.items():
        row_type = rows.ROW_TYPES[table]
        assert row_type._fields == tuple(schema.column_names(table)), table

def test_foreign_keys_reference_existing_columns_and_tables() -> None:
    for fk in schema.FOREIGN_KEYS:
        assert fk.child_column in schema.column_names(fk.child_table), fk
        assert fk.parent_table in schema.TABLE_SCHEMAS, fk

def test_id_formats_cover_every_generated_table_with_a_sequence_id() -> None:
    for table in ("incidents", "documents", "support_cases", "sessions", "tickets", "campaigns", "campaign_exposures", "prizes", "draws"):
        assert "{n" in schema.ID_FORMATS[table]

def test_business_concepts_is_not_a_warehouse_table() -> None:
    assert "business_concepts" not in schema.TABLE_SCHEMAS
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/test_rows.py -v`
Expected: FAIL with `ModuleNotFoundError: app.datasets.schema`

- [ ] **Step 3: Implement `schema.py` and `rows.py`; point `world.py` and `validation.py` at them**

`FOREIGN_KEYS` is a `tuple[ForeignKey, ...]` of a frozen dataclass; `validation._referential_errors` resolves `child_column` to a position with `column_index` and keeps its current nullable logic. Remove the `known_ids["payment_methods"] |= ...` hack line; Task 5 makes the pool real rows (until then `test_validation` may fail; that is expected and fixed in Task 5, so Tasks 1 to 5 are committed together only after Task 5 passes, or keep the hack until Task 5 and delete it there; choose the latter).

- [ ] **Step 4: Run the new tests and the existing suite**

Run: `cd backend && uv run pytest tests/test_rows.py tests/test_validation.py tests/test_determinism.py -v`
Expected: PASS (existing generators still return plain tuples; `ROW_TYPES` alignment is what is tested here)

- [ ] **Step 5: Commit**

```bash
git add backend/app/datasets/schema.py backend/app/datasets/rows.py backend/app/datasets/world.py backend/app/datasets/validation.py backend/tests/test_rows.py
git commit -m "feat(datasets): relational contract module with named rows and foreign keys"
```

---

### Task 2: Distribution constants and profile volumes

**Files:**
- Create: `backend/app/datasets/distributions.py`
- Modify: `backend/app/datasets/config.py` (`GENERATOR_VERSION = "0.2.0"`; `ProfileVolumes` gains `incidents: int`, `campaigns_per_market: int`, `experiments: int`)
- Test: `backend/tests/test_determinism.py` (extend)

**Interfaces:**
- Produces: module-level constants, each with a one-line comment stating what it shapes. Exact names and values:
  - `SECOND_DEVICE_SHARE = 0.08`, `SHARED_PAYMENT_SHARE = 0.04`, `SHARED_PAYMENT_POOL_SIZE = 80`
  - `VALUE_SEGMENT_WEIGHTS = (0.10, 0.55, 0.35)`, `ENGAGEMENT_SEGMENT_WEIGHTS = (0.30, 0.45, 0.25)`
  - `DIGITAL_AFFINITY_MEAN = {"UK": 0.60, "GR": 0.45, "AT": 0.45, "CZ": 0.45}`, `DIGITAL_AFFINITY_SD = 0.2`
  - `PLAYER_ACTIVITY_PARETO_ALPHA = 1.6`, `ENGAGEMENT_ACTIVITY_BOOST = {"ENGAGED": 1.5, "CASUAL": 1.0, "DORMANT": 0.15}` (keyed by segment kind code, see Task 3)
  - `DRAW_WIN_PROBABILITY = 0.25`, `ROLLOVER_FACTOR = 1.4`, `JACKPOT_CAP_MINOR = 200_000_000_00`
  - `ANONYMOUS_RETAIL_SHARE = 0.15`, `VOID_TICKET_SHARE = 0.01`, `PRIZE_WIN_SHARE = 0.35`, `PRIZE_CLAIM_SHARE = 0.8`
  - `DOMINANT_APP_VERSION_SHARE = 0.45`, `SESSION_OUTCOME_WEIGHTS = {"COMPLETE": 0.78, "ABANDONED": 0.14, "FAIL_PAYMENT": 0.08}`
  - `EXPOSURE_ENGAGED_SHARE = 0.30`, `EXPOSURE_CONVERSION_SHARE = 0.25`
  - `CROSS_MARKET_INCIDENT_SHARE = 0.12`, `INCIDENT_RESOLVED_SHARE = 0.9`, `INCIDENT_ROOT_CAUSE_SHARE = 0.4`, `SEVERITY_WEIGHTS = (("LOW", 0.40), ("MEDIUM", 0.35), ("HIGH", 0.20), ("CRITICAL", 0.05))`
  - `SUPPORT_INCIDENT_LINK_SHARE = 0.15`, `SUPPORT_PLAYER_LINK_SHARE = 0.6`, `SUPPORT_GAME_LINK_SHARE = 0.6`, `SUPPORT_CLOSED_SHARE = 0.85`
  - `MARKET_DOCUMENT_ENGLISH_SHARE = 0.30`, `MENTION_NAME_ONLY_SHARE = 0.5`
  - `PROVIDER_MIX = {"UK": {"PP_BLUEHARBOR": 0.55, "PP_NORTHGATE": 0.45}, "GR": {"PP_BLUEHARBOR": 0.40, "PP_CONTINENTAL": 0.35, "PP_AEGEAN_PAY": 0.25}, "AT": {"PP_BLUEHARBOR": 0.40, "PP_CONTINENTAL": 0.35, "PP_ALPENKASSE": 0.25}, "CZ": {"PP_BLUEHARBOR": 0.40, "PP_CONTINENTAL": 0.35, "PP_VLTAVA_PAY": 0.25}}`
  - `MARKET_RETAIL_SHARE`, `MARKET_DEVICE_SHARE`, `MARKET_SPLIT` move here from `entities.py` and `master_data.py`.
- Profile volumes: `TINY` adds `incidents=25, campaigns_per_market=3, experiments=6`; `DEV` adds `40, 4, 8`; `DEMO` adds `120, 6, 12`; `STRESS` adds `400, 8, 16`.

- [ ] **Step 1: Write the failing test**

```python
def test_profiles_scale_operational_volumes() -> None:
    from app.datasets.config import DEMO, DEV, TINY
    assert (TINY.incidents, TINY.campaigns_per_market, TINY.experiments) == (25, 3, 6)
    assert DEV.incidents > TINY.incidents and DEMO.incidents > DEV.incidents

def test_generator_version_is_v2() -> None:
    from app.datasets.config import GENERATOR_VERSION
    assert GENERATOR_VERSION == "0.2.0"
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_determinism.py -v -k "profiles or version"`
Expected: FAIL (`TypeError` for the new fields / assertion on version)

- [ ] **Step 3: Implement `distributions.py` and the config change**

Do not yet rewire the generators (Tasks 3 to 8 do that as each file is converted).

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/test_determinism.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/datasets/distributions.py backend/app/datasets/config.py backend/tests/test_determinism.py
git commit -m "feat(datasets): documented distribution constants and v2 profile volumes"
```

---

### Task 3: Market-local taxonomies

**Files:**
- Create: `backend/app/datasets/taxonomies.py`
- Modify: `backend/app/datasets/master_data.py` (remove `GAME_FAMILIES`, `GAME_CATEGORIES`, `GAME_MECHANICS`, `PLAYER_SEGMENTS`, `INCIDENT_CATEGORIES`, `SUPPORT_CATEGORIES`, `BUSINESS_CONCEPTS`, `MARKET_SPLIT`; re-point `GAME_SPECS` to local codes)
- Test: `backend/tests/test_taxonomies.py`

**Interfaces:**
- Produces, all as tuples of the `rows` NamedTuples from Task 1:
  - `GAME_FAMILIES: tuple[GameFamilyRow, ...]`
  - `GAME_CATEGORIES: tuple[GameCategoryRow, ...]`
  - `GAME_MECHANICS: tuple[GameMechanicRow, ...]`
  - `INCIDENT_TYPES: tuple[IncidentTypeRow, ...]`
  - `SUPPORT_CATEGORIES: tuple[SupportCategoryRow, ...]`
  - `PLAYER_SEGMENTS: tuple[PlayerSegmentRow, ...]`
  - `PAYMENT_PROVIDERS: tuple[PaymentProviderRow, ...]`
  - helpers: `segments_for(market_code: str, kind: str) -> tuple[str, str, str]` returning the three segment ids of a kind in canonical order (high, mid, low for VALUE; engaged, casual, dormant for ENGAGEMENT); `incident_type_for(market_id: str | None, canonical: str) -> str` where `canonical` is one of `PAYMENT, APPLICATION, DRAW, IDENTITY, RETAIL`; `support_category_for(market_id: str, canonical: str) -> str` where canonical is one of `PAYMENT, ACCOUNT, GAME, TECHNICAL`; `MARKET_LANGUAGE: dict[str, str]` (`MKT_UK: en, MKT_GR: el, MKT_AT: de, MKT_CZ: cs`).
- Exact family ids and local names (language is the market language):
  - UK: `FAM_UK_NATIONAL_DRAW` "National Draw", `FAM_UK_ANNUITY` "Annuity Draw", `FAM_UK_RAPID_NUMBERS` "Rapid Numbers", `FAM_UK_FIXED_PRIZE` "Fixed Prize Raffle", `FAM_UK_SCRATCHCARD` "Scratchcard", `FAM_UK_ONLINE_INSTANT` "Online Instant"
  - GR: `FAM_GR_ARITHMOLACHEIO` "Αριθμολαχείο", `FAM_GR_POLYETHNIKO_TZAKPOT` "Πολυεθνικό Τζάκποτ", `FAM_GR_SYCHNES_KLIROSEIS` "Συχνές Κληρώσεις", `FAM_GR_XYSTO` "Ξυστό", `FAM_GR_PSIFIAKO_XYSTO` "Ψηφιακό Ξυστό"
  - AT: `FAM_AT_ZAHLENLOTTERIE` "Zahlenlotterie", `FAM_AT_LAENDER_JACKPOT` "Länderübergreifender Jackpot", `FAM_AT_SCHNELLZIEHUNG` "Schnellziehung", `FAM_AT_ZUSATZSPIEL` "Zusatzspiel", `FAM_AT_RUBBELLOS` "Rubbellos"
  - CZ: `FAM_CZ_CISELNA_LOTERIE` "Číselná loterie", `FAM_CZ_MEZINARODNI_JACKPOT` "Mezinárodní jackpot", `FAM_CZ_RYCHLA_CISLA` "Rychlá čísla", `FAM_CZ_STIRACI_LOS` "Stírací los"
- Exact category ids: UK `CAT_UK_DRAW` "Draw games", `CAT_UK_NUMBERS` "Number games", `CAT_UK_INSTANT` "Instant games"; GR `CAT_GR_KLIROSEIS` "Κληρώσεις", `CAT_GR_ARITHMOPAICHNIDIA` "Αριθμοπαιχνίδια", `CAT_GR_STIGMIAIA` "Στιγμιαία"; AT `CAT_AT_ZIEHUNG` "Ziehungsspiele", `CAT_AT_ZAHLEN` "Zahlenspiele", `CAT_AT_SOFORT` "Sofortspiele", `CAT_AT_ZUSATZ` "Zusatzprodukte"; CZ `CAT_CZ_LOSOVANI` "Losované hry", `CAT_CZ_CISLA` "Číselné hry", `CAT_CZ_OKAMZITE` "Okamžité výhry".
- Exact mechanic ids (`mechanic_code` is the local short code, description local language): UK `MECH_UK_NUMBER_MATCH`, `MECH_UK_QUICK_PICK`, `MECH_UK_SCRATCH`, `MECH_UK_INSTANT_ROUNDS`, `MECH_UK_SECOND_CHANCE`; GR `MECH_GR_EPILOGI_ARITHMON`, `MECH_GR_TYCHAIA_EPILOGI`, `MECH_GR_XYSIMO`, `MECH_GR_AMESOI_GYROI`; AT `MECH_AT_ZAHLENWAHL`, `MECH_AT_SCHNELLWAHL`, `MECH_AT_RUBBELN`, `MECH_AT_ZWEITE_CHANCE`; CZ `MECH_CZ_VYBER_CISEL`, `MECH_CZ_NAHODNY_TIP`, `MECH_CZ_STIRANI`.
- Exact incident type ids: corporate (market `None`, language `en`): `ITYPE_CORP_PAYMENT`, `ITYPE_CORP_APPLICATION`, `ITYPE_CORP_DRAW`, `ITYPE_CORP_IDENTITY`, `ITYPE_CORP_RETAIL`; per market the same five canonical kinds as `ITYPE_UK_PAYMENT_FAILURE`, `ITYPE_UK_APP_STABILITY`, `ITYPE_UK_DRAW_DELAY`, `ITYPE_UK_SIGN_IN`, `ITYPE_UK_TERMINAL`; `ITYPE_GR_PLIROMES`, `ITYPE_GR_EFARMOGI`, `ITYPE_GR_KLIROSI`, `ITYPE_GR_SYNDESI`, `ITYPE_GR_TERMATIKA`; `ITYPE_AT_ZAHLUNG`, `ITYPE_AT_APP`, `ITYPE_AT_ZIEHUNG`, `ITYPE_AT_ANMELDUNG`, `ITYPE_AT_TERMINAL`; `ITYPE_CZ_PLATBY`, `ITYPE_CZ_APLIKACE`, `ITYPE_CZ_LOSOVANI`, `ITYPE_CZ_PRIHLASENI`, `ITYPE_CZ_TERMINAL`.
- Exact support category ids: `SUPC_<MKT>_<SLUG>` for canonical `PAYMENT, ACCOUNT, GAME, TECHNICAL`: UK `PAYMENT, ACCOUNT, GAME, TECHNICAL`; GR `PLIROMI, LOGARIASMOS, PAICHNIDI, TECHNIKO`; AT `ZAHLUNG, KONTO, SPIEL, TECHNIK`; CZ `PLATBA, UCET, HRA, TECHNIKA`.
- Exact segment ids (kind VALUE then ENGAGEMENT, in canonical order): UK `SEG_UK_VIP, SEG_UK_MAINSTREAM, SEG_UK_BUDGET, SEG_UK_ENGAGED, SEG_UK_CASUAL, SEG_UK_DORMANT`; GR `SEG_GR_KORYFAIOI, SEG_GR_TAKTIKOI, SEG_GR_OIKONOMIKOI, SEG_GR_ENERGOI, SEG_GR_PERISTASIAKOI, SEG_GR_ADRANEIS`; AT `SEG_AT_TOPKUNDEN, SEG_AT_STAMMKUNDEN, SEG_AT_SPARSAM, SEG_AT_AKTIV, SEG_AT_GELEGENTLICH, SEG_AT_INAKTIV`; CZ `SEG_CZ_VIP, SEG_CZ_BEZNI, SEG_CZ_USPORNI, SEG_CZ_AKTIVNI, SEG_CZ_OBCASNI, SEG_CZ_NEAKTIVNI`. Local-language names chosen by the implementer.
- Exact payment providers: `PP_BLUEHARBOR` "BlueHarbor Payments" (home `None`), `PP_CONTINENTAL` "Continental Pay" (home `None`), `PP_NORTHGATE` "Northgate Payments" (`MKT_UK`), `PP_AEGEAN_PAY` "Aegean Pay" (`MKT_GR`), `PP_ALPENKASSE` "Alpenkasse" (`MKT_AT`), `PP_VLTAVA_PAY` "Vltava Pay" (`MKT_CZ`); all `platform_id = "PLT_PAYMENTS"`.
- `GAME_SPECS` keep their ids, names, prices and flags; `family_id`, `category_id` and `mechanics` become the market-local codes with the same meaning as today (for example `GAME_GR_01` -> `FAM_GR_ARITHMOLACHEIO`, `CAT_GR_KLIROSEIS`, `(MECH_GR_EPILOGI_ARITHMON, MECH_GR_TYCHAIA_EPILOGI)`).

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_taxonomies.py
from app.datasets import taxonomies
from app.datasets.master_data import GAME_SPECS, MARKETS

def test_every_local_code_belongs_to_one_market_and_its_language() -> None:
    languages = {m.market_id: m.primary_language for m in MARKETS}
    for family in taxonomies.GAME_FAMILIES:
        assert family.family_id.split("_")[1] == family.market_id[-2:]
        assert family.language_code == languages[family.market_id]

def test_no_family_code_is_shared_across_markets() -> None:
    ids = [f.family_id for f in taxonomies.GAME_FAMILIES]
    assert len(ids) == len(set(ids)) == 20

def test_game_specs_use_codes_of_their_own_market() -> None:
    families = {f.family_id: f.market_id for f in taxonomies.GAME_FAMILIES}
    mechanics = {m.mechanic_id: m.market_id for m in taxonomies.GAME_MECHANICS}
    for spec in GAME_SPECS:
        assert families[spec.family_id] == f"MKT_{spec.market_code}"
        assert all(mechanics[m] == f"MKT_{spec.market_code}" for m in spec.mechanics)

def test_incident_type_lookup_falls_back_to_corporate_for_cross_market() -> None:
    assert taxonomies.incident_type_for(None, "PAYMENT") == "ITYPE_CORP_PAYMENT"
    assert taxonomies.incident_type_for("MKT_GR", "PAYMENT") == "ITYPE_GR_PLIROMES"

def test_segments_for_returns_three_ids_in_canonical_order() -> None:
    assert taxonomies.segments_for("AT", "VALUE") == ("SEG_AT_TOPKUNDEN", "SEG_AT_STAMMKUNDEN", "SEG_AT_SPARSAM")
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_taxonomies.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement `taxonomies.py`; convert `MARKETS` to `MarketRow` instances; update `GAME_SPECS`**

Add `"app/datasets/taxonomies.py" = ["RUF001", "RUF003"]` to ruff per-file-ignores for intentional non-Latin text.

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/test_taxonomies.py -v`
Expected: PASS (other suites may now fail until Tasks 4 to 8 rewire the generators; do not commit until Task 8 is green, or stage each task and verify the whole suite at Task 8)

- [ ] **Step 5: Commit (together with Tasks 4 to 8 if the suite is red in between)**

```bash
git add backend/app/datasets/taxonomies.py backend/app/datasets/master_data.py backend/pyproject.toml backend/tests/test_taxonomies.py
git commit -m "feat(datasets): market-local taxonomies with local-language names"
```

---

### Task 4: Entities generator on named rows and local taxonomies

**Files:**
- Modify: `backend/app/datasets/entities.py`
- Test: `backend/tests/test_validation.py` (extend), `backend/tests/test_determinism.py`

**Interfaces:**
- `generate_master_rows() -> dict[str, list[tuple]]` now returns `markets, regions, currencies, languages, channels, suppliers, game_families, game_categories, game_mechanics, incident_types, support_categories, player_segments, payment_providers` built from `master_data` and `taxonomies` (no literal duplicates of market data).
- `generate_players_and_devices(rng, players_total, devices_total) -> dict[str, list[tuple]]` unchanged signature; players get `value_segment` and `engagement_segment` from `taxonomies.segments_for(code, kind)` with `distributions.VALUE_SEGMENT_WEIGHTS` and `ENGAGEMENT_SEGMENT_WEIGHTS`; every payment method row has a `provider_id` drawn from `distributions.PROVIDER_MIX[code]`; the shared pool (`PAY_SHARED_000` to `PAY_SHARED_079`) is emitted as real `payment_methods` rows with `provider_id = "PP_BLUEHARBOR"`, `payment_type = "WALLET"`, `created_at = WINDOW_START` midnight.
- All rows are `rows.*Row` instances.

- [ ] **Step 1: Write the failing tests**

```python
def test_shared_payment_pool_is_real_rows(tiny_world: World) -> None:
    ids = {row.payment_method_id for row in tiny_world.tables["payment_methods"]}
    assert {f"PAY_SHARED_{i:03d}" for i in range(80)} <= ids

def test_players_use_their_markets_segment_codes(tiny_world: World) -> None:
    for player in tiny_world.tables["players"]:
        assert player.value_segment.startswith(f"SEG_{player.market_id[-2:]}_")
        assert player.engagement_segment.startswith(f"SEG_{player.market_id[-2:]}_")

def test_payment_methods_reference_known_providers(tiny_world: World) -> None:
    providers = {row.provider_id for row in tiny_world.tables["payment_providers"]}
    assert all(row.provider_id in providers for row in tiny_world.tables["payment_methods"])
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_validation.py -v -k "shared or segment or providers"`
Expected: FAIL (`AttributeError: 'tuple' object has no attribute ...`)

- [ ] **Step 3: Rewrite `entities.py`**

Remove `_MARKET_RETAIL_SHARE`, `_MARKET_DEVICE_SHARE` locals (now in `distributions`); remove `_split` duplication only if `distributions` offers none (keep `_split` here, it is logic not a constant).

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/test_validation.py tests/test_determinism.py -v`
Expected: PASS for the three new tests; `test_tiny_world_passes_validation` passes once Task 5 removes the pool hack and Tasks 6 to 8 convert the other generators.

- [ ] **Step 5: Commit**

```bash
git add backend/app/datasets/entities.py backend/tests/test_validation.py
git commit -m "feat(datasets): entities on named rows, local segments, real payment providers"
```

---

### Task 5: Activity, operations and marketing generators on named rows

**Files:**
- Modify: `backend/app/datasets/activity.py`, `operations.py`, `marketing.py`, `validation.py`
- Test: `backend/tests/test_validation.py`

**Interfaces:**
- `activity.generate_draws(rng, games: list[GameRow]) -> list[DrawRow]`; base jackpot chosen by `game.jackpot_type_code` (`PROGRESSIVE` and multinational families keep today's amounts) rather than by family string matching; `activity._weighted_players` reads `distributions.ENGAGEMENT_ACTIVITY_BOOST[kind]` where kind comes from the segment's position in `segments_for(market, "ENGAGEMENT")` (index 0 engaged, 1 casual, 2 dormant); prize tiers use `master_data.PRIZE_TYPES` weights and multipliers (delete the duplicated tuple in `activity`).
- `operations.generate_incidents(rng, platforms, platform_versions, app_versions, games, total) -> tuple[list[IncidentRow], list[IncidentGameMapRow]]`; `incident_type` is `taxonomies.incident_type_for(market_id, canonical)` with the canonical kind from a `_CANONICAL_TYPE_BY_PLATFORM` map (`PLT_PAYMENTS -> PAYMENT`, app platforms -> `APPLICATION`, `PLT_WEB`/`PLT_IDENTITY` -> `IDENTITY`, `PLT_DRAW -> DRAW`, `PLT_RETAIL -> RETAIL`, `PLT_ANALYTICS -> APPLICATION`).
- `operations.generate_support_cases(...)` uses `taxonomies.support_category_for(market_id, canonical)` with canonical drawn uniformly from the four kinds.
- `operations.generate_experiments(rng, total: int) -> list[ExperimentRow]` (new `total` parameter; names cycle); `target_segment` is a local engagement segment of the experiment's market.
- `marketing.generate_campaigns(rng, games, per_market: int) -> dict[...]` (new `per_market`; objectives cycle through all four `CAMPAIGN_OBJECTIVES`); exposure ids use `schema.ID_FORMATS["campaign_exposures"]` (`EXPO_`).
- `validation.py`: `_segment_errors` validates against `player_segments` rows of the player's market; delete the shared-pool hack; `_currency_errors` and `_time_errors` use field names.

- [ ] **Step 1: Write the failing tests**

```python
def test_incident_types_are_market_local_or_corporate(tiny_world: World) -> None:
    for incident in tiny_world.tables["incidents"]:
        expected_prefix = "ITYPE_CORP_" if incident.market_id is None else f"ITYPE_{incident.market_id[-2:]}_"
        assert incident.incident_type.startswith(expected_prefix)

def test_exposure_ids_do_not_collide_with_experiments(tiny_world: World) -> None:
    assert all(row.exposure_id.startswith("EXPO_") for row in tiny_world.tables["campaign_exposures"])

def test_volume_targets_include_operational_volumes(tiny_world: World) -> None:
    volumes = PROFILES["tiny"]
    assert len(tiny_world.tables["incidents"]) == volumes.incidents
    assert len(tiny_world.tables["campaigns"]) == volumes.campaigns_per_market * 4
    assert len(tiny_world.tables["experiments"]) == volumes.experiments
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_validation.py -v`
Expected: FAIL

- [ ] **Step 3: Rewrite the three generators and validation on field names**

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/test_validation.py tests/test_determinism.py -v`
Expected: PASS except document-related assertions (Task 7 and 8)

- [ ] **Step 5: Commit**

```bash
git add backend/app/datasets/activity.py backend/app/datasets/operations.py backend/app/datasets/marketing.py backend/app/datasets/validation.py backend/tests/test_validation.py
git commit -m "feat(datasets): activity, operations and marketing on named rows and local codes"
```

---

### Task 6: Sentence-safe chunker

**Files:**
- Modify: `backend/app/datasets/util.py:17-24`
- Test: `backend/tests/test_chunking.py`

**Interfaces:**
- `split_sentences(body: str) -> list[str]`: splits on `.`, `!` or `?` followed by whitespace and an uppercase letter (Latin, Greek or Latin-extended) or a digit; never splits inside `1.50`, `5.3.0`, `e.g.`, `v2.1`.
- `chunk_text(body: str, max_words: int = 160, overlap_sentences: int = 1) -> list[str]`: packs whole sentences into windows of at most `max_words` words; consecutive windows share `overlap_sentences` trailing sentences; a single sentence longer than `max_words` becomes its own chunk; returns `[body]` for an empty split.
- Constants `CHUNK_MAX_WORDS = 160`, `CHUNK_OVERLAP_SENTENCES = 1` in `distributions.py`.

- [ ] **Step 1: Write the failing tests**

```python
from app.datasets.util import chunk_text, split_sentences

def test_decimal_prices_and_versions_survive() -> None:
    body = "Each ticket costs GBP 1.50 per line. Release 5.3.0 changed checkout, e.g. the card step. Done."
    assert split_sentences(body) == ["Each ticket costs GBP 1.50 per line.", "Release 5.3.0 changed checkout, e.g. the card step.", "Done."]
    assert chunk_text(body) == [body]

def test_greek_and_czech_sentences_split_on_boundaries() -> None:
    body = "Το Ξυστό πωλείται στα πρακτορεία. Η τιμή είναι 1,50 EUR. Číselná loterie se losuje dvakrát týdně."
    assert len(split_sentences(body)) == 3

def test_windows_overlap_by_one_sentence() -> None:
    sentences = [f"Sentence number {i} has exactly six words." for i in range(10)]
    chunks = chunk_text(" ".join(sentences), max_words=20)
    assert chunks[0].endswith(sentences[1]) and chunks[1].startswith(sentences[1])
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_chunking.py -v`
Expected: FAIL (`ImportError: split_sentences`)

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/test_chunking.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/datasets/util.py backend/app/datasets/distributions.py backend/tests/test_chunking.py
git commit -m "feat(datasets): sentence-safe overlapping chunker"
```

---

### Task 7: Coherent multilingual documents with local names

**Files:**
- Modify: `backend/app/datasets/documents.py` (rewrite)
- Test: `backend/tests/test_documents.py`

**Interfaces:**
- `class WorldIndex`: built from the generated tables; `games_by_market: dict[str, list[GameRow]]`, `incidents_by_market: dict[str | None, list[IncidentRow]]`, `campaigns_by_market`, `app_versions_by_market`, `experiments_by_market`, `family_name: dict[str, str]`, `mechanic_names: dict[str, list[str]]` (per game), `incident_type_name: dict[str, str]`, `segment_name: dict[str, str]`, `games_of_incident: dict[str, list[GameRow]]`, `incidents_of_game`, `campaigns_of_game`, `games_of_campaign`.
- `generate_documents(rng: random.Random, total: int, index: WorldIndex) -> tuple[list[DocumentRow], list[DocumentChunkRow]]`.
- Rules, each pinned by a test below:
  1. A market document's `market_id` equals its subject entity's market; corporate types (`POLICY`, `PLATFORM_DOCUMENTATION`, `TECHNICAL_INTEGRATION_NOTE`, `EXPERIMENT_REPORT`) have `market_id = None` and `language_code = "en"`.
  2. Market documents are in the market language with probability `1 - MARKET_DOCUMENT_ENGLISH_SHARE`, else English.
  3. Every entity mention renders as `name` with probability `MENTION_NAME_ONLY_SHARE`, else `name (id)`; the title always carries `name (id)`.
  4. Detail sentences reference only entities related to the subject (through `WorldIndex`); when the subject has no related entity of a kind, that sentence kind is skipped.
  5. No sentence repeats within a document (sample without replacement; the pool per language has at least 8 generic and 3 per subject kind sentences, so a 3 to 6 detail body never exhausts it).
  6. Documents mention the subject game's family local name and at least one mechanic local name when the subject is a game.
  7. `documents.sort(key=document_id)`, chunk ids `CHNK_{doc_number}_{index:02d}`.
- Keep `_TYPE_WEIGHTS`; move `_MARKET_LANGUAGE` to `taxonomies.MARKET_LANGUAGE`.

- [ ] **Step 1: Write the failing tests** (module fixture builds the tiny world once)

```python
def test_market_documents_match_their_subjects_market(tiny_world) -> None:
    by_id = {g.game_id: g for g in tiny_world.tables["games"]}
    for doc in tiny_world.tables["documents"]:
        if doc.document_type in ("PRODUCT_SPEC", "GAME_RULES"):
            game_id = doc.title.rsplit("(", 1)[1].rstrip(")")
            assert by_id[game_id].market_id == doc.market_id

def test_market_documents_use_market_language_most_of_the_time(tiny_world) -> None:
    market_docs = [d for d in tiny_world.tables["documents"] if d.market_id]
    local = sum(1 for d in market_docs if d.language_code != "en")
    assert local >= 0.5 * len(market_docs)

def test_game_documents_name_family_and_mechanic_locally(tiny_world) -> None:
    families = {f.family_id: f.name for f in tiny_world.tables["game_families"]}
    games = {g.game_id: g for g in tiny_world.tables["games"]}
    for doc in tiny_world.tables["documents"]:
        if doc.document_type == "GAME_RULES":
            game = games[doc.title.rsplit("(", 1)[1].rstrip(")")]
            assert families[game.game_family_id] in doc.body

def test_no_sentence_repeats_inside_a_document(tiny_world) -> None:
    from app.datasets.util import split_sentences
    for doc in tiny_world.tables["documents"]:
        sentences = split_sentences(doc.body)
        assert len(sentences) == len(set(sentences)), doc.document_id
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_documents.py -v`
Expected: FAIL

- [ ] **Step 3: Rewrite `documents.py`** with per-language template pools (`en`, `el`, `de`, `cs`), each a dict of `open`, `generic`, `game`, `incident`, `campaign`, `release`, `experiment`, `close` sentence templates using `{subject}`, `{game}`, `{family}`, `{mechanic}`, `{incident}`, `{incident_type}`, `{campaign}`, `{segment}`, `{app_version}`, `{platform_version}` placeholders.

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/test_documents.py tests/test_chunking.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/datasets/documents.py backend/app/datasets/taxonomies.py backend/tests/test_documents.py
git commit -m "feat(datasets): coherent multilingual documents with local product names"
```

---

### Task 8: World assembly, data dictionary and CLI on v2

**Files:**
- Modify: `backend/app/datasets/world.py`, `backend/app/datasets/__main__.py`, `backend/app/datasets/parquet.py` (accept NamedTuple rows; no change expected beyond typing)
- Test: `backend/tests/test_validation.py`, `backend/tests/test_determinism.py`, `backend/tests/test_truth_ledger_isolation.py`

**Interfaces:**
- `build_world(config) -> World` wires the new generators with the profile's `incidents`, `campaigns_per_market`, `experiments`; passes a `WorldIndex` to documents; `kpi_daily` derivation moves to `derive_kpis(world: World) -> None` (public, called at the end of `build_world` and again by the scenario engine after planting, Task 13).
- `build_data_dictionary() -> dict[str, Any]` returns `{"tables": [...existing per-field entries...], "foreign_keys": [{"child_table", "child_column", "parent_table", "nullable"}], "id_formats": {...}}`.
- Manifest gains `"generator_version": "0.2.0"` (automatic) and `"taxonomy": {"families": 20, "categories": 13, "mechanics": 16, "incident_types": 25, "support_categories": 16, "segments": 24, "providers": 6}` computed from the tables.

- [ ] **Step 1: Write the failing tests**

```python
def test_data_dictionary_exports_foreign_keys() -> None:
    from app.datasets.world import build_data_dictionary
    dictionary = build_data_dictionary()
    assert {"child_table", "child_column", "parent_table", "nullable"} <= set(dictionary["foreign_keys"][0])
    assert any(fk["child_table"] == "games" and fk["parent_table"] == "game_families" for fk in dictionary["foreign_keys"])

def test_tiny_world_passes_validation(tiny_world: World) -> None:
    assert validate_world(tiny_world) == []
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_validation.py tests/test_determinism.py tests/test_truth_ledger_isolation.py -v`
Expected: FAIL on the dictionary shape and any remaining tuple access

- [ ] **Step 3: Implement**

Update `test_truth_ledger_isolation.py::test_retrievable_artefacts_carry_no_ledger_fields` for the dictionary shape only if it reads it (it does not); the CLI test keeps passing once scenarios are converted in Task 13 (until then, skip nothing; run the subset).

- [ ] **Step 4: Run the whole backend suite**

Run: `cd backend && uv run pytest -q`
Expected: datasets tests PASS; `test_scenarios.py` and `test_graph_mapping.py` fail until Tasks 12 to 15 (record the exact failing test names in the commit body)

- [ ] **Step 5: Commit**

```bash
git add backend/app/datasets backend/tests
git commit -m "feat(datasets): world v2 assembly, dictionary with foreign keys, KPI derivation entry point"
```

---

### Task 9: Ontology model and loader

**Files:**
- Create: `backend/app/ontology/__init__.py` (`ONTOLOGY_VERSION = "2.0.0"`), `model.py`, `loader.py`
- Replace: `schemas/ontology/ontology.yaml`
- Modify: `backend/pyproject.toml` (add `pyyaml>=6.0.2` to dependencies and `types-pyyaml` to dev)
- Test: `backend/tests/test_ontology.py`

**Interfaces:**
- `model.Concept(concept_id: str, parent_id: str | None, concept_type: str, labels: dict[str, str], synonyms: dict[str, tuple[str, ...]], definition: str)` frozen dataclass; `labels` has keys `en, el, de, cs`.
- `model.Binding(kind: str, code: str, market_id: str | None, concept_id: str)` with `kind` in `family, category, mechanic, incident_type, support_category, segment, channel`.
- `model.Ontology(version: str, concepts: tuple[Concept, ...], bindings: tuple[Binding, ...])` with methods `concept(concept_id) -> Concept`, `children(concept_id) -> tuple[Concept, ...]`, `ancestors(concept_id) -> tuple[str, ...]` (nearest first), `concept_for(kind, code) -> str | None`, `codes_for(concept_id, kind=None) -> tuple[Binding, ...]`, `roots() -> tuple[Concept, ...]`.
- `loader.load_ontology(path: Path | None = None) -> Ontology` (default: `schemas/ontology/ontology.yaml` resolved from `REPO_ROOT`); raises `OntologyError` on unknown parent, duplicate id, missing language label, binding to unknown concept, or duplicate `(kind, code)`.
- YAML shape:

```yaml
ontology_version: "2.0.0"
created_at: "2026-10-18"
change_summary: "v2: hierarchy, four-language labels, synonyms, market-local bindings"
concepts:
  - id: CONCEPT_LOTTERY_PRODUCT
    parent: null
    type: Product
    labels: {en: Lottery product, el: Λαχειοφόρο προϊόν, de: Lotterieprodukt, cs: Loterijní produkt}
    synonyms: {en: [lottery game], el: [παιχνίδι λαχείου], de: [Lotteriespiel], cs: [loterijní hra]}
    definition: Any product sold by the operator whose outcome is decided by chance.
bindings:
  - {kind: family, code: FAM_GR_ARITHMOLACHEIO, market: MKT_GR, concept: CONCEPT_NATIONAL_DRAW}
```

- Exact concept tree (id, parent, type); labels, synonyms and definitions are written by the implementer in all four languages, at least one synonym per language per leaf:

```text
CONCEPT_LOTTERY_PRODUCT (null, Product)
  CONCEPT_DRAW_GAME (Product)
    CONCEPT_NATIONAL_DRAW
    CONCEPT_MULTINATIONAL_JACKPOT
    CONCEPT_ANNUITY_DRAW
    CONCEPT_FIXED_PRIZE_DRAW
  CONCEPT_HIGH_FREQUENCY_GAME (Product)
  CONCEPT_INSTANT_PRODUCT (Product)
    CONCEPT_RETAIL_INSTANT
    CONCEPT_DIGITAL_INSTANT
  CONCEPT_ADD_ON_PRODUCT (Product)
CONCEPT_GAME_MECHANIC (null, Mechanic)
  CONCEPT_NUMBER_SELECTION
  CONCEPT_QUICK_PICK
  CONCEPT_SYMBOL_REVEAL
  CONCEPT_INSTANT_ROUNDS
  CONCEPT_PROGRESSIVE_JACKPOT
  CONCEPT_SECOND_CHANCE
CONCEPT_INCIDENT (null, BusinessEvent)
  CONCEPT_PLATFORM_INCIDENT
    CONCEPT_PAYMENT_INCIDENT
    CONCEPT_APPLICATION_INCIDENT
    CONCEPT_IDENTITY_INCIDENT
    CONCEPT_DRAW_INCIDENT
    CONCEPT_RETAIL_INCIDENT
CONCEPT_SUPPORT_TOPIC (null, BusinessEvent)
  CONCEPT_PAYMENT_COMPLAINT
  CONCEPT_ACCOUNT_ACCESS
  CONCEPT_GAME_QUERY
  CONCEPT_TECHNICAL_FAULT
CONCEPT_PLAYER_SEGMENT (null, BusinessActor)
  CONCEPT_VALUE_SEGMENT
    CONCEPT_HIGH_VALUE
    CONCEPT_MAINSTREAM_VALUE
    CONCEPT_BUDGET_VALUE
  CONCEPT_ENGAGEMENT_SEGMENT
    CONCEPT_ENGAGED
    CONCEPT_CASUAL
    CONCEPT_DORMANT
CONCEPT_SALES_CHANNEL (null, Channel)
  CONCEPT_RETAIL_CHANNEL
  CONCEPT_DIGITAL_CHANNEL
```

- Exact bindings: families map by meaning (national draw families -> `CONCEPT_NATIONAL_DRAW`; multinational -> `CONCEPT_MULTINATIONAL_JACKPOT`; annuity -> `CONCEPT_ANNUITY_DRAW`; fixed prize -> `CONCEPT_FIXED_PRIZE_DRAW`; high frequency / rapid / schnell / rychlá -> `CONCEPT_HIGH_FREQUENCY_GAME`; scratch / xysto / rubbellos / stírací -> `CONCEPT_RETAIL_INSTANT`; online instant / psifiako xysto -> `CONCEPT_DIGITAL_INSTANT`; zusatzspiel -> `CONCEPT_ADD_ON_PRODUCT`); categories: draw -> `CONCEPT_DRAW_GAME`, numbers -> `CONCEPT_HIGH_FREQUENCY_GAME`, instant -> `CONCEPT_INSTANT_PRODUCT`, supplementary -> `CONCEPT_ADD_ON_PRODUCT`; mechanics by meaning to the six mechanic concepts (`CONCEPT_PROGRESSIVE_JACKPOT` has no mechanic binding; it binds nothing in v2 and stays for the jackpot type vocabulary); incident types by canonical kind to the five incident children, corporate ones included; support categories to the four support topics; segments by canonical position to the six segment leaves; channels `RETAIL -> CONCEPT_RETAIL_CHANNEL`, `APP -> CONCEPT_DIGITAL_CHANNEL`, `WEB -> CONCEPT_DIGITAL_CHANNEL` (market `None`).

- [ ] **Step 1: Write the failing tests**

```python
from app.ontology import ONTOLOGY_VERSION
from app.ontology.loader import load_ontology

def test_loads_v2_with_hierarchy_and_four_languages() -> None:
    onto = load_ontology()
    assert onto.version == ONTOLOGY_VERSION == "2.0.0"
    assert onto.ancestors("CONCEPT_PAYMENT_INCIDENT") == ("CONCEPT_PLATFORM_INCIDENT", "CONCEPT_INCIDENT")
    for concept in onto.concepts:
        assert set(concept.labels) == {"en", "el", "de", "cs"}

def test_equivalent_local_families_share_a_concept() -> None:
    onto = load_ontology()
    assert onto.concept_for("family", "FAM_GR_ARITHMOLACHEIO") == onto.concept_for("family", "FAM_AT_ZAHLENLOTTERIE") == "CONCEPT_NATIONAL_DRAW"

def test_loader_rejects_unknown_parent(tmp_path) -> None:
    import pytest
    from app.ontology.loader import OntologyError
    bad = tmp_path / "o.yaml"
    bad.write_text('ontology_version: "2.0.0"\nconcepts:\n  - {id: X, parent: NOPE, type: T, labels: {en: a, el: b, de: c, cs: d}, synonyms: {}, definition: z}\nbindings: []\n')
    with pytest.raises(OntologyError):
        load_ontology(bad)
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv sync && uv run pytest tests/test_ontology.py -v`
Expected: FAIL (`ModuleNotFoundError: app.ontology.loader`)

- [ ] **Step 3: Implement the package and write the YAML**

- [ ] **Step 4: Run tests and mypy**

Run: `cd backend && uv run pytest tests/test_ontology.py -v && uv run mypy`
Expected: PASS, no mypy issues

- [ ] **Step 5: Commit**

```bash
git add backend/app/ontology backend/pyproject.toml backend/uv.lock schemas/ontology/ontology.yaml backend/tests/test_ontology.py
git commit -m "feat(ontology): v2 ontology with hierarchy, four-language labels and market bindings"
```

---

### Task 10: Term table and concept similarity

**Files:**
- Create: `backend/app/ontology/terms.py`, `backend/app/ontology/similarity.py`
- Test: `backend/tests/test_ontology.py` (extend)

**Interfaces:**
- `terms.Term(text: str, language: str, concept_id: str, source: str)` with `source` in `label, synonym, local_name`.
- `terms.build_term_table(ontology: Ontology, local_names: Mapping[tuple[str, str], str]) -> tuple[Term, ...]`: one term per label and synonym per language, plus one `local_name` term per binding whose `(kind, code)` has an entry in `local_names` (the generator's taxonomy display names, passed in by the caller; the function never imports `app.datasets`). Terms are lower-cased, deduplicated on `(text, concept_id)`, sorted.
- `terms.TermMatcher(terms: Sequence[Term])` with `match(text: str) -> tuple[TermMatch, ...]` where `TermMatch(term: Term, start: int, end: int)`; whole-word, case-insensitive, longest match wins at a position, no overlapping matches; Unicode-aware word boundaries.
- `similarity.concept_similarity(a: GameConcepts, b: GameConcepts) -> float` with `GameConcepts(game_id: str, market_id: str, family_concept: str, category_concept: str, mechanic_concepts: frozenset[str])`: `0.4` if family concepts equal, `0.2` if category concepts equal, `0.4 * jaccard(mechanics)`; rounded to 3 places.
- `similarity.cross_market_similar(games: Sequence[GameConcepts], top_k: int = 3) -> list[SimilarEdge]` with `SimilarEdge(a_id, b_id, score, method="ontology_similarity_v2")`; excludes same market and zero scores; deterministic order.
- `similarity.METHOD = "ontology_similarity_v2"`.

- [ ] **Step 1: Write the failing tests**

```python
def test_term_matcher_finds_local_and_synonym_terms() -> None:
    onto = load_ontology()
    table = build_term_table(onto, {("family", "FAM_AT_ZAHLENLOTTERIE"): "Zahlenlotterie"})
    matcher = TermMatcher(table)
    hits = {m.term.concept_id for m in matcher.match("Wie läuft die Zahlenlotterie in Österreich?")}
    assert "CONCEPT_NATIONAL_DRAW" in hits

def test_term_matcher_is_whole_word_and_non_overlapping() -> None:
    matcher = TermMatcher([Term("draw game", "en", "CONCEPT_DRAW_GAME", "label"), Term("draw", "en", "CONCEPT_X", "label")])
    matches = matcher.match("A draw game and a withdrawal.")
    assert [m.term.concept_id for m in matches] == ["CONCEPT_DRAW_GAME"]

def test_similarity_links_equivalent_products_across_markets() -> None:
    gr = GameConcepts("GAME_GR_01", "MKT_GR", "CONCEPT_NATIONAL_DRAW", "CONCEPT_DRAW_GAME", frozenset({"CONCEPT_NUMBER_SELECTION", "CONCEPT_QUICK_PICK"}))
    at = GameConcepts("GAME_AT_01", "MKT_AT", "CONCEPT_NATIONAL_DRAW", "CONCEPT_DRAW_GAME", frozenset({"CONCEPT_NUMBER_SELECTION"}))
    assert concept_similarity(gr, at) == 0.8
    assert cross_market_similar([gr, at])[0].method == "ontology_similarity_v2"
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_ontology.py -v`
Expected: FAIL

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/test_ontology.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/ontology backend/tests/test_ontology.py
git commit -m "feat(ontology): multilingual term matcher and concept-based similarity"
```

---

### Task 11: Binding completeness between taxonomies and ontology

**Files:**
- Test: `backend/tests/test_ontology.py` (extend)
- Modify: `backend/app/datasets/taxonomies.py` (add `local_names() -> dict[tuple[str, str], str]` returning `(kind, code) -> name` for every local code)

- [ ] **Step 1: Write the failing test**

```python
def test_every_local_code_has_exactly_one_binding_and_vice_versa() -> None:
    from app.datasets.taxonomies import local_names
    onto = load_ontology()
    codes = set(local_names())
    bound = {(b.kind, b.code) for b in onto.bindings}
    assert codes == bound
    assert len(onto.bindings) == len(bound)
    assert all(onto.concept(b.concept_id) for b in onto.bindings)
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_ontology.py -v -k binding`
Expected: FAIL (missing `local_names` or mismatched sets)

- [ ] **Step 3: Implement `local_names()`; fix any binding gaps in the YAML**

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/test_ontology.py tests/test_taxonomies.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/datasets/taxonomies.py schemas/ontology/ontology.yaml backend/tests/test_ontology.py
git commit -m "test(ontology): every local code binds to exactly one concept"
```

---

### Task 12: Scenario planter with id allocator and non-encoding ids

**Files:**
- Create: `backend/app/scenarios/planter.py` (move `ScenarioPlanter` here, extended)
- Create: `backend/app/scenarios/inject_topology.py` (SCN-002, SCN-003 moved and converted), `inject_operations.py` (SCN-007 moved and converted), `inject_documents.py` (SCN-015 moved and converted)
- Modify: `backend/app/scenarios/plant.py` (becomes the registry only: `PLANTERS: dict[str, Callable[[ScenarioPlanter], None]]`)
- Test: `backend/tests/test_scenarios_v2.py` (new; delete `test_scenarios.py` at the end of this task)

**Interfaces:**
- `ScenarioPlanter.next_id(table: str) -> str`: returns the next id for the table from `schema.ID_FORMATS`, continuing after the current maximum numeric suffix in that table (computed once per table, cached, incremented on each call); for per-market formats (`devices`, `players`, `accounts`) the signature is `next_id(table, market_code=...)`.
- `ScenarioPlanter.chunk_rows(document: DocumentRow) -> list[DocumentChunkRow]` using `chunk_text`.
- `ScenarioPlanter.daily_mean(table: str, market_id: str) -> float`: mean rows per day over the window for the market (sessions, support_cases, tickets).
- `ScenarioPlanter.signal_count(base: int, daily_mean: float, share: float) -> int` returns `max(base, round(share * self.spec.strength * daily_mean))`.
- `ScenarioPlanter.local(kind: str, market_id: str, canonical: str) -> str` wraps `taxonomies.incident_type_for`, `support_category_for`, `segments_for`.
- Injector contract unchanged: fills `truth`, `required_evidence`, `affected_markets`, `affected_games`, `start_date`, `duration_days`, `planted_rows`.
- Seed-dependent targets (design 10a.5): every injector chooses its market, game, version or cluster with `plan.rng` from the eligible candidates listed in its rules; nothing names a fixed market or `[0]` game.
  SCN-002 market: any market with at least 8 active players; game: a digital game of that market.
  SCN-003 market: any market with at least 6 active players.
  SCN-007 primary market: one of `MKT_GR, MKT_AT, MKT_CZ`; the other two become the related markets with `MEDIUM` and `LOW` severity in rng order; the unaffected market is always `MKT_UK`; the platform version is the latest `PLT_PAYMENTS` version released at least 30 days before the window.
  SCN-015 game: any draw game whose price is at least 1.50 in its currency.
  `truth` records the chosen targets so grounding follows the ledger per world.
- Converted SCN-007 rules: incident ids from `next_id("incidents")`; documents from `next_id("documents")`; the GR document does not name other markets' incidents; the document body uses the market's local incident type name and the affected game's local family name; planted failing sessions per market `signal_count(8, daily_mean("sessions", market), 0.35)` spread over the incident duration; support cases `signal_count(6, daily_mean("support_cases", market), 0.5)`; no manual KPI adjustment (Task 13 derives KPIs after planting).
- Converted SCN-015: document id from the allocator; the body states the stale price with the local family name; `truth` unchanged in shape.
- Converted SCN-002 and SCN-003: device ids from `next_id("devices", market_code="CZ")`, ticket ids from `next_id("tickets")`; the shared instruments for SCN-003 are the two least used `PAY_SHARED_*` rows (unchanged rule).
- Truth records for every scenario gain `"planted_ids": {table: [ids...]}` so tests and later grounding never rely on prefixes.

- [ ] **Step 1: Write the failing tests** (fixture: tiny world seed 7 / scenario seed 7 with scenarios applied)

```python
def test_planted_ids_do_not_encode_scenarios(scenario_world) -> None:
    world, outcomes = scenario_world
    for outcome in outcomes.values():
        for table, ids in outcome.truth["planted_ids"].items():
            assert all("_S0" not in i for i in ids), (table, ids)

def test_planted_ids_continue_the_table_sequence(scenario_world) -> None:
    world, outcomes = scenario_world
    incident_ids = sorted(r.incident_id for r in world.tables["incidents"])
    numbers = [int(i.split("_")[1]) for i in incident_ids]
    assert numbers == list(range(1, len(numbers) + 1))

def test_scn007_documents_do_not_name_sibling_incidents(scenario_world) -> None:
    world, outcomes = scenario_world
    planted = outcomes["SCN-007"].truth["planted_ids"]
    docs = {d.document_id: d for d in world.tables["documents"]}
    gr_doc = docs[planted["documents"][0]]
    assert not any(inc in gr_doc.body for inc in planted["incidents"][1:])

def test_scenario_world_passes_validation(scenario_world) -> None:
    assert validate_world(scenario_world[0]) == []
```

Port the topology assertions of the old `test_scn002_*`, `test_scn003_*`, `test_scn015_*` tests to field names and `planted_ids`.

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_scenarios_v2.py -v`
Expected: FAIL

- [ ] **Step 3: Implement the planter split and conversions; delete `tests/test_scenarios.py`**

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/test_scenarios_v2.py tests/test_truth_ledger_isolation.py -v`
Expected: PASS except the KPI dip assertion (Task 13)

- [ ] **Step 5: Commit**

```bash
git add backend/app/scenarios backend/tests/test_scenarios_v2.py
git rm backend/tests/test_scenarios.py
git commit -m "refactor(scenarios): planter module, id allocator, sequence-continuing planted ids"
```

---

### Task 13: Derive KPIs after planting

**Files:**
- Modify: `backend/app/scenarios/engine.py` (`apply_scenarios` calls `derive_kpis(world)` after all injectors), `backend/app/scenarios/ledger.py` (`LEDGER_VERSION = "2"`)
- Test: `backend/tests/test_scenarios_v2.py`

- [ ] **Step 1: Write the failing test**

```python
def test_scn007_depresses_gr_session_completion_without_manual_edits(scenario_world) -> None:
    world, outcomes = scenario_world
    baseline = build_world(GenerationConfig(profile="tiny", world_seed=7, scenario_seed=7))
    outcome = outcomes["SCN-007"]
    dip_days = {outcome.start_date + timedelta(days=o) for o in range(outcome.duration_days)}
    def completion(table):
        return {r.date: r.metric_value for r in table if r.market_id == "MKT_GR" and r.metric_code == "session_completion"}
    before, after = completion(baseline.tables["kpi_daily"]), completion(world.tables["kpi_daily"])
    dipped = [d for d in dip_days if d in before and d in after and after[d] <= 0.85 * before[d]]
    assert len(dipped) >= 2
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_scenarios_v2.py -v -k depresses`
Expected: FAIL

- [ ] **Step 3: Implement**

`derive_kpis` replaces `world.tables["kpi_daily"]` entirely; `world.planted["kpi_daily"]` is set to the difference in row count so volume validation holds.

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/test_scenarios_v2.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/scenarios/engine.py backend/app/scenarios/ledger.py backend/tests/test_scenarios_v2.py
git commit -m "feat(scenarios): derive KPIs after planting so planted facts produce their own signals"
```

---

### Task 14: Injectors SCN-001 and SCN-009

**Files:**
- Modify: `backend/app/scenarios/inject_operations.py`, `backend/app/scenarios/plant.py` (register), `backend/app/scenarios/catalogue.py` (enable `SCN-001`, `SCN-009`)
- Test: `backend/tests/test_scenarios_v2.py`

**Interfaces and rules:**
- `plant_app_release_conversion_failure(plan)` (SCN-001), market drawn by `plan.rng` from the four markets, app version drawn from that market's versions released between day 20 and day 250 (so a 10-day window plus documents fit), cohort `device_family` drawn from `("ANDROID", "IOS")`; the rules below are written for the AT/5.3.1/Android case and apply to whichever is drawn:
  - window starts the day after the app version's `released_at`, lasts 10 days;
  - failing sessions: `signal_count(12, daily_mean("sessions", "MKT_AT"), 0.4)` rows per day for the first 6 days, outcome `ABANDONED` (70 percent) or `FAIL_PAYMENT` (30 percent), channel `APP`, `app_version_id = APPV_AT_531`, device chosen from the player's Android devices (players without one get a planted Android device link);
  - support cases: `signal_count(8, daily_mean("support_cases", "MKT_AT"), 0.6)` with category `local("support_category", "MKT_AT", "TECHNICAL")`, opened within the window, `summary_text` in German naming the app version label;
  - a `RELEASE_NOTE` document (de) for `APPV_AT_531` created on release day mentioning the changed checkout component and the app version id; an `INCIDENT_REPORT` (de) created on day 5;
  - an incident on day 4: `platform_id = PLT_APP_ANDROID`, `app_version_id = APPV_AT_531`, `platform_version_id = None`, type `local("incident_type", "MKT_AT", "APPLICATION")`, severity `HIGH`, resolved on day 10, `incident_game_map` for the two AT digital games;
  - truth: `app_version_id`, `device_family`, `incident_id`, `release_note_id`, `incident_report_id`, `planted_ids`, `expected_interpretation`;
  - required evidence: app version id, incident id, release note id, `kpi:MKT_AT:session_completion`.
- `plant_payment_provider_degradation(plan)` (SCN-009), provider drawn by `plan.rng` from the providers with `home_market_id is None` (`PP_BLUEHARBOR`, `PP_CONTINENTAL`), markets = the three markets with the most methods on that provider:
  - window: 14 days starting day 230; intermittent: planted rows only on even days;
  - per market: pick players whose payment method has `provider_id == PP_CONTINENTAL` (raise `RuntimeError` naming the scenario if fewer than 4); failing sessions `signal_count(6, daily_mean("sessions", market), 0.25)` per active day with outcome `FAIL_PAYMENT`; support cases `signal_count(4, daily_mean("support_cases", market), 0.4)` with the market's `PAYMENT` category and a local-language summary that does not name the provider;
  - a corporate `POST_INCIDENT_REVIEW` (en) on day 245 naming the provider id and the three markets;
  - no incident row is planted (the point of the scenario is that symptoms arrive before an incident);
  - truth: `provider_id`, `affected_markets`, `active_days`, `planted_ids`, `expected_interpretation`;
  - required evidence: provider id, the post-incident review id, one planted support case id per market.

- [ ] **Step 1: Write the failing tests**

```python
def test_scn001_cohort_sessions_are_android_on_the_release(scenario_world) -> None:
    world, outcomes = scenario_world
    truth = outcomes["SCN-001"].truth
    devices = {d.device_id: d for d in world.tables["devices"]}
    planted = [s for s in world.tables["sessions"] if s.session_id in set(truth["planted_ids"]["sessions"])]
    assert planted and all(s.app_version_id == truth["app_version_id"] for s in planted)
    assert all(devices[s.device_id].device_family == "ANDROID" for s in planted)

def test_scn009_failures_share_one_provider_across_three_markets(scenario_world) -> None:
    world, outcomes = scenario_world
    truth = outcomes["SCN-009"].truth
    method_provider = {m.payment_method_id: m.provider_id for m in world.tables["payment_methods"]}
    player_methods = {}
    for link in world.tables["player_payment_method"]:
        player_methods.setdefault(link.player_id, set()).add(method_provider[link.payment_method_id])
    planted = [s for s in world.tables["sessions"] if s.session_id in set(truth["planted_ids"]["sessions"])]
    assert {s.market_id for s in planted} == set(truth["affected_markets"]) == {"MKT_GR", "MKT_AT", "MKT_CZ"}
    assert all(truth["provider_id"] in player_methods[s.player_id] for s in planted)

def test_scenarios_fail_loudly_when_the_world_is_too_small() -> None:
    import pytest
    from app.datasets.config import GenerationConfig, ProfileVolumes, PROFILES
    PROFILES["micro"] = ProfileVolumes(12, 100, 50, 50, 8, 12, 6, 6, 20, 25, 3, 6)
    try:
        world = build_world(GenerationConfig(profile="micro", world_seed=1, scenario_seed=1))
        with pytest.raises(RuntimeError, match="SCN-"):
            apply_scenarios(world)
    finally:
        del PROFILES["micro"]
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_scenarios_v2.py -v -k "scn001 or scn009 or too_small"`
Expected: FAIL

- [ ] **Step 3: Implement both injectors and enable them in the catalogue**

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/test_scenarios_v2.py tests/test_validation.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/scenarios backend/tests/test_scenarios_v2.py
git commit -m "feat(scenarios): plant SCN-001 app release failure and SCN-009 provider degradation"
```

---

### Task 15: Injectors SCN-010 and SCN-011 (ontology-dependent)

**Files:**
- Create: `backend/app/scenarios/inject_ontology.py`
- Modify: `backend/app/scenarios/plant.py` (register), `catalogue.py` (enable `SCN-010`, `SCN-011`)
- Test: `backend/tests/test_scenarios_v2.py`

**Interfaces and rules:**
- `plant_game_mechanic_affinity(plan)` (SCN-010): mechanic meaning drawn by `plan.rng` from `("symbol reveal", "quick pick")` (local codes resolved through `taxonomies`, for symbol reveal `MECH_GR_XYSIMO`, `MECH_AT_RUBBELN`, `MECH_CZ_STIRANI`, `MECH_UK_SCRATCH`), segment meaning "engaged" (`segments_for(code, "ENGAGEMENT")[0]` per market), markets = three markets drawn from those that have a game with that mechanic (the fourth market is the control and gets nothing):
  - per market: the one game whose mechanics include the local symbol-reveal code (raise if none); planted tickets for `n = signal_count(10, daily_mean("tickets", market), 0.2)` engaged-segment players, 3 tickets each over days 60 to 240 on that game, channel per the game's flags;
  - one `MONTHLY_MARKET_REVIEW` document per market in the market language, created on day 250, stating that the engaged segment (local segment name) over-indexes on the symbol-reveal product (local game name and local mechanic description), mentioning the game by name only (no id);
  - the injector never writes a concept id anywhere in the world;
  - truth: `mechanic_concept = "CONCEPT_SYMBOL_REVEAL"`, `segment_concept = "CONCEPT_ENGAGED"`, `per_market: {market: {game_id, mechanic_code, segment_id, document_id, planted_ticket_count}}`, `planted_ids`, `uplift_note`;
  - required evidence: the three game ids and the three document ids.
- `plant_transferable_campaign(plan)` (SCN-011): source and target markets drawn by `plan.rng` as an ordered pair of distinct markets that both have a retail instant game (the rules below name GR and AT for concreteness):
  - source campaign: new `CMP` row (id from allocator), objective `OBJ_CROSS_SELL`, promotes the GR retail instant game (`FAM_GR_XYSTO`), window days 100 to 140, budget mid-range; exposures: `signal_count(40, daily_mean("campaign_exposures", "MKT_GR"), 0.5)` rows to GR engaged-segment players with `engaged = True` for 70 percent and conversion to the promoted game for 45 percent of engaged (both far above `distributions` baselines);
  - a `CAMPAIGN_EVALUATION` document (el) created on day 150 describing the success with the local segment name and local game name (name only);
  - the AT counterpart exists in the base world by construction: the AT retail instant game (`FAM_AT_RUBBELLOS`) and the AT engaged segment; the injector asserts both exist and plants nothing in AT;
  - truth: `source_campaign_id`, `source_game_id`, `source_segment_id`, `target_market = "MKT_AT"`, `target_game_id`, `target_segment_id`, `concept_chain = ["CONCEPT_RETAIL_INSTANT", "CONCEPT_ENGAGED"]`, `planted_ids`, `expected_interpretation` (a recommendation with stated confidence, not certainty);
  - required evidence: source campaign id, source game id, target game id, evaluation document id.

- [ ] **Step 1: Write the failing tests**

```python
def test_scn010_uses_three_local_mechanic_codes_for_one_concept(scenario_world) -> None:
    from app.ontology.loader import load_ontology
    world, outcomes = scenario_world
    truth = outcomes["SCN-010"].truth
    onto = load_ontology()
    codes = {m["mechanic_code"] for m in truth["per_market"].values()}
    assert len(codes) == 3
    assert {onto.concept_for("mechanic", c) for c in codes} == {truth["mechanic_concept"]}

def test_scn010_documents_are_local_language_and_name_only(scenario_world) -> None:
    world, outcomes = scenario_world
    truth = outcomes["SCN-010"].truth
    docs = {d.document_id: d for d in world.tables["documents"]}
    for market, detail in truth["per_market"].items():
        doc = docs[detail["document_id"]]
        assert doc.language_code == {"MKT_GR": "el", "MKT_AT": "de", "MKT_CZ": "cs"}[market]
        assert detail["game_id"] not in doc.body

def test_scn011_source_campaign_outperforms_baseline(scenario_world) -> None:
    world, outcomes = scenario_world
    truth = outcomes["SCN-011"].truth
    rows = [e for e in world.tables["campaign_exposures"] if e.campaign_id == truth["source_campaign_id"]]
    engaged = [e for e in rows if e.engaged]
    assert len(engaged) / len(rows) >= 0.6
    assert sum(1 for e in engaged if e.converted_game_id == truth["source_game_id"]) / len(engaged) >= 0.4

def test_no_planted_row_contains_a_concept_id(scenario_world) -> None:
    world, _ = scenario_world
    for table, rows in world.tables.items():
        for row in rows:
            assert "CONCEPT_" not in " ".join(str(v) for v in row), table
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_scenarios_v2.py -v -k "scn010 or scn011 or concept_id"`
Expected: FAIL

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/test_scenarios_v2.py tests/test_validation.py tests/test_truth_ledger_isolation.py -v`
Expected: PASS; the CLI isolation test lists eight enabled scenarios

- [ ] **Step 5: Commit**

```bash
git add backend/app/scenarios backend/tests/test_scenarios_v2.py
git commit -m "feat(scenarios): plant SCN-010 mechanic affinity and SCN-011 transferable campaign"
```

---

### Task 16: Graph mapping and statements for the v2 model

**Files:**
- Modify: `backend/app/graph/mapping.py` (delete `FAMILY_TO_CONCEPT`, `MECHANIC_TO_CONCEPT`, `SEGMENT_TO_CONCEPT`, `CHANNEL_TO_CONCEPT`, `INCIDENT_TYPE_TO_CONCEPT`, `CONCEPT_CANONICAL_NAMES`, `similarity_score`, `cross_market_similar_games`, `METHOD_SIMILARITY`; add `game_concepts(game, mechanics, ontology) -> GameConcepts`, `concept_node_rows(ontology) -> list[dict]`, `is_a_rows(ontology) -> list[dict]`, `maps_to_rows(ontology, kind, label) -> list[dict]`, `similar_to_rows(games, mechanic_map, ontology) -> list[dict]`)
- Modify: `backend/app/graph/statements.py` (`NODE_LABELS` adds `IncidentType`, `SupportCategory`, `PaymentProvider`; `RELATIONSHIP_TYPES` adds `IS_A`, `OF_TYPE`, `CATEGORISED_AS`, `PROVIDED_BY`; add statements `SCHEMA_LABEL_COUNTS`, `SCHEMA_RELATIONSHIP_COUNTS`, `ONTOLOGY_TREE`, `ONTOLOGY_BINDING_COUNTS`; add `ORDER BY` to `RETRIEVAL_CONCEPTS` and `RETRIEVAL_MARKETS`; `RETRIEVAL_CONCEPTS` returns `id, canonical_name, labels_en, labels_el, labels_de, labels_cs, synonyms, parent_id`)
- Modify: `schemas/graph/graph-schema.yaml` (as built: labels, relationship types, removed `Rule`, `PREFERS`, `DESCRIBES`, `DEFINES`, `ABOUT`, `EQUIVALENT_TO`)
- Test: `backend/tests/test_graph_mapping.py` (rewrite), `backend/tests/test_graph_statements.py`

**Interfaces:**
- `BusinessConcept` node properties: `id, canonical_name (labels.en), concept_type, parent_id, definition, label_en, label_el, label_de, label_cs, synonyms (list[str], all languages, prefixed "el:" etc.), ontology_version, source_system="ontology", source_table="ontology.yaml", source_record_id=id`.
- Edge model (type, from, to): `IS_A (BusinessConcept -> BusinessConcept)`; `MAPS_TO (GameFamily|GameCategory|GameMechanic|IncidentType|SupportCategory|PlayerSegment|Channel -> BusinessConcept)` with props `{ontology_version}`; `SIMILAR_TO (Game -> Game)` with props `{score, method, ontology_version}`; `OF_TYPE (Incident -> IncidentType)`; `CATEGORISED_AS (SupportCase -> SupportCategory)`; `PROVIDED_BY (PaymentMethod -> PaymentProvider)`; `Game -INSTANCE_OF-> BusinessConcept` is removed; `Incident -MAPS_TO-> BusinessConcept` is removed (replaced by `OF_TYPE` then `MAPS_TO`).
- `ONTOLOGY_RELATIONSHIP_TYPES: tuple[str, ...] = ("MAPS_TO", "SIMILAR_TO", "IS_A")` exported from `statements.py` (single source for the B/C split in Task 19).

- [ ] **Step 1: Write the failing tests**

```python
def test_concept_rows_carry_four_labels_and_parent() -> None:
    onto = load_ontology()
    rows = {r["id"]: r for r in mapping.concept_node_rows(onto)}
    row = rows["CONCEPT_PAYMENT_INCIDENT"]
    assert row["parent_id"] == "CONCEPT_PLATFORM_INCIDENT"
    assert all(row[f"label_{lang}"] for lang in ("en", "el", "de", "cs"))
    assert row["ontology_version"] == "2.0.0"

def test_maps_to_rows_cover_every_binding_kind() -> None:
    onto = load_ontology()
    kinds = {"family": "GameFamily", "category": "GameCategory", "mechanic": "GameMechanic", "incident_type": "IncidentType", "support_category": "SupportCategory", "segment": "PlayerSegment", "channel": "Channel"}
    total = sum(len(mapping.maps_to_rows(onto, kind, label)) for kind, label in kinds.items())
    assert total == len(onto.bindings)

def test_similar_to_is_ontology_derived_and_cross_market(tiny_world) -> None:
    onto = load_ontology()
    rows = mapping.similar_to_rows([g._asdict() for g in tiny_world.tables["games"]], [m._asdict() for m in tiny_world.tables["game_mechanic_map"]], onto)
    assert rows and all(r["props"]["method"] == "ontology_similarity_v2" for r in rows)
    market = {g.game_id: g.market_id for g in tiny_world.tables["games"]}
    assert all(market[r["a_id"]] != market[r["b_id"]] for r in rows)

def test_ontology_relationship_types_are_declared() -> None:
    from app.graph.statements import ONTOLOGY_RELATIONSHIP_TYPES, RELATIONSHIP_TYPES
    assert set(ONTOLOGY_RELATIONSHIP_TYPES) <= set(RELATIONSHIP_TYPES)
    assert "OF_TYPE" in RELATIONSHIP_TYPES and "IncidentType" in NODE_LABELS
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_graph_mapping.py tests/test_graph_statements.py -v`
Expected: FAIL

- [ ] **Step 3: Implement; update `graph-schema.yaml`; remove or update `app/graph/cypher/*.cypher` that reference removed codes**

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/test_graph_mapping.py tests/test_graph_statements.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/graph/mapping.py backend/app/graph/statements.py backend/app/graph/cypher schemas/graph/graph-schema.yaml backend/tests/test_graph_mapping.py backend/tests/test_graph_statements.py
git commit -m "feat(graph): v2 mapping with ontology-derived concepts, bindings and similarity"
```

---

### Task 17: Ingestion v2 with validity windows, new labels and linear row building

**Files:**
- Modify: `backend/app/graph/ingest.py` (split `build_relationship_rows` into `app/graph/relationship_rows.py` and `build_node_rows` into `app/graph/node_rows.py`; `ingest.py` keeps the driver loop, verification and `IngestStats`)
- Modify: `backend/app/graph/__main__.py` (write `_graph_stats.json` beside the dataset: `{ingestion_version, label_version, ontology_version, nodes: {label: count}, relationships: [{type, from, to, count}]}`)
- Modify: `backend/app/graph/config.py` (`LABEL_VERSION = "v2"`)
- Test: `backend/tests/test_graph_ingestion.py` (live, `GRAPH_E2E`), plus offline tests in `tests/test_graph_mapping.py` for row builders

**Interfaces:**
- `node_rows.build_node_rows(tables, ontology) -> dict[str, list[dict]]`: adds `IncidentType`, `SupportCategory`, `PaymentProvider`, `PlayerSegment` (from the table, not master data), `GameFamily/GameCategory/GameMechanic` with `market_id`, `name`, `language_code`; `BusinessConcept` from `mapping.concept_node_rows`; validity: `Game.valid_from = launch_date`, `Game.valid_to = retirement_date`, `PlatformVersion.valid_from = released_at`, `valid_to = retired_at`, `AppVersion.valid_from = released_at`, `Incident.valid_from = started_at`, `valid_to = resolved_at`, `Campaign.valid_from = start_at`, `valid_to = end_at`, `Document.valid_from`, `valid_to` from the row, `Experiment.valid_from/valid_to`; `source_timestamp` set from `created_at`, `started_at`, `opened_at`, `released_at`, `registration_date` or `first_seen_at` where the table has one.
- `relationship_rows.build_relationship_rows(tables, ontology) -> dict[RelationshipKey, list[dict]]`: linear accumulation (`rels.setdefault(key, []).append(row)`), the new edges from Task 16, `HAS_MECHANIC` props gain `valid_to`.
- `_verify_counts` compares against distinct `(a_id, b_id)` pairs per key so MERGE-collapsed duplicates do not fail verification.
- `ingest(...)` loads the ontology once via `load_ontology()`.

- [ ] **Step 1: Write the failing tests**

```python
def test_node_rows_carry_validity_and_source_timestamp(tiny_world) -> None:
    tables = {name: [r._asdict() for r in rows] for name, rows in tiny_world.tables.items()}
    nodes = build_node_rows(tables, load_ontology())
    game = nodes["Game"][0]
    assert "valid_from" in game and "source_timestamp" not in game or game["source_timestamp"]
    incident = nodes["Incident"][0]
    assert incident["valid_from"] == incident["started_at"]
    assert nodes["IncidentType"] and nodes["PaymentProvider"] and nodes["BusinessConcept"]

def test_relationship_rows_have_no_game_to_concept_instance_edges(tiny_world) -> None:
    tables = {name: [r._asdict() for r in rows] for name, rows in tiny_world.tables.items()}
    rels = build_relationship_rows(tables, load_ontology())
    assert ("INSTANCE_OF", "Game", "BusinessConcept") not in rels
    assert ("OF_TYPE", "Incident", "IncidentType") in rels
    assert ("MAPS_TO", "GameFamily", "BusinessConcept") in rels

def test_relationship_building_is_linear() -> None:
    import time
    tables = synthetic_tables(players=20_000)  # helper in the test module building minimal dict rows
    started = time.perf_counter()
    build_relationship_rows(tables, load_ontology())
    assert time.perf_counter() - started < 2.0
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_graph_mapping.py -v -k "node_rows or relationship"`
Expected: FAIL

- [ ] **Step 3: Implement the split and the changes; update the live ingestion test's expected label set**

- [ ] **Step 4: Run offline tests, then live if services are up**

Run: `cd backend && uv run pytest tests/test_graph_mapping.py -v`
Expected: PASS
Run (optional, needs Docker): `docker compose up -d && cd backend && GRAPH_E2E=1 uv run pytest tests/test_graph_ingestion.py -v`
Expected: PASS; record whether this ran in the commit body

- [ ] **Step 5: Commit**

```bash
git add backend/app/graph backend/tests/test_graph_mapping.py backend/tests/test_graph_ingestion.py
git commit -m "feat(graph): ingestion v2 with validity windows, taxonomy labels and persisted stats"
```

---

### Task 18: Source lookup, demo question and bank 1.0 grounding kept honest

**Files:**
- Modify: `backend/app/retrieval/graph/source_lookup.py` (`NODE_SOURCES` adds `PaymentProvider -> payment_providers`, `IncidentType -> incident_types`, `GameFamily -> game_families`; `SNIPPET_COLUMNS` for them; `games` snippet adds `game_family_id` local name through a join is out of scope; keep ids)
- Modify: `backend/app/evaluation/grounding.py:131-147` (family codes `FAM_UK_NATIONAL_DRAW`, `FAM_UK_ANNUITY`, `FAM_GR_SYCHNES_KLIROSEIS`), `ground()` (a missing `_ground_qNN` returns `status="not_grounded"` with note `"bank 1.0 has no grounding rule for {question_id}; replaced by bank 2.0.0 in Phase 3"`), `_ground_q25/_q28/_q30` read planted ids from `truth["planted_ids"]` instead of literal `INC_S007_*` / `DOC_S015_UK`
- Modify: `backend/app/api/queries.py` (DEMO-02 and DEMO-03 texts reference the entity by description plus the id resolved from the demo world is not possible offline; replace the literal `INC_S007_GR` with `the Greek payment checkout incident on platform version PLV_PAYMENTS_3` and keep `PLV_PAYMENTS_3`; DEMO-03 keeps `PLAYER_GR_001283` only if that player exists in the dev world, otherwise use the first GR player id; add a comment that Phase 3 replaces these with bank 2.0.0 questions)
- Test: `backend/tests/test_benchmark_grounding.py` (`statuses["Q17"] == "not_grounded"`; whole bank resolves), `tests/test_api_queries.py`

- [ ] **Step 1: Update the tests to the v2 expectations and run them**

Run: `cd backend && uv run pytest tests/test_benchmark_grounding.py tests/test_benchmark_scoring.py tests/test_api_queries.py tests/test_failure_modes.py tests/test_standard_rag.py tests/test_graph_rag.py -v`
Expected: FAIL on grounding family codes and the missing-rule crash

- [ ] **Step 2: Implement**

- [ ] **Step 3: Run the whole suite**

Run: `cd backend && uv run pytest -q`
Expected: all offline tests PASS

- [ ] **Step 4: Commit**

```bash
git add backend/app/retrieval/graph/source_lookup.py backend/app/evaluation/grounding.py backend/app/api/queries.py backend/tests
git commit -m "chore: keep bank 1.0 grounding and demo questions reporting correctly on world v2"
```

---

### Task 19: Clean B/C split in configuration

**Files:**
- Modify: `backend/app/config/__init__.py` (`DEFAULT_RELATIONSHIP_TYPES` adds `OF_TYPE`, `CATEGORISED_AS`, `PROVIDED_BY`, `RELATED_TO_APP_VERSION`, `IS_A`, `USES`, `USES_PAYMENT`, keeps `MAPS_TO`, `SIMILAR_TO`; `GraphRagSettings.without_ontology()` removes every type in `statements.ONTOLOGY_RELATIONSHIP_TYPES`)
- Modify: `backend/app/retrieval/graph/lab.py` (`bc_graph_settings(base)` loses the `profile` parameter and uses `ONTOLOGY_RELATIONSHIP_TYPES`; delete `FRAUD_RELATIONSHIP_TYPES` and `graph_relationships`; update callers in `traces.py`, `evaluation/runner.py`, `api/runs.py`; `BankQuestion.profile` stays unused until Phase 3 removes it)
- Modify: `backend/app/retrieval/graph/traversal.py:RELATIONSHIP_WEIGHTS` (add `OF_TYPE 0.7`, `CATEGORISED_AS 0.6`, `PROVIDED_BY 0.8`, `RELATED_TO_APP_VERSION 0.9`, `IS_A 0.4`)
- Test: `backend/tests/test_lab_fairness.py`

- [ ] **Step 1: Write the failing test**

```python
def test_b_excludes_every_ontology_relationship_and_nothing_else() -> None:
    from app.graph.statements import ONTOLOGY_RELATIONSHIP_TYPES
    settings_b, settings_c = bc_graph_settings(base)
    assert set(settings_c.graph.relationship_types) - set(settings_b.graph.relationship_types) == set(ONTOLOGY_RELATIONSHIP_TYPES)
    assert not settings_b.graph.ontology_expansion and settings_c.graph.ontology_expansion
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_lab_fairness.py -v`
Expected: FAIL (`SIMILAR_TO` and `IS_A` still in B; `USES_PAYMENT` missing from the default list)

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/test_lab_fairness.py tests/test_graph_rag.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/config/__init__.py backend/app/retrieval/graph/lab.py backend/app/retrieval/graph/traversal.py backend/tests/test_lab_fairness.py
git commit -m "feat(retrieval): pipeline B excludes every ontology relationship type"
```

---

### Task 20: Golden-hash determinism across processes

**Files:**
- Create: `backend/tests/fixtures/golden/tiny-seed7.json` (`{"generator_version": "0.2.0", "ontology_version": "2.0.0", "ledger_version": "2", "tables": {table: sha256}, "ledger": sha256}`)
- Create: `backend/tests/test_golden_world.py`
- Create: `backend/scripts/golden.py` (writes the fixture; run deliberately when the generator version changes)

**Interfaces:**
- `scripts/golden.py --profile tiny --world-seed 7 --scenario-seed 7 --out tests/fixtures/golden/tiny-seed7.json` generates in a subprocess (`python -m app.datasets ... --output-dir <tmp> --truth-path <tmp>/ledger.json`) and hashes each Parquet file's bytes and the ledger bytes.

- [ ] **Step 1: Write the failing test**

```python
def test_fresh_process_regeneration_matches_golden_hashes(tmp_path) -> None:
    golden = json.loads((FIXTURES / "tiny-seed7.json").read_text())
    assert golden["generator_version"] == GENERATOR_VERSION, "bump the fixture with scripts/golden.py when the generator changes"
    subprocess.run([sys.executable, "-m", "app.datasets", "--profile", "tiny", "--world-seed", "7", "--scenario-seed", "7", "--output-dir", str(tmp_path), "--truth-path", str(tmp_path / "ledger.json")], check=True, cwd=BACKEND)
    world_dir = tmp_path / "tiny-seed7"
    for table, digest in golden["tables"].items():
        assert hashlib.sha256((world_dir / f"{table}.parquet").read_bytes()).hexdigest() == digest, table
    assert hashlib.sha256((tmp_path / "ledger.json").read_bytes()).hexdigest() == golden["ledger"]
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_golden_world.py -v`
Expected: FAIL (fixture missing)

- [ ] **Step 3: Implement the script, generate the fixture, run the test twice**

If Parquet bytes differ between two runs of identical data, make `parquet.write_world` pass deterministic writer options (no creation timestamp metadata) and re-check; the test must pass twice in a row before committing.

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/test_golden_world.py -v && uv run pytest tests/test_golden_world.py -v`
Expected: PASS both times

- [ ] **Step 5: Commit**

```bash
git add backend/tests/fixtures/golden backend/tests/test_golden_world.py backend/scripts/golden.py backend/app/datasets/parquet.py
git commit -m "test(datasets): golden hashes pin cross-process determinism of world and ledger"
```

---

### Task 21: Isolation test covers the ontology package

**Files:**
- Modify: `backend/tests/test_truth_ledger_isolation.py` (`ISOLATED_NAMESPACES` adds `"ontology"`; new test that `app/ontology` imports nothing from `app.scenarios`, `app.evaluation` or `app.datasets` except `app.datasets.config` for `REPO_ROOT`)

- [ ] **Step 1: Write the test and run it**

```python
def test_ontology_package_is_independent_of_bank_and_scenarios() -> None:
    allowed = {"app.datasets.config"}
    for path in sorted((APP_DIR / "ontology").rglob("*.py")):
        imports = _imported_modules(_tree(path))
        offenders = {name for name in imports if name.startswith(("app.scenarios", "app.evaluation", "app.datasets")) and name not in allowed}
        assert not offenders, (path.name, offenders)
```

Run: `cd backend && uv run pytest tests/test_truth_ledger_isolation.py -v`
Expected: PASS (fix any offending import if it fails)

- [ ] **Step 2: Commit**

```bash
git add backend/tests/test_truth_ledger_isolation.py
git commit -m "test: truth-ledger isolation covers the ontology package"
```

---

### Task 22: Regenerate the development world and record the ingestion

**Files:**
- Modify: `Makefile` (no change expected; verify `generate-dev-data`, `ingest-graph` still work)
- Modify: `backend/app/graph/__main__.py` (prints the stats path)

- [ ] **Step 1: Generate and validate**

Run: `cd /Users/mark.stent/Dev/python/2026/lottery-graphrag-poc && make generate-dev-data`
Expected: `generated dev world seed=2026`, eight `scenario SCN-... planted` lines, manifest and dictionary paths printed

- [ ] **Step 2: Ingest if Docker is available**

Run: `docker compose up -d && make ingest-graph`
Expected: counts per label including `BusinessConcept` (number of concepts in the YAML), `IncidentType 25`, `PaymentProvider 6`; `_graph_stats.json` written beside the dataset
If Docker is not running, record that ingestion was not executed in the task notes and do not claim it.

- [ ] **Step 3: Run the full suite, lint, types**

Run: `cd backend && uv run ruff format --check . && uv run ruff check . && uv run mypy && uv run pytest -q`
Expected: all green

- [ ] **Step 4: Commit any Makefile or CLI output changes**

```bash
git add Makefile backend/app/graph/__main__.py
git commit -m "chore: regenerate development world on generator 0.2.0"
```

---

### Task 23: Specification and decision updates

**Files:**
- Modify: `docs/01-synthetic-data-spec.md` (section 5 adds "each market owns its reference data and codes"; section 6 lists the new tables; section 7 notes `business_concepts` removed; profile table shows the operational volumes)
- Modify: `docs/02-graph-schema-spec.md` (as-built label and relationship list; `ONTOLOGY_RELATIONSHIP_TYPES`; validity properties)
- Modify: `docs/03-ontology-spec.md` (section "As built, v2.0.0": tree, binding kinds, four languages, term table, similarity method, YAML as single source)
- Modify: `docs/04-scenario-catalogue.md` (planted set is eight; SCN-001, 009, 010, 011 as-built signal descriptions; ids do not encode scenarios; KPIs derived after planting)
- Modify: `DECISIONS.md` (D-012 PyYAML for the ontology source; D-013 channels stay global codes while every other taxonomy is market-local; D-014 planted ids continue table sequences; D-015 KPIs derived after planting)
- Modify: `docs/superpowers/specs/2026-10-18-overhaul-design.md` section 5.1 (note D-013)

- [ ] **Step 1: Write the updates (one sentence per line, plain dashes)**

- [ ] **Step 2: Grep for stale references**

Run: `grep -rn "FAM_NATIONAL_DRAW\|INC_S007\|DOC_S015\|business_concepts\|ontology_family_mechanics_v1" docs backend/app schemas README.md RELEASE.md | grep -v superpowers/`
Expected: no output other than historical notes explicitly marked as v1 (HITL_STATUS notes may stay)

- [ ] **Step 3: Commit**

```bash
git add docs DECISIONS.md
git commit -m "docs: specifications updated for world v2, ontology v2 and eight planted scenarios"
```

---

## Self-review notes

- Spec coverage: 5.1 (Tasks 1 to 8, 20), 5.2 (Tasks 9 to 11, 16), 5.3 (Tasks 12 to 15), 5.4 allow-list (Task 19), node validity and persisted stats (Task 17), schema metadata (Tasks 1 and 8), isolation (Task 21), docs (Task 23).
- Not in this plan on purpose: pipelines v2 retrieval changes beyond the allow-list (Phase 2), bank 2.0.0 (Phase 3), API and frontend (Phases 4 and later).
- Type names used across tasks: `rows.*Row`, `schema.ForeignKey`, `model.Concept/Binding/Ontology`, `terms.Term/TermMatch/TermMatcher`, `similarity.GameConcepts/SimilarEdge`, `planter.ScenarioPlanter`, `statements.ONTOLOGY_RELATIONSHIP_TYPES`; check each later task against the first definition.
