# Phase 6: Product Screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build four screens on the Phase 5 foundation and the Phase 4 API: Overview, Live Lab, Data Model and Help.
Also record a real live-model run and commit it as the offline fixture.
Then remove every v1 view, mock and adapter, and stop at CP2.

**Architecture:** Each screen is a thin composition of foundation parts.
- API reads go through `api/client.ts`, and their states render through `Panel`.
- Runs go through `api/stream.ts`, `run/reduce.ts` and `run/replay.ts`.
- Graphs render with `graph/graph-canvas.tsx`, and numbers with `charts/*`.
- Screens hold no domain logic. Any new derivation, such as the market coverage matrix, is a pure function in its own module with its own tests.
- One small hook, `useResource`, turns an API call into a Panel state. It is the only data-loading helper.

**Tech Stack:** React 19, TypeScript strict, Tailwind v4 tokens, Vitest with RTL, Playwright.
No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-18-overhaul-design.md`, sections 7.3 to 7.9, the CP2 row of section 4, and section 9 step 6.

## Global Constraints

- Everything in `AGENTS.md` applies, and so does everything in the Phase 5 plan's Global Constraints: tokens, pipeline names, banned words, states, accessibility, lean code, no em dashes and no co-author lines.
- No number appears on screen unless the harness, a recorded run or an API response produced it (spec anti-goal).
  - With no official benchmark run, Overview and Help show that state plainly and link to Results.
  - Nothing is ever invented as a placeholder.
- Every graph animation replays recorded events (spec anti-goal and AGENTS.md).
- Each screen opens with its spec 7.1 purpose sentence and nothing else before the content.
- Copy budget, enforced by a test:
  - about 1,200 words outside Help, with a test cap of 1,300;
  - about 1,500 words in Help prose, with a test cap of 1,650.
  - The question table and the scenario narratives do not count, because they come from the API.
- The worked example (SCN-007) is told once, in Help. Elsewhere it is linked.
- Live Lab scores bank questions after the run with the label "scored against the answer key".
  - It states that no answer key exists for ad hoc questions.
  - No judge appears live.
- All screens work at 1920x1080 and in presentation mode.
- Visual baselines cover every screen and state, regenerated on the owner's machine.
- `mock/`, the v1 views, `api/backend-run.ts` and every `v1-*` file are deleted by the end of this phase. `PHASE6_REWRITES` becomes empty and is removed.

## Review Focus

1. A Live Lab run is cancelled while B traverses, then replayed.
   - The canvas, columns and scorecard must show exactly the recorded state: A completed, B cancelled, C skipped.
   - There must be no score.
   - Test: `cancelled run replays as recorded` (Task 4).
2. The stream drops mid-run on a real backend.
   - Live Lab must resume and end with the same state as a replay of the stored events.
   - Test: Playwright `live run resumes after a dropped stream`, gated by `LIVE_WORLD_E2E` (Task 11).
3. The user opens a citation, an evidence row and a graph node in turn, by keyboard only.
   - Each must open the evidence drawer on the right record.
   - Focus must return to where the user started each time.
   - Test: `evidence drawer from every opener by keyboard` (Task 5).
4. No official run exists.
   - Overview's tiles and Help's score column must say so and link to Results, with no blank tiles and no zeros.
   - Test: `no official run shows the plain state` (Tasks 3 and 9).
5. The Data Model rows grid is filtered by a timestamp copied from a row, then paged.
   - The filter must work with the typed filter.
   - The page must stay within 200 rows, with the total shown.
   - Test: `filter by a copied timestamp and page` (Task 7).

---

## File Structure

| Path | Responsibility |
|---|---|
| `frontend/src/screens/overview/*` | Overview screen |
| `frontend/src/screens/live-lab/*` | Live Lab: question bar, columns, canvas area, timeline, scorecard, answers, matrix |
| `frontend/src/screens/data-model/*` | Data Model: four tabs |
| `frontend/src/screens/help/*` | Help: eight sections |
| `frontend/src/screens/results/*` | The plain run list until Phase 7 |
| `frontend/src/screens/screen.tsx` | Screen frame: purpose sentence, heading, presentation behaviour |
| `frontend/src/app/use-resource.ts` | API call to Panel state, with abort on unmount |
| `frontend/src/run/coverage.ts` | Market coverage matrix from results (pure) |
| `frontend/src/run/fixtures/recorded/*.json` | Recorded live-model runs of the four demo questions |
| `frontend/scripts/capture-run.mjs` | Extended to record live-model runs |
| `docs/ux/screen-specifications.md` | Rewritten as built |

---

### Task 1: Recorded real runs

**Files:**
- Modify: `frontend/scripts/capture-run.mjs`. Add `--provider` passthrough, a list of demo instance ids, and an output directory.
- Create: `frontend/src/run/fixtures/recorded/{instance_id}.json`, one for each of the four demo questions (H1, H2, H3, H5).
- Test: `frontend/src/run/recorded.test.ts`.

**Interfaces:**
- Produces:
  - `RECORDED_RUNS: readonly RecordedRun[]`.
  - `RecordedRun` has `{ instance_id, question, stratum, run_id, model, captured_at, results, events }`. Its types come from `schema.d.ts`.
- Capture setup:
  - The presentation world is dev-seed2026, and Neo4j must hold it.
  - Generation uses local Ollama `qwen3.6:latest` with `GENERATION_REASONING=off`, through the API's `POST /queries` with `benchmark_instance_id`.
  - Neo4j is never wiped.
- The fixture is the API's own output: events and results.
  - It is stored verbatim.
  - It never contains expected answers, claims or checks.
  - The live score stays, because the API returns it.

- [ ] **Step 1: Write the failing tests.**

```ts
test("every recorded run is a real API capture with all three pipelines", () => {
  for (const run of RECORDED_RUNS) {
    expect(new Set(run.events.map((e) => e.pipeline))).toEqual(new Set(["run", "A", "B", "C"]))
    expect(reduceAll(run.events).status).toBe("completed")
    expect(run.model).not.toMatch(/fake/i)
  }
})
test("no recorded run carries answer-key content", () => {
  for (const run of RECORDED_RUNS) expect(JSON.stringify(run)).not.toMatch(/expected_answer|required_evidence|truth|ledger/)
})
test("each demo stratum has one recorded run", () => {
  expect(RECORDED_RUNS.map((r) => r.stratum).sort()).toEqual(["H1", "H2", "H3", "H5"])
})
```

- [ ] **Step 2: Run the tests to confirm they fail.** Run `pnpm vitest run src/run/recorded.test.ts`.
- [ ] **Step 3: Capture the runs.**
  - Start the API on the dev world with the local model.
  - Run the script.
  - Check that Neo4j still has 36,888 nodes.
- [ ] **Step 4: Run the tests to confirm they pass.**
- [ ] **Step 5: Commit** with `feat(frontend): recorded live-model runs of the four demo questions`.

---

### Task 2: Screen frame, resource hook and routing

**Files:**
- Create:
  - `frontend/src/screens/screen.tsx`
  - `frontend/src/app/use-resource.ts`
  - `frontend/src/screens/results/results.tsx`. For now this is the plain run list: `GET /benchmarks` with each run's kind, label, date, selection and headlines. A link goes to its `summary.json` reproducibility fields.
- Modify: `frontend/src/App.tsx`, so each destination lazy-loads its `screens/*` module.
- Test: `screen.test.tsx`, `use-resource.test.ts` and `results.test.tsx`.

**Interfaces:**
- `<Screen destination purpose>{children}</Screen>` renders the purpose sentence first and an `h1` for the destination.
- `useResource<T>(load: (signal) => Promise<T>, deps) -> { state: PanelState, data?: T, error?: ApiError, retry }`.

- [ ] Steps 1-5 follow TDD, with tests for:
  - the purpose sentence first;
  - abort on unmount;
  - retry;
  - the empty state when the API returns an empty list;
  - Results listing runs plainly, with the subset label shown for subset runs.

  Commit with `feat(frontend): screen frame, resource hook and the plain run list`.

---

### Task 3: Overview

**Files:**
- Create: `frontend/src/screens/overview/*`.
- Test: `overview.test.tsx`.

**Interfaces:**
- Data:
  - `getLatestBenchmark()` gives the run kind, label, `summary.metrics`, comparisons and headlines.
  - `getDemoQuestions()`.
  - `listDatasets()` and `getModels()` feed the configuration strip.
- Content, in order:
  - the purpose sentence;
  - three `StatTile`s, one per pipeline, showing the headline metric of the latest full official run (evidence F1 overall) with its interval and counts;
  - the generated headline sentences, verbatim;
  - a pipeline flow diagram as an inline SVG. It shows the shared steps and where B and C branch, with labels from the glossary;
  - a "Run a question" call to action, plus the four demo questions as links into Live Lab;
  - the configuration strip, showing the dataset in plain words and the models.
- When the latest run is not a full official run:
  - the tiles show "No official run yet" and the run's own label, such as "scorer smoke test" or "subset run";
  - a link goes to Results;
  - no tile shows a number from a smoke or subset run.

- [ ] Steps 1-5 follow TDD, with tests for:
  - tiles from an official summary;
  - "no official run shows the plain state";
  - smoke and subset runs never fill tiles;
  - headlines verbatim;
  - demo questions linking to Live Lab with their instance id;
  - every Panel state.

  Commit with `feat(frontend): Overview`.

---

### Task 4: Live Lab, runs and columns

**Files:**
- Create: `frontend/src/screens/live-lab/{live-lab,question-bar,pipeline-column,stage-tracker,timeline}.tsx` and `use-live-run.ts`.
- Test: matching `*.test.tsx`.

**Interfaces:**
- Question bar:
  - the saved questions (demo bank questions);
  - free text;
  - in a secondary row, market scope and source.
  - Source is one of:
    - "Recorded run", from `RECORDED_RUNS`, which is the default when the API is not ready;
    - "Live", from the API.
  - For bank questions the scope is locked to the instance's own scope, as the API enforces.
- `useLiveRun(source)`:
  - Live: `startQuery`, then `subscribeRun`, then `reduce`.
  - Recorded: `createReplay(events)`.
  - Both give `{ state: RunState, replay controls, cancel, error }`.
  - Cancel calls `cancelRun`. A 409 shows the envelope message.
- Columns: one per pipeline (A, B, C) in pipeline colours. Each shows:
  - a stage tracker built from the stage events;
  - a live evidence list (candidates, selected, set aside) built from reducer state;
  - errors in plain words.
- Timeline: three tracks plus a scrubber, rewind, replay and speed (0.5, 1, 2, 4), using the replay clock. It also registers the presentation keys.

- [ ] Steps 1-5 follow TDD, with tests for:
  - a recorded run plays to completion and matches `reduceAll`;
  - "cancelled run replays as recorded";
  - a live run, with the stream faked, renders progressively;
  - a 409 conflict shows the message and a retry;
  - presentation keys drive the timeline;
  - reduced motion jumps to the end.

  Commit with `feat(frontend): Live Lab runs, columns and timeline`.

---

### Task 5: Live Lab, canvas, scorecard, answers and evidence

**Files:**
- Create: `frontend/src/screens/live-lab/{canvas-area,scorecard,answer-block,path-strip,coverage-matrix}.tsx` and `frontend/src/run/coverage.ts`.
- Test: matching tests.

**Interfaces:**
- Canvas area:
  - B and C tabs, with the other pipeline's path available as an overlay toggle.
  - C highlights what the ontology added.
  - `nodeCap` comes from Settings.
  - Replay mode is used for recorded runs, and live mode for live runs.
  - The out-of-view note is shown.
  - Focus mode is available.
- Scorecard, shown when the run completes:
  - three columns showing correct or not, evidence found, markets reached, latency, context size, and deltas against A;
  - the one-line reason, when the question is in the bank, from the score;
  - for ad hoc questions, the measurable items only, plus "No answer key exists for this question.";
  - the label "scored against the answer key".
- Answer blocks show the answer text with clickable citations. A citation opens the evidence drawer on its record or passage.
- Path strip (B and C): the evidence path as a compact row of nodes and relationships.
- Coverage matrix: markets by pipelines, from `coverage(results)`.
- The evidence drawer opens from a citation, an evidence row or a graph node, and shows the position on the path.

- [ ] Steps 1-5 follow TDD, with tests for:
  - scorecard values come only from the result's score and metrics;
  - ad hoc shows no score;
  - "evidence drawer from every opener by keyboard";
  - the coverage matrix is a pure function, with fixture cases;
  - ontology highlight only on C;
  - the overlay toggles.

  Commit with `feat(frontend): Live Lab canvas, scorecard, answers and evidence`.

---

### Task 6: Data Model, Warehouse and Graph tabs

**Files:**
- Create: `frontend/src/screens/data-model/{data-model,warehouse,rows-grid,graph-tab,meta-graph}.tsx`.
- Test: matching tests.

**Interfaces:**
- Warehouse tab:
  - an entity-relationship map grouped by source system, from the dictionary plus row counts, drawn with elkjs through the graph layout module (no new layout code);
  - click a table to open the rows grid: paged at 50, with a column filter using the typed filter and the total shown;
  - click a row to open the record in the evidence drawer, with "Follow into the graph" opening the Graph tab focused on its node and bounded neighbours.
- Graph tab:
  - a meta-graph of labels sized by count, with typed edges labelled with counts;
  - an allow-list toggle: B, C, or the full schema;
  - click a label to see its properties and a sample node.
  - Labels are in plain words.

- [ ] Steps 1-5 follow TDD, with tests for:
  - the map grouped by source system;
  - paging and filtering;
  - follow into the graph;
  - the allow-list toggle;
  - every Panel state;
  - "filter by a copied timestamp and page", as an e2e test against the mock API.

  Commit with `feat(frontend): Data Model warehouse and graph`.

---

### Task 7: Data Model, Ontology and Scenarios tabs

**Files:**
- Create: `frontend/src/screens/data-model/{ontology-tab,concept-card,scenarios-tab}.tsx`.
- Test: matching tests.

**Interfaces:**
- Ontology tab:
  - a tree on the left;
  - a concept card in the centre with the definition, four language labels, synonyms and relationships;
  - bound instances by market on the right, from `getConceptMembers`.
  - "Αριθμολαχείο", "Zahlenziehung" and "National Draw" must all be visible on the national-draw concept.
- Scenarios tab:
  - the eight scenarios as cards, each with its planted status and planted row counts;
  - links to the Help narrative and to the questions that test the scenario.
  - No truth content appears in this tab.

- [ ] Steps 1-5 follow TDD, with tests for:
  - four labels on the national-draw concept;
  - the members filtered by market;
  - scenario cards from `/scenarios`;
  - no truth fields render;
  - keyboard tree navigation.

  Commit with `feat(frontend): Data Model ontology and scenarios`.

---

### Task 8: Help

**Files:**
- Create: `frontend/src/screens/help/*`, one component per section.
- Test: `help.test.tsx`.

**Interfaces:**
The sections, in the spec 7.7 order:
1. What we are testing: three sentences and one diagram.
2. The three approaches: one card each.
3. The data: a short tour that links into Data Model.
4. The planted stories:
   - each scenario's narrative from the question catalogue's `hidden_truth`, shown verbatim;
   - SCN-007 told once, as the worked example.
5. The questions:
   - the `/benchmarks/questions` table with text, what it tests, story, expected answer and per-pipeline scores from the latest full official run;
   - filterable by stratum and story;
   - with no official run, the score column reads "No official run yet".
6. How scoring works.
7. Glossary: 12 terms of about 12 words each, from `copy/glossary.ts` (extended to 12 entries).
8. Running it:
   - bring-up;
   - a recovery table that includes `make ingest-graph` and the graph-world note;
   - model configuration.

Vendor and engineering names appear only in section 8.

- [ ] Steps 1-5 follow TDD, with tests for:
  - section order;
  - the narratives verbatim from the API;
  - the question table filters;
  - "no official run shows the plain state";
  - the glossary has 12 entries;
  - vendor names only in section 8.

  Commit with `feat(frontend): Help`.

---

### Task 9: Remove v1, copy budget, presentation pass

**Files:**
- Delete:
  - `frontend/src/views/*`;
  - `frontend/src/mock/*`;
  - `frontend/src/api/backend-run.ts` and its test;
  - the v1 components (`answer-block`, `timeline`, `rag-pane`, `score-strip`, `live-score`, `doc` in `components/`, if no screen uses them);
  - `v1-*` files.
- Modify: `frontend/src/copy/banned-words.test.ts`. Remove `PHASE6_REWRITES` and add the copy-budget test, which counts words outside Help and in Help prose against the caps.
- Test: the copy-budget test, and a test that `mock/` and `backend-run` are not imported anywhere.

- [ ] Steps 1-5 follow TDD, with tests for:
  - the budget caps;
  - no v1 imports;
  - every destination renders its new screen;
  - presentation mode on every screen hides navigation and enlarges type and canvas.

  Commit with `refactor(frontend): remove v1 views, mocks and adapters; enforce the copy budget`.

---

### Task 10: Baselines and end-to-end tests

**Files:**
- Modify:
  - `frontend/e2e/visual.spec.ts`: add every screen and state (normal, loading, empty, error, disabled where it applies) at 1920x1080 with reduced motion, plus presentation mode per screen.
  - `frontend/e2e/smoke.spec.ts`: add a recorded run that plays to completion in Live Lab.
- Create: `frontend/e2e/live-lab-live.spec.ts`, gated by `LIVE_WORLD_E2E`, covering:
  - a live run against the real backend streams to completion;
  - "live run resumes after a dropped stream";
  - the final state equals the replay of the stored events.

- [ ] **Step 1: Write the specs.**
- [ ] **Step 2: Generate the baselines on the owner's machine.** Look at every image, and fix what looks off in the components themselves.
- [ ] **Step 3: Run the specs.**
  - `pnpm e2e` and `pnpm e2e:visual` (twice).
  - `LIVE_WORLD_E2E=1 ... e2e/live-lab-live.spec.ts`. The graph must stay at dev-seed2026.
- [ ] **Step 4: Commit** with `test(frontend): screen baselines, recorded-run smoke and the live end-to-end run`.

---

### Task 11: Documentation, decisions and the CP2 package

**Files:**
- Rewrite `docs/ux/screen-specifications.md` as built, one section per screen with its states.
- Modify `DECISIONS.md`: from D-046 on, any screen-level controller rulings, each marked "Proposed (controller ruling, for owner review at CP2)".
- Modify `HITL_STATUS.md`: row "CP2 Product", status PRESENTED. It lists:
  - the screenshots, meaning the baselines directory;
  - the recorded runs;
  - every CP2 owner item from Phases 4, 5 and 6.
- Modify `README.md`: the "how to run" section names the five destinations.

- [ ] **Step 1:** Write the docs as built. Each screen section names its states and data sources.
- [ ] **Step 2:** Run every gate.
  - Backend: ruff, mypy and `pytest -W error`.
  - Frontend: format, lint, typecheck, `api:check`, test and build, all with no warnings.
  - e2e and visual.
- [ ] **Step 3:** Commit with `docs: Phase 6 screens as built and the CP2 package`.

---

## Not in this plan

- The full Results screen, with run start, charts, the per-question table, the efficiency panel, failure classes and the reproducibility panel: Phase 7.
- The documentation cut to ten files, and the full copy pass: Phase 7.
- The official run: CP3.

## Self-review notes

- Spec 7.3 Overview: Task 3.
- Spec 7.4 Live Lab:
  - question bar, columns, stage trackers, evidence lists, timeline, presentation: Task 4;
  - canvas, scorecard, answers, path strip, coverage matrix, evidence drawer: Task 5;
  - recorded run as a real capture: Task 1.
- Spec 7.6 Data Model: Tasks 6 and 7.
- Spec 7.7 Help: Task 8.
- Spec 7.8 copy budget: Task 9.
- Spec 7.9 states, keyboard and baselines: every task, plus Task 10.
- CP2 package (screenshots of every screen and state, a recorded real run replaying in Live Lab): Tasks 1, 10 and 11.
- Phase 5 carry-over: nodeCap wired (Task 5), out-of-view note in Live Lab (Task 5), `subscribeRun` end to end (Task 10), v1 removal (Task 9), screen-specifications rewrite (Task 11).
