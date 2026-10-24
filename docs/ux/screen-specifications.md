# Screen Specifications

> Note.
> This file describes the five screens as built in Phase 6, on the branch `overhaul/v2`.
> It was written from the code, not from the wireframes of the first version of the product, which it replaces.
> The design intent is section 7 of `docs/superpowers/specs/2026-10-18-overhaul-design.md`.
> Where this file and that section differ, the difference is a decision for the owner and is listed in `DECISIONS.md` (D-046 onwards) as "Proposed".
> The shell and navigation as built are in `docs/ux/information-architecture.md`.
> The visual language is in `docs/ux/visual-language.md`.

## 0. How to read this file

Each screen section gives, in this order, its purpose sentence, layout, data sources, states, keyboard and presentation behaviour, and the baseline images that show each state.
Baseline images are in `frontend/e2e/visual.spec.ts-snapshots/` and their names end in `-darwin.png`.
Baselines whose names contain `fixture-official` show test fixture numbers and headlines, not results.
No full official run exists yet, so the screens that would show one are drawn from a made-up test run.
Its counts agree with the question bank and its headlines are neutral, but none of it is a measurement.

Every screen has a frame from one table of destinations (`frontend/src/app/router.ts`).
The frame writes the purpose sentence first, then the heading, so no screen words its own purpose.
Content sits in panels (`frontend/src/components/panel.tsx`), and a panel has one look for each of five states:

- normal: the content;
- loading: a skeleton of the content to come, with a visible "Loading" text and `aria-busy`;
- empty: a sentence saying why there is nothing;
- error: the server's plain message, with a Retry button when the error is retryable;
- disabled: a sentence saying why the panel cannot be used.

The routes are hash routes, so every screen and tab is a link, and a refresh reopens the same place.
The routes of the first version of the product (`#/lab`, `#/experiment`, `#/dictionary`, `#/semantic`, `#/scenarios`, `#/benchmark`, `#/evidence`) redirect to the screen that took their place.

### 0.1 The shell

The shell is a left sidebar with the five destinations, and a header with the product name, the active dataset, the model status, the presentation toggle and Settings.
The sidebar collapses to icons and stays in view on long pages.
The model status opens a list of the readiness checks (retrieval lab, search index, graph database, answer model).
Settings holds reduced motion and the visible-node cap for graphs (from 12 to 60 nodes, further nodes are grouped).
A "Skip to content" link is the first focusable element.
Live Lab and Data Model use a wide content column (110 rem), and the others use a reading column.

Presentation mode is a header button (`aria-pressed`, with an "On" check mark) and the query parameter `?present=1`.
It hides the sidebar and raises the type scale through the design tokens.
While it is on, Space plays or pauses the replay of the screen being shown, the right arrow steps it, and R resets it.
Those keys belong to whatever has focus when it is a button, link, tab, text field or open dialog.
Only Live Lab registers a replay.

Baselines: `shell-overview`, `shell-live-lab`, `shell-results`, `shell-data-model`, `shell-help`, `shell-collapsed`, `shell-presentation`, `shell-settings`, `shell-model-status`, `shell-evidence-drawer`.

## 1. Overview

Purpose: the verdict from the latest official run, how the three approaches differ, and a button to run a question.

### 1.1 Layout

From top to bottom:

1. "Latest official run": one tile for each approach (A, B, C) in its own tint.
   Each tile shows "Evidence score, all questions" as a number from 0 to 1 with two decimals, then the number of questions and runs behind it.
   A key line follows: "Evidence score: 1 is all the needed evidence and nothing extra. Intervals are for the differences below."
   The headline sentences from the run's summary follow, verbatim and unedited.
2. "How the three approaches differ": a flow diagram.
   The question fans out to one shared "Search passages" lane.
   B has the lane "Find starting points", "Follow relationships".
   C has "Find starting points", "Add ontology terms", "Follow relationships", "Add linked records".
   All lanes join at one shared "Re-order and pick", then "Answer with sources".
   The lane order comes from one module (`run/lanes.ts`), and the test "the order of the steps against the recorded events" in `run/lanes.test.ts` pins it to the order in which the first event of each stage arrives in the four recordings and the fixture run.
3. Two panels side by side: "Run a question" and "Configuration".
   "Run a question" has a "Run a question" button to Live Lab and the four demo questions, each a link to Live Lab with that question chosen.
   "Configuration" lists the active dataset in plain words and the four model roles (answer, embedding, re-ordering, keyword search) with the configured model names.

### 1.2 Data sources

- `GET /api/v1/benchmarks/latest` for the tiles and headlines.
  A 404 is not a failure: it means no run is published.
- `GET /api/v1/demo/questions` for the four demo questions (D-036).
- `GET /api/v1/datasets` and `GET /api/v1/models` for the configuration.
- Nothing on this screen is computed.
  The tiles show the mean of the run's own summary, with its question count and repeats.

Tiles carry no interval for one approach on its own, because `docs/evaluation/statistics.md` defines intervals for differences only (D-048).
The intervals reach the screen through the headline sentences.

### 1.3 States

- Normal: the tiles fill only for a run of the whole bank with kind "official" (no strata filter, no instance limit).
- No official run: "No official run yet", and a link to Results.
  If the newest run is another kind (a quick check, a depth sweep, or a subset) it is named in words ("Latest run: scorer smoke test") and carries no number.
- Loading: a skeleton of three tiles, and a skeleton in each other panel that is still loading.
- Error: the panel that failed shows its message and a Retry button.
  The other panels still draw.
- Empty: "Run a question" says "No demo questions are available." when the list is empty.
  The tiles have no separate empty state, because "No official run yet" is that state.
- Disabled: not used.

### 1.4 Keyboard and presentation

Every link and button is a native element in reading order, with a visible focus ring.
In presentation mode the type is larger and the sidebar is gone.
The flow diagram does not grow with the type scale, which is a known gap.

### 1.5 Baselines

- `overview-fixture-official` (test fixture numbers and headlines, not results)
- `overview-no-official-run`
- `overview-smoke-only`
- `overview-error`
- `overview-loading`
- `presentation-overview-fixture-official` (test fixture numbers and headlines, not results)

## 2. Live Lab

Purpose: run one question through all three approaches and watch them work.

### 2.1 Layout

From top to bottom, with the first screen at 1920 by 1080, while a run is going, holding the question bar, the graph, the three panels and the timeline:

1. Question bar.
   Before a run it is open: the four saved questions as buttons, a text box "Or ask your own question", the market scope (All markets and the four markets), and the source (Recorded run or Live).
   Once a run has been chosen it collapses to one line: the question (cut off on screen, whole in its tooltip), the status line, the source, a "Change question" button, "Cancel run" while a live run is running, and Run.
   "Change question" opens the whole bar again, and Escape or the same button closes it.
2. Scorecard, only when a run has completed.
   It is a compact table with a row for each approach: Answer, Evidence score, Starting record, Markets reached, Answer writing time, Context size and Reason.
   Rows for B and C show the change against A, with signed deltas.
   Evidence score is 0 to 1 with two decimals.
   Answer writing time is the model's time to write the answer, shown as "<1 ms" when it is none, never as "0 s".
   Reason is the failure class in plain words (D-054), or "No failure recorded".
   A question with no answer key, or with scoring not finished, shows only the measurable rows and a note.
3. Graph canvas on the left (about three fifths of the width, at least 640 px) and the three approach panels on the right.
   The canvas has a tab for B and a tab for C, a toggle that lays the other approach's evidence path over the graph ("Show C's path" on B's tab, "Show B's path" on C's tab), and "Focus on the path".
   Each panel (A, B, C) shows the approach's status, its steps in order with a status word, an icon and a time, and the evidence it has found, used and set aside.
   The steps in each panel and tracker come from the same module as the Overview lanes (`run/lanes.ts`), so C reads "Find starting points", "Add ontology terms", "Follow relationships", "Add linked records", then the steps all three share.
   Under the canvas is the legend.
   The note when evidence is out of view sits in the strip above the drawing, with its "Bring into view" button, and nowhere else.
4. Timeline, docked under both: Rewind, Play or Pause, Replay, a position slider, the time, and speeds 0.5x, 1x, 2x and 4x, with one track for each approach.
   Steps that ran together sit on thin extra rows, so no bar is trimmed.
5. After the run ends: the three answers as the model wrote them (each citation marker is a button), the evidence path rows for B and C, and the market coverage table.

The graph canvas draws only what the run's events record.
A recorded run knows every event, so it is laid out once from the final graph and revealed as the events arrive.
In that layout the nodes of the evidence path are placed first in each layer, which is ordering only: nothing is drawn differently before the path event (D-049).
A live run grows with its stream and settles into the final layout once at the end.
The picture fits the evidence path and the first starting point.
A path larger than the frame fits at the 14 px label floor from the seed, and the strip above the drawing says how many evidence nodes are out of view, with a button that brings them into view (D-050).
Folded groups are opened into a list of their members in the evidence drawer.

On C's graph, nodes that C's own events record as found through the ontology, and that B does not hold at the same point of the run, are marked "added by the ontology" (D-052).
The overlay of the other approach's path needs the run's stored results, so during a live run it says "Available once the run ends." (D-051).

### 2.2 Data sources

- Recorded runs: four real captures through the API, in `frontend/src/run/fixtures/recorded/`, loaded on demand one file at a time (D-056).
  A small index (`index.json`) is always loaded, and a test checks it matches the files.
  Each recording names the world it was captured on (`dataset_id`, written by `scripts/capture-run.mjs`).
  A record or node opened from a recording is refused, with a plain message in the drawer, when the active dataset is another world.
  A passage the results carry in full still opens.
- Live runs: `POST /api/v1/queries`, then the event stream `GET /api/v1/queries/{id}/events/stream`, resumed with `?after=` if the connection drops, then `GET /api/v1/queries/{id}` for the stored results.
  A bank question is scored after the run with the benchmark runner's deterministic scorer, and the scorecard says it is scored against the answer key.
  `POST /api/v1/queries/{id}/cancel` stops a run.
- `GET /api/v1/demo/questions` for the saved questions, `GET /api/v1/datasets` for the dataset the evidence drawer reads from, `GET /api/v1/health/ready` for whether Live can run.
- The evidence drawer reads the recorded results and, for a record or a node, the Data Model endpoints.
- A live run becomes replayable from its own stored events as soon as it ends.
- The market coverage table counts only markets the stored results carry (D-053).
- No expected answer or truth ledger value is on this screen except the scorecard's scores, which come from the stored score.

### 2.3 States

- Idle (normal before a run): "Choose a question and press Run."
  Nothing looks chosen, Run is disabled, and the canvas place says "The graph appears when a run starts."
  The three panels are at their running height.
- Disabled: Run is disabled while a run is starting or in progress, or when no question is chosen ("Pick a question or type one.").
  Live is disabled with the plain reason when the backend is not ready ("The backend is still starting.", "The graph database is not ready: ...").
  Your own question can only run live, so it says "Your own question needs the live source." when Live is off.
  A saved question's market scope is shown locked, as "Set by the question".
- Loading: "Loading the saved questions." in the bar, "Loading the recorded run." while a recording is fetched.
- Running (live): "The run is in progress.", the panels and timeline fill as events arrive, and Cancel run is shown.
- Paused or replaying: "Paused at 1.2 s of 26.4 s." or "Playing the recorded run.".
- Completed: "The run is complete.", with the scorecard, answers, paths and coverage.
- Cancelled: "The run was cancelled."
  Steps that never started read "Not reached", and the cancelled step carries a hatched bar and the word "Cancelled".
- Failed or interrupted: "The run failed: " with the recorded reason, or a lost-connection message when the stream ended without an end event.
- Error: a notice with the message and a Retry button when repeating can help.
  A second run while the graph is leased by a benchmark job shows the API's 409 message.
  A bank question's score is read up to five more times, a second apart, while it is still being written.
  If it is still not there, the notice says "The score is still being written." and Retry reads it again from the start.
- Empty: a pipeline that did not run reads "Not started".
  A pipeline with no recorded path says "No evidence path was recorded." only after it has ended.
  Stages that a finished pipeline never took read "Not run".
  Not every C run has ontology events (the recorded H3 run has none), so nothing assumes them.

### 2.4 Keyboard and presentation

- Every control is a native button or input with a visible focus ring.
- The graph tabs follow the tab pattern: arrow keys move between B and C.
- The nodes of the graph open the evidence drawer from the keyboard with Enter, and focus returns to the node when it closes.
- The citation markers, the evidence rows and the path strip nodes are buttons that open the same drawer, and focus returns to the opener.
- Opening the question bar moves focus to the first saved question.
  Running from it keeps focus on Run, and closing it returns focus to "Change question".
- The timeline slider has a text value ("1.2 s of 26.4 s"), and every track has a text summary.
- A text alternative of the graph (the evidence path list) is read by screen readers.
- Reduced motion (the operating system's, or Settings) removes motion from the canvas.
- In presentation mode, Space, the right arrow and R drive the replay.
  The canvas is taller, and the type is larger.

### 2.5 Baselines

- `live-lab-idle`
- `live-lab-live-running`
- `live-lab-h1-mid-replay-paused`
- `live-lab-h1-end-b`, `live-lab-h1-end-b-lower`, `live-lab-h1-end-c`
- `live-lab-h3-end-c-overlay`
- `live-lab-cancelled`
- `live-lab-ad-hoc-end`
- `live-lab-error-409`
- `live-lab-evidence-drawer`
- `live-lab-presentation-end`

## 3. Results

Purpose: every official run, every question, every score, with intervals.

This is a stopgap in Phase 6.
The full screen is Phase 7, and the purpose sentence promises more than the stopgap shows.

### 3.1 What the stopgap list shows

- A list of published benchmark runs, newest first, as cards.
- Each card shows the date, the kind (Official run, Quick check run, Depth sweep), the label, a "Subset" line when the run did not cover every stratum or instance, the run's headline sentences, and a link "Reproducibility record (JSON)".
- That link goes to the raw JSON from the API in a new tab.

### 3.2 What is not built yet (Phase 7)

- Starting a benchmark run.
- Charts of the scores and intervals.
- The per-question table.
- The efficiency panel (time, context size, cost).
- The failure classes.
- A reproducibility panel in place of the raw JSON link.

### 3.3 Data sources

`GET /api/v1/benchmarks` only.
Headlines come with each run in that list, so there is no per-run fetch.

### 3.4 States

- Normal: the cards.
- Loading: a skeleton, with "Loading Benchmark runs" as text.
- Empty: "No benchmark runs yet."
- Error: the server's message, with Retry when it is retryable.
- Disabled: not used.

### 3.5 Keyboard and presentation

Cards are articles with their date as the heading, and the link is a native link.
In presentation mode the type is larger.

### 3.6 Baselines

- `results-list`
- `results-empty`
- `results-error`
- `results-loading`
- `presentation-results`

## 4. Data Model

Purpose: what the warehouse, the graph and the ontology look like, with live counts and sample rows.

### 4.1 Layout

A row of four tabs, each a link: Warehouse, Graph, Ontology, Scenarios.
The tab is in the route (`#/data-model?tab=graph`), so the back button works.
The Warehouse tab is the default.
In presentation mode the type in the maps is raised by a factor of 1.4.

#### Warehouse

- A map of the warehouse tables as boxes with their live row counts and the links between them (one panel for each source system, with its table and row totals).
  The real data dictionary has one source system, so the map is one group of 27 tables.
- Choosing a table (`?table=`) shows its source system, row count, column count, the tables it links to (each a link), and its sample rows, fifty to a page, with the total.
- A filter takes one column and one value.
  The server reads the value as that column's own type, so a timestamp copied from a row finds that row.
  A value that does not fit the type comes back as a message, shown as it is.
- Paging keeps the filter.
- A row opens as a record in the evidence drawer, with "Follow into the graph" when the record has a graph node.

#### Graph

- "Kinds of record": the graph's labels as boxes sized by count, with the relationships between them.
  Three views: B's relationships, C's relationships, and the full schema.
  The full meta-graph has 24 connected labels and is dense; the labels are tagged by kind to help.
- Choosing a kind shows its properties, the warehouse table it comes from (the label's `node_tables` entry), and a sample node.
- A node address (`?node=`) shows that node's properties and up to 20 of its neighbours.
  The drawer says "Built from the ontology: no sample row." for labels that come from the ontology and not from a table.

#### Ontology

- A tree of concepts, with a concept card for the chosen concept (`?concept=`): its definition, the relationships it takes part in, and the local terms bound to it, listed by market.
- A market filter on the members.
  The number of shared codes (a code several markets use) is always shown, even under a filter.
- Concepts with no binding say so in one line.

#### Scenarios

- A card for each planted scenario, with its title and id, its strength and noise level, the rows planted in each table, and a link to its story in Help.
- A scenario that is not in the active world says "Not planted in this world", and one with no rows says "No rows planted."

### 4.2 Data sources

- Warehouse: `GET /api/v1/datasets`, `GET /api/v1/datasets/{id}/dictionary`, `GET /api/v1/datasets/{id}/tables/{table}/rows` and `GET /api/v1/datasets/{id}/tables/{table}/rows/{row_id}`.
- Graph: `GET /api/v1/graph/schema` (with the source table of each label), `GET /api/v1/graph/stats`, `GET /api/v1/graph/nodes/{id}` and `GET /api/v1/graph/nodes/{id}/neighbours`.
- Ontology: `GET /api/v1/ontology` (each concept carries its definition) and `GET /api/v1/ontology/concepts/{id}/members`.
- Scenarios: `GET /api/v1/scenarios`.
- All data is synthetic, and no truth ledger value is shown.

### 4.3 States

Each tab has its own normal, loading, empty and error state.

- Loading: the panel's skeleton with "Loading" and the panel's title (for example "Loading Kinds of record").
- Empty: "No data has been generated yet." (Warehouse), "The graph has no kinds of record yet.", "The ontology has no concepts yet.", "No scenarios are defined."
  A table with no rows says so, and so does a filter that matches nothing.
  A table or concept that does not exist says "There is no table called ...".
- Error: the message, with Retry when it can help, in the panel that failed.
- Disabled: the details panel of an ontology-only label.

### 4.4 Keyboard and presentation

- Tabs are links, with the current one marked.
- Maps are keyboard-focusable: each box takes focus and opens its table or its details, and the drawers return focus to the box that opened them.
- Label text on the maps keeps at least 12 px, checked by a test.
- The ontology tree is an ARIA tree: arrow keys move, and Enter or Space chooses.
- In presentation mode the maps are taller.

### 4.5 Baselines

- Warehouse: `data-model-warehouse-map`, `data-model-rows-filtered`, `data-model-record-drawer`, `data-model-loading`, `data-model-error`, `data-model-empty`.
- Graph: `data-model-graph-full`, `data-model-graph-label-tagged`, `data-model-graph-focused-node`, `data-model-graph-loading`, `data-model-graph-error`, `data-model-graph-empty`.
- Ontology: `data-model-ontology-national-draw`, `data-model-ontology-filtered-by-market`, `data-model-ontology-loading`, `data-model-ontology-error`, `data-model-ontology-empty`.
- Scenarios: `data-model-scenarios`.
- `presentation-data-model`.

## 5. Help

Purpose: how it works in plain language, every benchmark question with its answer key, glossary, how to run it.

Help is the one screen that shows answer keys and hidden truths, because they are the scoring reference and not an input to any approach.

### 5.1 Layout

A row of eight section links at the top, then eight panels in this order:

1. What we are testing: the question the experiment asks, and the flow diagram.
2. The three approaches: A, B and C in plain words, and what each adds.
3. The data: the synthetic world and where each approach looks.
4. The planted stories: each scenario with its hidden truth, as the bank gives it.
   SCN-007 is the worked example.
5. The questions: every benchmark question with its answer key, grouped by question, with a row for each instance, and each approach's scores when a whole-bank official run backs them.
   Two filters, by kind of question and by story, live in the route, so a filtered table is a link.
6. How scoring works, in four parts: Evidence found (the evidence score, 0 to 1), Correct answer, Judge, and Intervals (how a difference is judged).
7. Glossary: twelve terms in plain words.
8. Running it: the bring-up commands, the recovery table and the model configuration.
   This is the one section that names vendors and commands.
   Every command is a Makefile target, and a test checks it.

The route's `section` scrolls to a section, and `story` marks one story and filters the questions.

### 5.2 Data sources

- `GET /api/v1/benchmarks/questions` and `GET /api/v1/scenarios` for the questions and stories.
- `GET /api/v1/benchmarks/latest` to decide whether scores may be shown.
- The rest is written text in `frontend/src/screens/help/`, and the glossary in `frontend/src/copy/glossary.ts`.
- Scores are shown only when the newest run is a whole-bank official run and scored at least one question.
  Otherwise each score cell reads "No official run yet" (or "Scores could not be read", or "Scores are loading").
  The screen never averages scores.

### 5.3 States

- Normal: all eight sections.
- Loading: only the sections that need the question bank (the stories and the questions) show their skeleton and "Loading" text, and the rest of Help reads.
- Empty: "No question matches these filters." with a link to clear them.
  With no official run, the scores read "No official run yet".
- Error: the stories and questions panels show the server's message with Retry, and the other six sections still read.
  If only the latest run cannot be read, the questions show and the scores say they could not be read.
- Disabled: not used.

### 5.4 Keyboard and presentation

- Section links are native links, with the current one marked by `aria-current`.
- Tables have captions and column headers, and the stratum and story filters are native selects.
- In presentation mode the type is larger.
  The flow diagram does not grow with it, which is a known gap.

### 5.5 Baselines

- `help-top`, `help-stories`, `help-glossary`.
- `help-questions-no-official-run`.
- `help-questions-fixture-official-filtered-by-story` (test fixture numbers, not results).
- `help-loading`, `help-error`.
- `presentation-help-fixture-official` (test fixture numbers, not results).

## 6. Components shared by the screens

These have baselines in the development gallery (`#/__gallery`, files named `gallery-*`), and are not screens.
The gallery shows sample values, labelled "Sample values, not results".

- Panel, with its five states: `gallery-panel-*`.
- Evidence drawer: `gallery-drawer-evidence`, `-loading`, `-error`, `-no-source`, and the plain and settings drawers.
- Graph canvas in several sizes, replay and focus mode: `gallery-graph-*`, `gallery-paths-*`, `gallery-summary-*`, `gallery-evidence-states-*`.
- Charts (stat tile, grouped bars, interval plot, data table), with normal, empty, loading, error, disabled, null and negative states: `gallery-chart-*`.
- Design tokens: `gallery-tokens-*`.

## 7. Copy budget

Product copy is counted from the text a person can see, outside tests, fixtures, development pages and text from the API.
The cap is 1,300 words outside Help and 1,650 words in Help prose, and the counts at the time of writing are 1,200 and 1,073 (D-055).
