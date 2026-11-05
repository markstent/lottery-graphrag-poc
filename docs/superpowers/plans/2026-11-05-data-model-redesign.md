# Data Model Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Data Model screen as an Overview plus four tabs (Tables, Graph, Concepts, Stories) that share one three-column explorer layout, with three small read-only API additions.

**Architecture:** The backend gains a story description on `ScenarioOut`, link counts on `NodeOut`, and one endpoint that names the Overview's example incident (the only new reader of the truth ledger, and it returns an id only). The frontend replaces the four current tabs with five, built on one shared `Explorer` layout component; the big schema maps, the "How to explore" strip and the long explanation panels go, and their copy moves into an "About this" drawer per tab and short notes on the Overview.

**Tech Stack:** FastAPI + Pydantic (Python 3.13, uv, pytest), Neo4j reader, DuckDB; React 19 + TypeScript strict + Tailwind 4 (pnpm, Vitest, React Testing Library, Playwright).

**Spec:** `docs/superpowers/specs/2026-11-04-data-model-redesign-design.md` (approved by the owner on 2026-11-05). The approved wireframe is `.superpowers/brainstorm/66459-1793822917/content/b-explorer-tabs.html`.

## Global Constraints

- AGENTS.md applies in full: synthetic data only, never the real employer name, never "Atlas", never the em dash, design tokens only, keyboard access, visible focus, reduced motion, non-colour status cues, and loading, empty, error and disabled states for every panel.
- Truth-ledger isolation: retrieval code never reaches the ledger; the only new ledger reader is the example endpoint of Task 3, and no response on this screen names a planted row or says why.
- Copy: the banned-word list and the word budget outside Help (`frontend/src/copy/banned-words.test.ts`, `frontend/src/copy/budget.ts`) apply; aim below today's 3,500 words; if the cap must move, record it in `budget.ts` and the decision record.
- Layout: target 1920 by 1080; no sideways page scroll at 1440 and 1600 wide; presentation mode raises type one step.
- Addresses: `#/data-model` opens Overview; tabs are `overview`, `tables`, `graph`, `concepts`, `stories`; old ids `warehouse`, `ontology`, `scenarios` alias to `tables`, `concepts`, `stories`; `tab=graph&node=<id>` keeps working.
- Every API addition is a typed schema with tests, and the frontend types are regenerated with `make api-contract`.
- One sentence per line in Markdown docs; commits on `overhaul/v2`, never pushed.

## Review Focus

1. A node with thousands of neighbours of one kind (a market's players): the group box shows the true total from `NodeOut.edges` and lists only the first 100, saying so. Test in Task 7.
2. An ontology concept or prize type node (no source table): the Graph tab shows it without a "See its table row" link and still shows link counts. Test in Task 2 and Task 7.
3. A world with no ledger match, or no incidents: the example endpoint returns `null` and the Overview shows sizes only with the short note. Tests in Task 3 and Task 5.
4. An old or hand-typed address (`tab=warehouse&table=incidents`, `tab=ontology&concept=...`, an unknown table, an unknown node id): it lands on the right tab with a clear empty or not-found message, never a blank column. Tests in Task 4, Task 6 and Task 7.
5. A value in a table that names another table's row but is empty or `none`: it is plain text, not a link. Test in Task 6.

---

### Task 1: Story descriptions in the scenarios API

**Files:**
- Modify: `backend/app/api/schemas.py` (`ScenarioOut`), `backend/app/api/reference.py` (`read_scenarios`)
- Test: `backend/tests/test_api_reference.py`

**Interfaces:**
- Produces: `ScenarioOut.description: str`, the catalogue's `description` for the scenario (`app/scenarios/catalogue.py`).

- [ ] **Step 1: Write the failing test** `test_scenarios_carry_the_catalogue_description`: for every item of `GET /api/v1/scenarios`, `item["description"] == SCENARIO_CATALOGUE[item["scenario_id"]].description` (or the catalogue's lookup by id), and it is a non-empty string.
- [ ] **Step 2: Run it to see it fail:** `cd backend && uv run pytest tests/test_api_reference.py -k description -q` fails on the missing key.
- [ ] **Step 3: Add the field and fill it from the catalogue.** Update the class docstring: description is configuration, not truth.
- [ ] **Step 4: Run** `uv run pytest tests/test_api_reference.py -q`, then fix any whole-dict comparisons in other tests that now miss the key.
- [ ] **Step 5: Commit** `feat(api): scenarios carry their plain description`.

### Task 2: Link counts on graph nodes

**Files:**
- Modify: `backend/app/api/schemas.py` (`NodeOut`), `backend/app/api/graph_model.py` (`read_node`, `_node`), reuse the edge summary query that `backend/app/api/data_model.py:282` already calls (`reader.edge_summary(label, node_id)`)
- Test: `backend/tests/test_api_graph_model.py`

**Interfaces:**
- Produces: `NodeOut.edges: list[EdgeSummary]`, one item per relationship type and direction meeting the node, with its count, sorted by type then direction; present for every node, including `BusinessConcept` and `PrizeType` nodes.

- [ ] **Step 1: Write the failing tests** `test_node_reports_its_link_counts` (a node in the test graph with a known number of links of one type: the matching `EdgeSummary` has that count) and `test_concept_node_reports_link_counts` (a `BusinessConcept` node has `provenance is None` and a non-empty `edges` with its `MAPS_TO` incoming count).
- [ ] **Step 2: Run them to see them fail:** `uv run pytest tests/test_api_graph_model.py -k link_counts -q`.
- [ ] **Step 3: Implement** by calling the existing edge summary query for the node's first label inside `read_node`, and passing the result into `_node`.
- [ ] **Step 4: Run** `uv run pytest tests/test_api_graph_model.py tests/test_api_data_model.py -q` (fix whole-dict comparisons).
- [ ] **Step 5: Commit** `feat(api): graph nodes report how many links of each kind meet them`.

### Task 3: The Overview example endpoint

**Files:**
- Create: `backend/app/api/example.py` (router builder `build_example_router()`), `backend/tests/test_api_example.py`
- Modify: `backend/app/api/schemas.py` (`DataModelExample`), the app factory that mounts routers (where `build_reference_router` is included), `backend/tests/test_truth_ledger_isolation.py` (`EVALUATION_API_MODULES` gains `"example.py"`)

**Interfaces:**
- Produces: `GET /api/v1/data-model/example` returning `DataModelExample { incident_id: str | None }`, and nothing else.
- The rule, applied to the active world's `incidents` table: sort by `incident_id`; drop every incident whose id appears anywhere in the active world's truth ledger (`required_evidence` and the values of `truth`, read through `app.evaluation.load_ledger`); pick the first whose `platform_version_id` is also the `platform_version_id` of an incident in a different `market_id` (a null market counts as its own market); else the first remaining incident; else `None`.
- The ledger is the one that matches the active world, found with the same helpers `backend/app/api/benchmarks.py` uses (`app.evaluation.official`); no matching ledger means `incident_id: None`, logged as a warning with the reason. Never fall back to the rule without the planted check.

- [ ] **Step 1: Write the failing tests** in `test_api_example.py` with a small fixture world and ledger:
  - `test_example_is_the_first_shared_version_incident_not_planted`: incidents `INC_001` (UK, `PLV_A`), `INC_002` (GR, `PLV_A`, planted), `INC_003` (AT, `PLV_A`): answer `INC_001`.
  - `test_planted_incident_is_never_the_example`: when the only shared-version pair includes a planted incident, the answer is the first unplanted incident.
  - `test_no_matching_ledger_gives_no_example`: answer `{"incident_id": None}`.
  - `test_no_incidents_gives_no_example`.
  - `test_response_names_only_the_example`: the response keys are exactly `{"incident_id"}`.
- [ ] **Step 2: Run them to see them fail:** `uv run pytest tests/test_api_example.py -q`.
- [ ] **Step 3: Implement the router** and mount it; add `"example.py"` to `EVALUATION_API_MODULES` with a comment naming this endpoint and its id-only response.
- [ ] **Step 4: Run** `uv run pytest tests/test_api_example.py tests/test_truth_ledger_isolation.py -q`, then the whole backend suite `uv run pytest -q`, `uv run ruff format . && uv run ruff check . && uv run mypy app`.
- [ ] **Step 5: Regenerate the frontend types:** `make api-contract` (it rewrites `frontend/src/api/openapi.json` and `schema.d.ts`); add `getDataModelExample(signal)` to `frontend/src/api/client.ts`; update `docs/api.md` for Tasks 1 to 3.
- [ ] **Step 6: Commit** `feat(api): an example incident for the Data Model overview, never a planted one`.

### Task 4: The tab frame and the shared explorer layout

**Files:**
- Create: `frontend/src/screens/data-model/explorer.tsx`, `frontend/src/screens/data-model/explorer.test.tsx`, `frontend/src/screens/data-model/about.tsx` (the "About this" drawer content per tab, holding the D-113 copy from `why.tsx`)
- Modify: `frontend/src/screens/data-model/data-model.tsx` (five tabs, aliases), `frontend/src/screens/data-model/data-model.test.tsx`
- Delete at the end of Task 9: `why.tsx`, `explore.tsx`, `explore-steps.ts`, and their tests, once nothing imports them

**Interfaces:**
- Produces: `Explorer({ steps, about, list, main, detail }: { steps: readonly [string, string, string]; about: ReactNode; list: ReactNode; main: ReactNode; detail: ReactNode })`, three columns at `lg` (`grid-cols-[minmax(14rem,1fr)_minmax(0,2.6fr)_minmax(18rem,1.2fr)]` or equivalent), stacked below `lg`; each column is a `section` labelled by its numbered heading ("1 Choose a table"); an "About this" button top right opens `about` in the existing `Drawer`.
- Produces: `ListSearch({ label, value, onChange })` and `PickList({ label, groups, chosen, onChoose })` where `groups: { name?: string; items: { id: string; title: string; detail?: string }[] }[]`; items are buttons with `aria-pressed`, a hover and focus highlight, keyboard reachable.
- Produces: `TABS` ids `overview | tables | graph | concepts | stories`, `TAB_ALIASES = { warehouse: 'tables', ontology: 'concepts', scenarios: 'stories' }`.

- [ ] **Step 1: Write failing tests:** `data-model.test.tsx` (no tab opens Overview; `tab=warehouse` shows Tables selected; `tab=ontology` shows Concepts; `tab=scenarios` shows Stories; five tab links in order); `explorer.test.tsx` (three labelled sections with the numbered headings; "About this" opens a dialog with the given content and closes on Escape; `PickList` filters with `ListSearch`, marks the chosen item `aria-pressed`, calls `onChoose`, shows "No match" when the search finds nothing).
- [ ] **Step 2: Run** `pnpm exec vitest run src/screens/data-model/data-model.test.tsx src/screens/data-model/explorer.test.tsx` to see them fail.
- [ ] **Step 3: Implement** `explorer.tsx`, `about.tsx` and the new tab list; tabs not yet rebuilt render their current component until their task lands.
- [ ] **Step 4: Run** the two test files, `pnpm exec tsc -b`, `pnpm exec oxlint src`.
- [ ] **Step 5: Commit** `feat(data-model): five tabs on one explorer layout`.

### Task 5: Overview

**Files:**
- Create: `frontend/src/screens/data-model/overview-tab.tsx`, `frontend/src/screens/data-model/overview-tab.test.tsx`, `frontend/src/screens/data-model/example.ts` (loading the example through the layers)

**Interfaces:**
- Consumes: `getDataModelExample` (Task 3), `getRecord`, `getNeighbours` with `type: 'MAPS_TO'`, `getNode`, `listDatasets`, `getDictionary`, `getGraphSchema`, `getGraphStats`, `getOntology`, `getScenarios`; `Diagram` from `meta-graph.tsx`.
- Produces: `loadExample(signal): Promise<LayeredExample | null>` where `LayeredExample = { incidentId: string; row: Record<string, JsonValue>; links: { type: string; direction: 'out' | 'in'; count: number; sample?: string }[]; concept: { id: string; name: string } | null }`; the concept is found from the incident type node's `MAPS_TO` neighbour.
- Copy fixed by the spec: the opening line "The data the three approaches search, in three layers. Each is built from the one before."; card titles "The company's data", "The links between records", "One dictionary for four countries"; buttons "Explore tables", "Explore the graph", "Explore concepts"; the stories line "Eight stories are planted in this data for the test." (use the live count, not the word "Eight").
- The core-of-the-graph diagram shows exactly the labels `Incident, PlatformVersion, Platform, Game, Market, SupportCase, Player, Campaign` and the schema's relationship types between them, with a "See every kind of record" link to the Graph tab.
- The "How each layer is built" notes keep the four points the spec lists, shortened from the D-113 copy.

- [ ] **Step 1: Write failing tests:** live sizes on each card from the stubbed API (systems, tables, rows; kinds of record and of link; concepts and country codes); the example's id on all three cards and in the fit-together diagram; the concept name from the `MAPS_TO` neighbour; `incident_id: null` shows sizes only and the note "No example record in this world."; an error in any one load shows that card's error state with retry, not a blank page; Explore buttons link to `tab=tables`, `tab=graph`, `tab=concepts`.
- [ ] **Step 2: Run** `pnpm exec vitest run src/screens/data-model/overview-tab.test.tsx` to see them fail.
- [ ] **Step 3: Implement** `example.ts` and `overview-tab.tsx`, and set it as the Overview tab.
- [ ] **Step 4: Run** the test file and check it in the browser at 1920 and 1440 with `make dev-official` running (no sideways scroll).
- [ ] **Step 5: Commit** `feat(data-model): an overview of the three layers with one example through them`.

### Task 6: Tables

**Files:**
- Create: `frontend/src/screens/data-model/tables-tab.tsx`, `frontend/src/screens/data-model/tables-tab.test.tsx`, `frontend/src/screens/data-model/record-detail.tsx` (the right column: a row's fields, its graph links and the next-step button)
- Modify: `frontend/src/screens/data-model/rows-grid.tsx` (a value in a foreign-key column becomes a link; the chosen row is marked), replacing `warehouse.tsx` (deleted in Task 9)

**Interfaces:**
- Consumes: `Explorer`, `PickList`, `ListSearch` (Task 4); `getDictionary`, `getRows`, `getRecord`.
- Address: `tab=tables&table=<table>&row=<id>`; with no table, the example's table (`incidents`) and the example row are chosen.
- Steps: "1 Choose a table", "2 Its rows", "3 The record".
- A foreign-key value links to `tab=tables&table=<fk.table>&row=<value>`; empty and `none` values stay text.
- The right column shows "Becomes these links in the graph" with each edge summary in words (`relationshipPhrase`), and "Open in the graph" (filled button, `NEXT_STEP` look) to `tab=graph&node=<graph_node_id>` when there is one.

- [ ] **Step 1: Write failing tests:** tables grouped by source system with row counts; search narrows the list; choosing a table and a row updates the address; a foreign-key value is a link to the other table's row; a `none` value is not a link; the record column lists links in words with counts and the button; an unknown `table` shows "There is no table called <name>." in the middle column; an unknown `row` shows "No row <id> in <table>." in the right column.
- [ ] **Step 2: Run** `pnpm exec vitest run src/screens/data-model/tables-tab.test.tsx src/screens/data-model/rows-grid.test.tsx` to see them fail.
- [ ] **Step 3: Implement** and wire the Tables tab.
- [ ] **Step 4: Run** the tests and check in the browser.
- [ ] **Step 5: Commit** `feat(data-model): Tables on the explorer layout, with linked values and the record beside its rows`.

### Task 7: Graph

**Files:**
- Create: `frontend/src/screens/data-model/graph-explorer.tsx`, `frontend/src/screens/data-model/graph-explorer.test.tsx`, `frontend/src/screens/data-model/neighbour-groups.ts` (+ test)
- Modify: `frontend/src/screens/data-model/graph-tab.tsx` (keeps only the "Kinds of link" table and its B, C and all-links filter, for the About drawer; the kinds map and `KindsMap` go)

**Interfaces:**
- Consumes: `Explorer`, `PickList`, `ListSearch`; `getGraphSchema`, `getGraphStats`, `getNode` (with `edges`, Task 2), `getNeighbours`; `Diagram`.
- Produces: `groupNeighbours(items: NeighbourOut[], edges: EdgeSummary[], threshold: number): DiagramGroup[]` where a type-and-direction with more than `threshold` neighbours becomes one group `{ id, type, direction, label, total }` (total from `edges`), the rest stay single nodes; `GROUP_THRESHOLD = 4`.
- Address: `tab=graph&node=<id>` (unchanged), plus `&group=<type>:<direction>` when a group is open; with no node, the example incident.
- Steps: "1 Choose a kind or find a record", "2 The record and its neighbours", "3 Its details".
- Left: a search box that opens a record by exact id ("No record with that id." on a 404), then the kinds of record with counts; choosing a kind opens its sample record (today's `sampleOf` rule).
- Right: provenance ("From <table>, row <id>" and a "See its table row" link to Tables, absent when `provenance` is null), links by kind with counts, and for each kind which approaches follow it (from `schema.allow_list`); with a group open, the group's members (first 100 via `getNeighbours` with `type`), each opening that record, and "Showing the first 100 of <total>." when cut.

- [ ] **Step 1: Write failing tests:** `neighbour-groups.test.ts` (five `RELATED_TO` in and two `AFFECTS` out with threshold 4 give one group of total 22 from the edge summary and two single nodes); `graph-explorer.test.tsx` (search by id opens the record; a 404 shows "No record with that id."; choosing a kind opens its sample; a group box opens its members on the right with the "first 100 of" line when the total is above 100; a concept node shows no table link but shows link counts; "About this" holds the Kinds of link table with Made from).
- [ ] **Step 2: Run** the two test files to see them fail.
- [ ] **Step 3: Implement** and wire the Graph tab.
- [ ] **Step 4: Run** the tests and check INC_037, a market node and a concept node in the browser.
- [ ] **Step 5: Commit** `feat(data-model): Graph on the explorer layout, one record and its grouped neighbours`.

### Task 8: Concepts and Stories

**Files:**
- Create: `frontend/src/screens/data-model/stories-tab.tsx` (+ test)
- Modify: `frontend/src/screens/data-model/ontology-tab.tsx` (on `Explorer`, with a search box over the tree), `frontend/src/screens/data-model/concept-tree.tsx` (filter prop), replacing `scenarios-tab.tsx` (deleted in Task 9)

**Interfaces:**
- Consumes: `Explorer`, `ListSearch`, `PickList`; `getOntology`, `getConceptMembers`, `getScenarios` (with `description`, Task 1).
- Concepts steps: "1 Choose a concept", "2 The concept", "3 Each country's terms"; address unchanged (`concept`, `market`).
- Concept search keeps the matches' ancestors in the tree, so a match is shown in place.
- Stories steps: "1 Choose a story", "2 What was planted", "3 Where next"; address `tab=stories&story=<id>`, first story chosen by default.
- Stories middle: description, strength explained ("how clear the signal is, from 0.2 subtle to 1.0 obvious"), noise level, and "Rows added" by table; "Not planted in this world" when `planted` is false.
- Stories right: "Read the full story" and "See its questions" (the Help links of today's cards); no link to planted rows.

- [ ] **Step 1: Write failing tests:** concept search finds "National Draw" under "Draw game" and hides non-matches; Stories lists the eight with strength, shows the chosen story's description and rows added, links to Help, and the existing "no truth content" check (no `SECRET|expected|answer|truth|claim` in the page) still passes on the new tab.
- [ ] **Step 2: Run** the test files to see them fail.
- [ ] **Step 3: Implement** and wire both tabs.
- [ ] **Step 4: Run** the tests.
- [ ] **Step 5: Commit** `feat(data-model): Concepts and Stories on the explorer layout`.

### Task 9: Clean up, end-to-end paths, baselines and docs

**Files:**
- Delete: `frontend/src/screens/data-model/why.tsx`, `explore.tsx`, `explore-steps.ts`, `warehouse.tsx`, `scenarios-tab.tsx` and their tests, and any helper in `model.ts` that is no longer used
- Modify: `frontend/e2e/data-model.spec.ts`, `frontend/e2e/mock-data-model.ts` and `mock-data-model.spec.ts`, `frontend/e2e/visual.spec.ts` (Data Model block and presentation case), `frontend/src/copy/budget.ts` if needed, `frontend/src/screens/help/running-data.ts` or Help copy that names the old tabs, `docs/ux.md` (Data Model section rewritten), `DECISIONS.md` (D-115, quoting the owner's choice of option B on 2026-11-04 and approval on 2026-11-05)

- [ ] **Step 1: Write the end-to-end paths** in `data-model.spec.ts`: Overview to each tab by its Explore button; Tables to a row, to a linked row, to the graph; Graph search by id, a group, back to the table row; Concepts with a country filter; Stories to Help; old addresses `tab=warehouse&table=incidents` and `tab=ontology&concept=CONCEPT_NATIONAL_DRAW` land on the new tabs; `document.documentElement.scrollWidth <= 1440` at a 1440 viewport on every tab; a keyboard-only pass on each tab (Tab to the list, choose with Enter, reach the next-step button) works with visible focus.
- [ ] **Step 2: Run** `pnpm exec playwright test e2e/data-model.spec.ts` and fix until green.
- [ ] **Step 3: Replace the Data Model visual cases** with one per tab, normal and presentation mode, at 1920 by 1080, plus loading and error for Overview; run `pnpm exec playwright test --config playwright.visual.config.ts -g "Data Model|data-model" --update-snapshots`, then look at every new baseline image before keeping it.
- [ ] **Step 4: Run everything:** `pnpm exec vitest run`, `pnpm exec playwright test`, `pnpm exec playwright test --config playwright.visual.config.ts`, `pnpm exec tsc -b`, `pnpm exec oxlint src`, `pnpm exec prettier --check src e2e`, and the backend suite with ruff and mypy; all green, word budget included.
- [ ] **Step 5: Update the docs** (`docs/ux.md` Data Model section, `docs/api.md` if not done, `DECISIONS.md` D-115) with one sentence per line and no em dash.
- [ ] **Step 6: Commit** `feat(data-model): retire the old tabs, with end-to-end paths, baselines and docs (D-115)`.
