# Phase 5: Frontend Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the parts every v2 screen stands on:
- the light design tokens;
- the five-destination shell with Settings, presentation mode and the evidence drawer frame;
- a typed API client with live streaming;
- a deterministic run-replay model;
- the graph canvas on `@xyflow/react` with `elkjs`;
- the chart primitives.

Phase 6 then builds the screens on these parts.

**Architecture:** The API contract comes from the backend's OpenAPI document, committed beside the client.
TypeScript types are generated from it, and a backend test fails if the committed document drifts from the code.
Runs are plain data: a reducer folds the recorded event envelopes into per-pipeline state, and a replay clock moves a cursor over that data.
The graph canvas and every panel render from that state only.
That rule, in AGENTS.md, means the graph never shows activity that no event recorded.
Charts are hand-drawn SVG primitives that follow the `dataviz` method.
They have no chart library, because the screens need four forms.

**Tech Stack:** React 19, TypeScript strict, Vite, Tailwind v4 (`@theme`), Vitest with React Testing Library, and Playwright.
New dependencies (each recorded in `DECISIONS.md`):
- `@xyflow/react` and `elkjs`, both named in the spec;
- `lucide-react`, the one icon set;
- `@fontsource-variable/inter`, Inter served locally so a projector without network still renders it;
- `openapi-typescript`, a development dependency that generates types from the contract.

**Spec:** `docs/superpowers/specs/2026-10-18-overhaul-design.md`, sections 7.1, 7.2, 7.4 (graph canvas, timeline, evidence drawer, presentation mode), 7.8, 7.9 and section 9 step 5.

## Global Constraints

- All `AGENTS.md` rules apply. They include TypeScript strict with no `any`, separation of API access, state, domain logic and presentation, design tokens, accessibility and reduced motion, and no fabricated graph activity.
- Light theme only:
  - White and near-white surfaces with one neutral grey scale.
  - Every text token is at least 4.5:1 on every surface it is used on.
  - Borders are at least 3:1.
  - The primary target is 1920 by 1080.
- Typography:
  - Inter, loaded from `@fontsource-variable/inter`.
  - Scale tokens are exactly 12, 14, 16, 20, 28 and 40 px.
  - Scores use tabular numerals (`font-variant-numeric: tabular-nums`).
- Spacing is on an 8 px grid; 4 px is allowed only inside a control.
- Shadows are used only for drawers and menus.
- Pipelines:
  - The names are "A · Text search", "B · Graph" and "C · Graph + Ontology", always with the letter.
  - Each pipeline has a hue, a tint for fills and a strong tone for lines and text.
  - The categorical order is A, B, C and is fixed.
  - The three hues must pass `scripts/validate_palette.js` from the `dataviz` skill against the light chart surface.
- Evidence states:
  - The seven states are `seed`, `traversed` (displayed for the event state `active_traversal` once settled), `candidate`, `selected`, `discarded`, `concept` and `source_record`.
  - Each state has a distinct shape, a `lucide-react` icon and a colour, so no state relies on colour alone.
- Navigation has five destinations, in this order:
  - Overview (`#/overview`, the default);
  - Live Lab (`#/live-lab`);
  - Results (`#/results`);
  - Data Model (`#/data-model`);
  - Help (`#/help`).
  The purpose sentence of each is the spec 7.1 table text, verbatim.
- The header carries only the product name, the active dataset, model status, the presentation toggle and Settings.
- Banned in product copy: "honest", "never", "real", "fake", "prototype", "telemetry", "seed", "chunk", "rerank", "MAPS_TO".
  - The glossary terms replace them.
  - A test enforces this on new code.
  - Identifiers and API field names are not copy.
- Every new component that shows data defines normal, loading, empty, error and disabled states where they apply.
- Copy is British spelling, and long Markdown puts one sentence per line.
  There are no em dashes, and commits carry no co-author line.
- Lean code:
  - no wrapper components around a library without a concrete need;
  - no state library;
  - one fetch helper;
  - no abstraction with a single implementation unless it isolates an external dependency or is a test seam.

## Review Focus

1. A stream disconnects mid-run and reconnects with `Last-Event-ID`.
   The replay state must equal the state of an uninterrupted stream of the same run, with no event applied twice.
   Test: `test_resumed_stream_state_equals_uninterrupted` (Task 4).
2. A run of 200 graph nodes must lay out, render and stay interactive.
   - Zoom, pan and keyboard focus must each respond within 100 ms after the first layout.
   - Nodes above the visible-node cap must collapse into labelled clusters, never be silently dropped.
   Test: the Playwright spec `graph-canvas-200.spec.ts` (Task 7).
3. Reduced motion is on and a run is replayed.
   - The canvas and every panel must show the end state at once.
   - Nothing may animate.
   - The textual evidence path must list the same nodes, in the same order, as the canvas path.
   Test: `replay under reduced motion shows the end state` (Task 6).
4. An API call fails with the error envelope.
   The user must see the envelope's curated message, never a status code or a raw exception.
   A `CONFLICT` with `retryable: true` must offer a retry.
   Test: `surfaces the envelope message and offers retry on a retryable conflict` (Task 3).
5. A keyboard-only user opens the evidence drawer from a graph node and closes it.
   - Focus must be trapped in the drawer while it is open.
   - Focus must return to the same node when it closes.
   Test: `drawer traps focus and returns it to the opener` (Task 9).

---

## File Structure

| Path | Responsibility |
|---|---|
| `frontend/src/index.css` | Tokens (`@theme`): surfaces, grey scale, text, borders, pipeline hue, tint and strong tones, evidence states, status, type scale, spacing, radii, shadows, durations |
| `frontend/src/design/tokens.ts` | The same token values as typed constants for SVG and canvas code, plus a test that they equal the CSS |
| `frontend/src/design/pipelines.ts` | Pipeline ids, names and token references |
| `frontend/src/design/evidence-states.ts` | The seven states: label, icon, shape, tokens |
| `frontend/src/api/openapi.json` | The backend contract (generated by a backend CLI, committed) |
| `frontend/src/api/schema.d.ts` | Types generated by `openapi-typescript` |
| `frontend/src/api/http.ts` | The one fetch helper: base URL, JSON, timeout, abort, error envelope to `ApiError` |
| `frontend/src/api/client.ts` | One typed function per route |
| `frontend/src/api/stream.ts` | Server-sent event subscription with resume and terminal close |
| `frontend/src/run/reduce.ts` | Event envelopes to `RunState` (pure) |
| `frontend/src/run/replay.ts` | Replay clock: play, pause, step, seek, speed, reduced motion |
| `frontend/src/graph/model.ts` | `RunState` to the graph view model: nodes, edges, states, paths, clusters, focus (pure) |
| `frontend/src/graph/layout.ts` | `elkjs` layered layout with stable positions |
| `frontend/src/graph/graph-canvas.tsx` | `@xyflow/react` canvas: DOM nodes, edge labels, zoom and pan, focus mode, keyboard |
| `frontend/src/graph/evidence-path-list.tsx` | Textual alternative |
| `frontend/src/charts/*.tsx` | `StatTile`, `GroupedBars`, `IntervalPlot`, `DataTable`, `Legend`, `Tooltip` |
| `frontend/src/app/shell.tsx`, `router.ts`, `settings-drawer.tsx`, `presentation.ts` | Shell, five routes, Settings, presentation mode |
| `frontend/src/components/panel.tsx`, `drawer.tsx`, `evidence-drawer.tsx` | State-aware panel, drawer with focus trap, evidence drawer frame |
| `backend/app/api/openapi_export.py` | `python -m app.api.openapi_export` writes the contract |

---

### Task 1: Light tokens, Inter, pipeline and evidence-state design

**Files:**
- Modify: `frontend/src/index.css` (`@theme` values replaced, dark values removed).
- Create:
  - `frontend/src/design/tokens.ts`
  - `frontend/src/design/pipelines.ts`
  - `frontend/src/design/evidence-states.ts`
- Modify: `frontend/src/main.tsx` (import `@fontsource-variable/inter`).
- Test:
  - `frontend/src/design/tokens.test.ts`
  - `frontend/src/design/evidence-states.test.ts`
- Docs: rewrite `docs/ux/visual-language.md` as built, covering tokens, the contrast table and the validator output.
- Deps: `pnpm add lucide-react @fontsource-variable/inter`.

**Interfaces:**
- Produces:
  - `PIPELINES: readonly [{ id: "A", name: "Text search", label: "A · Text search", hue, tint, strong }, { id: "B", … "Graph" }, { id: "C", … "Graph + Ontology" }]`
  - `pipeline(id: PipelineId)`
  - `EVIDENCE_STATES: Record<EvidenceState, { label: string; icon: LucideIcon; shape: "circle" | "square" | "diamond" | "hexagon" | "pill" | "dashed-circle" | "document"; fill: string; stroke: string }>`
  - `type EvidenceState = "seed" | "traversed" | "candidate" | "selected" | "discarded" | "concept" | "source_record"`
  - `TOKENS` (typed copies of the CSS values)
- Labels, in plain language: "Starting point", "Followed", "Considered", "Used as evidence", "Set aside", "Ontology concept" and "Source record".

- [ ] **Step 1: Choose the values, then run the validator.**
  - Pick light surfaces (white `#ffffff` plus one near-white) and a 10-step neutral grey.
  - Pick pipeline hues in fixed order A, B, C.
  - Run `node <dataviz skill dir>/scripts/validate_palette.js "<A>,<B>,<C>" --mode light`. The skill directory is printed when the `dataviz` skill is loaded.
  - Iterate until every check is PASS.
  - Paste the final output into `docs/ux/visual-language.md`.
- [ ] **Step 2: Write the failing tests.**

```ts
test("every text token meets 4.5:1 on every surface it is used on", () => {
  for (const [text, surface] of TEXT_ON_SURFACE) expect(contrast(TOKENS[text], TOKENS[surface])).toBeGreaterThanOrEqual(4.5)
})
test("borders meet 3:1 on their surfaces", () => { /* same over BORDER_ON_SURFACE */ })
test("tokens.ts equals the @theme values in index.css", () => { expect(parseTheme(readIndexCss())).toEqual(cssVarsOf(TOKENS)) })
test("type scale is exactly 12, 14, 16, 20, 28, 40", () => { expect(TYPE_SCALE_PX).toEqual([12, 14, 16, 20, 28, 40]) })
test("each evidence state differs from every other in shape or icon, not only colour", () => { /* pairwise */ })
test("pipeline labels carry their letter", () => { expect(PIPELINES.map((p) => p.label)).toEqual(["A · Text search", "B · Graph", "C · Graph + Ontology"]) })
```

- [ ] **Step 3: Run the tests and see them fail.** Run `pnpm test src/design`.
- [ ] **Step 4: Implement the tokens, add the font import, and write the doc.**
- [ ] **Step 5: Run the tests and the frontend gate.** Run `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`. Expected: PASS.
  The v1 views will now look unstyled in places. That is accepted until Phase 6.
- [ ] **Step 6: Commit** with `feat(frontend): light design tokens, Inter, pipeline and evidence-state design`.

---

### Task 2: The contract: OpenAPI export, generated types, drift checks

**Files:**
- Create: `backend/app/api/openapi_export.py`, which writes `create_app().openapi()` as sorted, two-space JSON with a trailing newline.
- Create: `frontend/src/api/openapi.json` (generated) and `frontend/src/api/schema.d.ts` (generated by `openapi-typescript`).
- Modify:
  - `frontend/package.json`: scripts `api:types` and `api:check`; dev dependency `openapi-typescript`.
  - `Makefile`: target `api-contract`, which runs the export and then `api:types`.
- Test:
  - `backend/tests/test_openapi_contract.py`: the committed `openapi.json` equals the app's schema.
  - `api:check` in the frontend CI job: it regenerates `schema.d.ts` into a temporary file and diffs it.

**Interfaces:**
- Produces: `components["schemas"][...]` and `paths[...]` types for every route.
  Later tasks import types only from `schema.d.ts`, with no hand-written DTOs.

- [ ] **Step 1:** Write the backend test.

```python
def test_committed_contract_matches_the_app() -> None:
    assert json.loads(CONTRACT.read_text()) == create_app(lab_factory=offline_lab).openapi()
```

- [ ] **Step 2:** Run it and confirm it fails because the contract file is missing.
- [ ] **Step 3:** Implement the export and generate both files. Add `api:check` to `.github/workflows/ci.yml` in the frontend job, after typecheck.
- [ ] **Step 4:** Run `cd backend && uv run pytest tests/test_openapi_contract.py -q`, then `cd frontend && pnpm api:check && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit with `feat(api): committed OpenAPI contract with generated frontend types and drift checks`.

---

### Task 3: Typed client and the one fetch helper

**Files:**
- Create: `frontend/src/api/http.ts`, `frontend/src/api/client.ts`.
- Test: `frontend/src/api/client.test.ts` (with `fetch` stubbed).

**Interfaces:**
- Consumes: `schema.d.ts` (Task 2).
- Produces:
  - `class ApiError extends Error { code: string; retryable: boolean; status: number }`.
  - `request<T>(method, path, { query?, body?, signal?, timeoutMs? }): Promise<T>`. It reads `{error: {error_code, message, retryable}}` on every non-2xx response, and its message is the envelope message.
  - One function per route, for example:
    - `startQuery(body)`, `listRuns(params)`, `getRun(id)`, `cancelRun(id)`, `getRunEvents(id)`;
    - `getReadiness()`, `getModels()`, `listDatasets()`, `getDictionary(id)`, `getRows(id, table, params)`, `getRecord(id, table, rowId)`;
    - `getGraphSchema()`, `getGraphStats()`, `getNode(id)`, `getNeighbours(id, params)`;
    - `getOntology()`, `getConceptMembers(id, market?)`, `getScenarios()`;
    - `listBenchmarks()`, `getLatestBenchmark()`, `getBenchmark(id)`, `getBenchmarkQuestions(runId?)`, `startBenchmark(body)`, `getJob(id)`, `cancelJob(id)`;
    - `getDemoQuestions()`.
  - Each function's parameter and return types come from `paths`.
- `frontend/src/api/backend-run.ts` stays until Phase 6 deletes it together with the v1 views. New code must not import it.

- [ ] **Step 1:** Write the failing tests.

```ts
test("surfaces the envelope message and offers retry on a retryable conflict", async () => {
  stubFetch(409, { error: { error_code: "CONFLICT", message: "a benchmark run is using the graph; try again when it finishes", retryable: true } })
  await expect(startQuery({ question: "q" })).rejects.toMatchObject({ code: "CONFLICT", retryable: true, message: "a benchmark run is using the graph; try again when it finishes" })
})
test("a non-envelope failure becomes a plain message, never a raw body", async () => { /* 502 text/html */ })
test("a timeout aborts and reports it plainly", async () => { /* fake timers */ })
test("query parameters are encoded and bounded values pass through", async () => { /* getRows limit=200 */ })
```

- [ ] **Step 2:** Run them and see them fail.
- [ ] **Step 3:** Implement `http.ts` and `client.ts`.
- [ ] **Step 4:** Run `pnpm test src/api && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit with `feat(frontend): typed API client over the committed contract`.

---

### Task 4: Live stream and the run reducer

**Files:**
- Create: `frontend/src/api/stream.ts`, `frontend/src/run/reduce.ts`.
- Test: `frontend/src/api/stream.test.ts`, `frontend/src/run/reduce.test.ts`.
- Fixture: `frontend/src/run/fixtures/run-abc.json`.
  - It is a run captured from the API with the fake generator on the tiny world, using a small capture script, `frontend/scripts/capture-run.mjs`.
  - Phase 6 adds the recorded live-model run.

**Interfaces:**
- Produces:
  - `subscribeRun(runId, { onEvent, onEnd, onError }, { after? }): () => void`.
    - It uses `EventSource` on `/queries/{id}/events/stream`.
    - It tracks the last sequence and resumes with `?after=` after a reconnect. Browsers cannot set `Last-Event-ID` on a new `EventSource`, but they replay it on automatic reconnects.
    - It stops on `run.completed`, `run.failed` or `run.cancelled`.
    - It gives up after 5 failed reconnects, with an `ApiError`.
  - `type RunEvent = components["schemas"]["RecordedEvent"]`.
  - `RunState`, which holds:
    - `status`;
    - `pipelines: Record<PipelineId, PipelineState>`, where each `PipelineState` holds `status`, `stages`, `candidates`, `selected`, `discarded`, `answer`, `error`;
    - `graph: Record<"B" | "C", GraphEvents>`, the ordered node and relationship events with outcomes;
    - `lastSequence`.
  - `reduce(state: RunState, event: RunEvent): RunState`, which is pure and ignores any event whose `sequence` is at or below `lastSequence`.
  - `reduceAll(events: RunEvent[]): RunState`.
- Event types are those in docs/07 section 8, plus the run and pipeline lifecycle types.
  An unknown event type is kept in `RunState.unknown`, counted and listed, never dropped silently.

- [ ] **Step 1:** Write the failing tests.

```ts
test("resumed stream state equals uninterrupted", () => {
  const events = fixture.events
  const cut = 7
  const resumed = reduceAll([...events.slice(0, cut), ...events.slice(cut - 2)])  // overlap replays two
  expect(resumed).toEqual(reduceAll(events))
})
test("a terminal event ends the run state", () => { /* run.cancelled → pipelines skipped/cancelled as in the payloads */ })
test("unknown event types are kept and counted", () => { /* ... */ })
test("subscribeRun resumes with after= the last sequence and closes on run.completed", () => { /* fake EventSource */ })
test("subscribeRun gives up after five failed reconnects with an ApiError", () => { /* ... */ })
```

- [ ] **Step 2:** Run them and see them fail.
- [ ] **Step 3:** Implement it, and capture the fixture against a running backend. Use `make serve-api` with `GENERATION_PROVIDER=fake` on the tiny world.
- [ ] **Step 4:** Run `pnpm test src/api src/run`. Expected: PASS.
- [ ] **Step 5:** Commit with `feat(frontend): server-sent run stream with resume and a pure run reducer`.

---

### Task 5: Replay clock

**Files:**
- Create: `frontend/src/run/replay.ts` (a pure clock) and `frontend/src/run/use-replay.ts` (a React hook).
- Delete: `frontend/src/state/use-run-playback.ts` and its test, after moving the reduced-motion test here. Before deleting, update every v1 import to the new hook.

**Interfaces:**
- Produces:
  - `createReplay(events: RunEvent[], { reducedMotion: boolean }): Replay`.
  - `Replay` exposes `state(cursor)`, `play`, `pause`, `step(+1 | -1)`, `seek(ms)`, `speed(0.5 | 1 | 2 | 4)` and `reset`.
  - The cursor is a `t_ms` position across the three tracks.
  - Under reduced motion, `play` jumps straight to the end state.
  - `useReplay(events, options) -> { state: RunState, cursor, playing, controls }`.
- Timing comes only from the events' `t_ms`, with no invented durations.

- [ ] Steps 1-5 in TDD as above.
  - The tests cover: step and seek give `reduceAll` of the events up to the cursor; speed scales elapsed time; reset returns to the start; reduced motion means `play()` lands on the end state.
  - Commit with `feat(frontend): replay clock over recorded event time`.

---

### Task 6: Graph view model and textual alternative

**Files:**
- Create: `frontend/src/graph/model.ts` and `frontend/src/graph/evidence-path-list.tsx`.
- Test: `frontend/src/graph/model.test.ts` and `frontend/src/graph/evidence-path-list.test.tsx`.

**Interfaces:**
- Consumes: `RunState.graph[B|C]` (Task 4) and `EVIDENCE_STATES` (Task 1).
- Produces:
  - `graphView(events: GraphEvents, options: { cap: number; focus: boolean; overlay?: GraphEvents }): GraphView`.
  - `GraphView` holds:
    - `nodes: GraphNodeView[]`, each with `id`, `label`, `kind`, `state: EvidenceState`, `hop`, `onPath`, `addedByOntology`, `clusterId?`;
    - `edges`, each with `id`, `source`, `target`, `relationship`, `state`, `onPath`;
    - `clusters`, each with `id`, `label`, `count`, `members`;
    - `path`, the ordered node ids from seed to selected evidence.
  - `DEFAULT_VISIBLE_NODE_CAP = 60`.
  - Clustering rule: above the cap, nodes that are not on the path and not seeds are grouped by `(hop, label)`, largest group first, until the visible count is at most the cap. A cluster shows a count, for example "Player × 37", and is never hidden.
  - `addedByOntology` is true for C's nodes that are absent from B's events when `overlay` is B's events.
- `EvidencePathList` renders an ordered list of the path. Each item gives the state label, the node label and the relationship that reached it.

- [ ] Steps 1-5 in TDD.
  - The tests cover: every displayed node comes from an event; the clustering cap is respected and nothing is dropped; the path order equals the event order; ontology-added detection works; the list matches the path; and replay under reduced motion shows the end state (with `use-replay` and the list).
  - Commit with `feat(frontend): graph view model from recorded events, clustering and evidence-path list`.

---

### Task 7: Graph canvas on @xyflow/react with elkjs

**Files:**
- Create: `frontend/src/graph/layout.ts`, `frontend/src/graph/graph-canvas.tsx`, `frontend/src/graph/node.tsx`, `frontend/src/graph/edge.tsx`.
- Delete: `frontend/src/components/graph-canvas.tsx` and `graph-pane.tsx`, after moving their v1 users to the new canvas.
- Test:
  - `frontend/src/graph/graph-canvas.test.tsx`
  - `frontend/e2e/graph-canvas-200.spec.ts`, which uses a generated 200-node event fixture built from the fixture's event shapes.
- Deps: `pnpm add @xyflow/react elkjs`.

**Interfaces:**
- Consumes: `GraphView` (Task 6).
- Produces: `<GraphCanvas view onSelectNode(id) focusMode presentation />`.
- Layout:
  - `elkjs` layered layout, direction RIGHT.
  - Positions of nodes already placed are kept, so expansion never jumps.
  - The layout runs off the main thread through `elk.bundled.js` with a worker if Vite supports it; otherwise it runs async with a 200-node budget of 300 ms.
- Nodes:
  - DOM-rendered.
  - Each has the state's shape, icon and colour, the node label, and `aria-label` "<state label>: <label>".
  - Labels are at least 14 px, or 20 px in presentation mode.
- Edges carry their relationship name in plain words, for example "affected game".
  The mapping from relationship type to plain words lives in `design/relationships.ts`, generated from the graph schema's types.
- Focus mode dims everything off the path to 25 percent opacity.
- Keyboard:
  - Tab enters the canvas and arrow keys move between connected nodes.
  - Enter opens `onSelectNode`.
  - `+` and `-` zoom, and `0` fits.
- Expansion follows the replay cursor only.
- Reduced motion turns layout transitions off.

- [ ] Steps 1-5 in TDD.
  - The unit tests cover: one DOM node per view node; edge labels present; focus mode dims non-path nodes; arrow keys move focus along edges; Enter calls `onSelectNode`; positions are stable when nodes are added.
  - The Playwright spec at 1920 by 1080 checks that 200 nodes cluster to the cap, that first layout is under 1 s, and that zoom, pan and focus respond in under 100 ms.
  - Commit with `feat(frontend): graph canvas on @xyflow/react with elkjs layered layout`.

---

### Task 8: Chart primitives

**Files:**
- Create: `frontend/src/charts/scale.ts`, `stat-tile.tsx`, `grouped-bars.tsx`, `interval-plot.tsx`, `data-table.tsx`, `legend.tsx` and `tooltip.tsx`.
- Test: `frontend/src/charts/*.test.tsx`.

**Interfaces:**
- `StatTile({ label, value, unit, interval?: [low, high], n?, groups? })` is a hero number in tabular numerals, with its interval and counts in muted text.
- `GroupedBars({ groups: { key, label, values: Record<PipelineId, number | null> }[], intervals?, delta?: [PipelineId, PipelineId], unit, domain })`:
  - one axis;
  - pipeline colours in fixed order;
  - a 2 px surface gap between bars;
  - 4 px rounded data ends;
  - the delta drawn as a bracket labelled with its value;
  - null drawn as "no value", never as zero.
- `IntervalPlot({ rows: { label, mean, low, high, n, groups, inFamily }[], zero: true })` is the comparison view, with a vertical zero line and rows labelled with "N pairs in M groups".
- `DataTable` is the table view for every chart. A "Show as table" toggle is present on every chart.
- `Legend` is shown whenever there are 2 or more series. Direct labels are added when there are 4 or fewer.
- `Tooltip` gives hover and focus details per mark. The hit target is larger than the mark, and keyboard focus moves between marks.
- No chart library is used. Scales are linear, in `scale.ts`.

- [ ] Steps 1-5 in TDD.
  - The tests cover: null is never drawn as a zero-height bar; the delta bracket value equals the difference; the interval endpoints map through the scale; the legend appears only for 2 or more series; text never uses a series colour; every chart offers a table; tooltips are reachable by keyboard.
  - Before committing, render a gallery story through Task 11 and look at it.
  - Commit with `feat(frontend): SVG chart primitives following the dataviz method`.

---

### Task 9: Shell, router, Settings, presentation mode, panels and drawers

**Files:**
- Rewrite: `frontend/src/app/shell.tsx` (a left sidebar with icons and the five destinations) and `frontend/src/app/router.ts` (five routes, with legacy routes redirected).
- Create:
  - `frontend/src/app/settings-drawer.tsx`
  - `frontend/src/app/presentation.ts`
  - `frontend/src/components/panel.tsx`
  - `frontend/src/components/drawer.tsx`
  - `frontend/src/components/evidence-drawer.tsx`
- Delete these v1 pages and their tests:
  - `views/scenario-lab.tsx`
  - `views/benchmark-runner.tsx`
  - `views/evidence-explorer.tsx`
  - `views/semantic-layer.tsx`
- Map the remaining v1 views to destinations until Phase 6 replaces them:
  - `experiment-home` becomes Overview;
  - `live-lab` becomes Live Lab;
  - `results-dashboard` becomes Results;
  - `data-dictionary` becomes Data Model;
  - `help` becomes Help.
- Test: `frontend/src/app/shell.test.tsx` and `frontend/src/components/drawer.test.tsx`.

**Interfaces:**
- Router:
  - Routes are `#/overview` (the default), `#/live-lab`, `#/results`, `#/data-model` and `#/help`.
  - Legacy redirects:
    - `#/lab` goes to `#/live-lab`;
    - `#/experiment` goes to `#/overview`;
    - `#/dictionary` and `#/semantic` go to `#/data-model`;
    - `#/scenarios` goes to `#/data-model`;
    - `#/benchmark` goes to `#/results`;
    - `#/evidence` goes to `#/live-lab`.
- Header:
  - the product name;
  - the active dataset name, from `listDatasets()` where `active` is set;
  - model status, from `getReadiness()`, shown as one dot plus words such as "Ready" or "Models not reachable", with the check details in a menu;
  - the presentation toggle;
  - Settings.
  The header shows no seeds or versions.
- Settings drawer: world and scenario seeds, generator and ontology versions, and model identifiers from `getModels()` and the dataset detail. Reduced motion and the visible-node cap are both preferences, stored per browser in localStorage, with every access in try and catch.
- `<Panel state="ready" | "loading" | "empty" | "error" | "disabled" title purpose? onRetry?>` gives one consistent look for each state. The error state shows the `ApiError` message, and a retry button when `retryable` is set.
- `<Drawer>`:
  - `role="dialog"` and `aria-modal`;
  - focus trapped while open;
  - Escape closes it;
  - focus returns to the opener.
- `<EvidenceDrawer source={ { kind: "record", datasetId, table, rowId } | { kind: "node", nodeId } | { kind: "chunk", ... } } />`:
  - It shows the record first, from `getRecord` or `getNode`.
  - It then shows provenance as metadata.
  - Its position on the evidence path arrives in Phase 6.
- Presentation mode:
  - It hides the sidebar and raises the type scale by one step.
  - It binds keys globally while active: Space plays or pauses, the right arrow steps, and R resets. The keys are routed to the active replay through a context.
  - Its state is part of the URL (`?present=1`), so a reload keeps it.

- [ ] Steps 1-5 in TDD.
  - The tests cover:
    - five links in order, each with its purpose sentence;
    - the default route is Overview;
    - the legacy redirects;
    - the header holds only the five allowed items;
    - Settings shows the API values;
    - Panel renders each state;
    - "drawer traps focus and returns it to the opener";
    - presentation hides the nav and the keys reach a replay;
    - localStorage failures do not break the shell.
  - Commit with `feat(frontend): five-destination shell, Settings, presentation mode, panels and drawers`.

---

### Task 10: Copy rules enforced

**Files:**
- Create: `frontend/src/copy/banned-words.test.ts`, which scans string literals and JSX text in `src/**/*.tsx` and `src/**/*.ts`. Tests, `schema.d.ts` and identifiers are excluded.
- Create: `frontend/src/copy/glossary.ts`, which holds the plain terms the screens use. For example, "starting point" replaces "seed", "passage" replaces "chunk", and "reranked" becomes "judged".
- Modify: fix every banned word in files this phase created or kept.
  The v1 views that Phase 6 rewrites (`live-lab`, `results-dashboard`, `data-dictionary`, `help` and `experiment-home`) are listed in one exclusion constant, `PHASE6_REWRITES`. That constant carries a comment, and a test fails if any file in it no longer exists, so the list cannot outlive the files.

- [ ] Steps 1-5 in TDD.
  - The tests cover: the banned list is exact; a planted string fails the scan; identifiers and API field names pass; the v1 pipeline names "Baseline" and "Ontology" are banned in new code; and the exclusion list only names files that exist.
  - Commit with `test(frontend): product copy rules enforced on new code`.

---

### Task 11: Visual and end-to-end baselines for the foundation

**Files:**
- Create: `frontend/src/dev/gallery.tsx`, a page that renders every primitive in every state from the committed fixture.
  - It is reachable only at `#/__gallery`, and only when `import.meta.env.MODE !== "production"`.
  - It is excluded from the production build, and a test checks it is absent from `dist/`.
- Modify: `frontend/e2e/visual.spec.ts`. Replace the v1 dark baselines with:
  - the shell on each destination;
  - the Settings drawer;
  - the evidence drawer;
  - presentation mode;
  - every gallery section (tokens, evidence states, every chart in every state, the graph canvas at 12 and at 200 nodes, and focus mode).
- Modify: `frontend/e2e/smoke.spec.ts` (five destinations and the default route).
- Docs: `docs/ux/information-architecture.md` rewritten for five destinations, and `docs/ux/screen-specifications.md` marked superseded by the spec for v2 screens until Phase 6 rewrites it.

- [ ] **Step 1:** Write the specs.
- [ ] **Step 2:** Generate the baselines on the owner's machine: `pnpm e2e:visual --update-snapshots`, at 1920 by 1080 with reduced motion. Look at every image and fix anything that looks off before committing (AGENTS.md: pixel perfection).
- [ ] **Step 3:** Run `pnpm e2e && pnpm e2e:visual`. Expected: PASS.
- [ ] **Step 4:** Commit with `test(frontend): foundation gallery, visual baselines and smoke for five destinations`.

---

### Task 12: Decisions and status

**Files:**
- Modify: `DECISIONS.md` with rows D-039 to D-043, dated 2026-10-20, each marked "Proposed (controller ruling, for owner review at CP2)" unless the owner decided it:
  - D-039: chart primitives in SVG without a library, and why.
  - D-040: `lucide-react` as the one icon set.
  - D-041: `@fontsource-variable/inter`, served locally for offline projectors.
  - D-042: `openapi-typescript` and the committed contract with drift checks.
  - D-043: `elkjs` layered layout with stable positions, visible-node cap 60 with clustering, and no fabricated activity.
- Modify: `HITL_STATUS.md` with a row "Phase 5 Frontend foundation", status BUILT, no checkpoint. CP2 follows Phase 6.

- [ ] **Step 1:** Write the rows. Each states the alternatives considered.
- [ ] **Step 2:** Run the full gates:
  - backend: `cd backend && uv run pytest -q -W error`, because Task 2 added the contract test;
  - frontend: `cd frontend && pnpm format:check && pnpm lint && pnpm typecheck && pnpm api:check && pnpm test && pnpm build && pnpm e2e`.
- [ ] **Step 3:** Commit with `docs: Phase 5 decisions and status`.

---

## Not in this plan

- The screens Overview, Live Lab, Data Model and Help, built on these primitives, plus the recorded live-model run fixture and deleting `mock/` and `api/backend-run.ts`: Phase 6, then CP2.
- The Results screen: Phase 7.
- The copy pass on Help and the documentation cut: Phase 7.

## Self-review notes

- Spec 7.1:
  - five destinations, purpose sentences, the header limits, Settings, the evidence drawer frame: Task 9;
  - removed pages: Task 9.
- Spec 7.2:
  - light theme, contrast, pipeline hue, tint and strong tones, evidence-state shapes and icons, Inter, type scale, tabular numerals, 8 px grid, shadows, one icon set, `@theme`: Task 1;
  - charts per `dataviz`: Task 8.
- Spec 7.4:
  - canvas requirements (layout engine, legible labels, edge names, zoom and pan, focus, clustering, progressive expansion by events, keyboard): Tasks 6 and 7;
  - timeline scrubber model: Task 5 (the UI arrives in Phase 6);
  - evidence drawer: Task 9;
  - presentation mode: Task 9.
- Spec 7.8:
  - names: Task 1;
  - banned words: Task 10.
- Spec 7.9:
  - states: Task 9's Panel and every primitive;
  - keyboard, focus trap, reduced motion, textual alternative: Tasks 6, 7 and 9;
  - baselines: Task 11.
- Spec 12, the 200-node risk: Task 7's Playwright spec.
- Type chain:
  - `schema.d.ts` (Task 2) feeds the client (Task 3) and the stream and reducer (Task 4);
  - `RunState` (Task 4) feeds replay (Task 5) and the graph model (Task 6);
  - `GraphView` (Task 6) feeds the canvas (Task 7);
  - `ApiError` (Task 3) feeds Panel (Task 9).
