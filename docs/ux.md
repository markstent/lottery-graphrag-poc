# UX

This page describes the five screens as built, the shared visual language, interaction and accessibility rules, and presentation mode.
The data behind each screen comes from the routes in [api.md](api.md).
The design intent is section 7 of the [overhaul design](superpowers/specs/2026-10-18-overhaul-design.md).

The visual baselines are in `frontend/e2e/visual.spec.ts-snapshots/`, and each one is named below.
Baselines whose names contain `fixture-official` show test fixture numbers and headlines, not results.
No official run exists yet, so screens that would show one are drawn from a made-up test run.
Its counts agree with the question bank and its headlines are neutral, but none of it is a measurement.

## Purpose

The product shows, to a mixed business and technical audience on a projector, whether adding a graph and an ontology gives better answers, and it lets a sceptic check the measurement.
The primary target is a 16:9 desktop at 1920 by 1080, in a light theme.
Plain language is the default, and technical detail is one click away.
Mobile layouts are out of scope.

Names on screen:

| Name | Means |
|---|---|
| A · Text search | Pipeline A |
| B · Graph | Pipeline B |
| C · Graph + Ontology | Pipeline C |
| Evidence score | The evidence F1, from 0 to 1 with two decimals (D-047) |
| Answer writing time | The model's time to write the answer, shown as "<1 ms" when it is none (D-047) |
| Starting point | A seed: where the walk through the graph begins |
| Set aside | Evidence a pipeline judged and did not use |
| Official run | A run of the whole bank with the official settings |

The twelve glossary terms are in `frontend/src/copy/glossary.ts` and are drawn in Help.

## Architecture

### The shell

Every screen sits in one frame from one table of destinations (`frontend/src/app/router.ts`), which writes the purpose sentence first and then the heading.
Routes are hash routes, so every screen and tab is a link and a refresh reopens the same place (D-008).
The routes of the first version of the product (`#/lab`, `#/experiment`, `#/dictionary`, `#/semantic`, `#/scenarios`, `#/benchmark`, `#/evidence`) redirect to the screen that took their place, and query parameters survive the redirect.
Overview is the default.

- A left sidebar lists the five destinations, and collapses to icons.
  The active one carries a heavy bar and bold text, so it does not rely on colour.
- The header carries the product name, the active dataset in plain words (for example "dev world, 2026"), the model status, the presentation toggle and Settings.
- The model status is one button with a dot and a word: Checking, Ready, Starting or Not ready.
  It opens the readiness checks: Retrieval lab, Search index, Graph database, Answer model and Embedding model.
  It polls every 15 seconds while something is not ready and every 60 seconds once all is ready, and pauses while the tab is hidden.
- Settings is a drawer holding reduced motion, the visible-node cap for graphs (12 to 60), the world and scenario numbers, versions, and the model names with their reachability.
- The evidence drawer opens from any citation, evidence row or graph node, and shows the record itself and where it came from.
  It has its own loading, error and "no source record" states.
- A "Skip to content" link is the first focusable element.

Content sits in panels, and a panel has one look for each of five states:

| State | Look |
|---|---|
| Normal | The content |
| Loading | A skeleton of the content to come, with visible "Loading" text and `aria-busy` |
| Empty | A sentence saying why there is nothing, and the action that creates something |
| Error | The server's plain message, with a Retry button when the failure is retryable |
| Disabled | A sentence saying why the panel cannot be used |

Baselines: `shell-overview`, `shell-live-lab`, `shell-results`, `shell-data-model`, `shell-help`, `shell-collapsed`, `shell-presentation`, `shell-settings`, `shell-model-status`, `shell-evidence-drawer`.

### Overview

Purpose: the verdict from the latest official run, how the three approaches differ, and a button to run a question.

1. "Latest official run": one tile for each approach in its own tint, each showing the mean evidence score for all questions with the number of questions and runs behind it.
   A key line explains the score.
   The run's headline sentences follow, verbatim and unedited.
2. "How the three approaches differ": a flow diagram.
   The question fans out to one shared "Search passages" lane.
   B adds "Find starting points" and "Follow relationships".
   C adds "Find starting points", "Add ontology terms", "Follow relationships" and "Add linked records".
   All lanes join at "Re-order and pick", then "Answer with sources".
   The lane order comes from one module (`run/lanes.ts`), and a test pins it to the order of events in the four recordings.
3. "Run a question" and "Configuration" side by side.
   The first has a button to Live Lab and the four demo questions as links.
   The second lists the active dataset and the four model roles with their configured names.

Data: `GET /benchmarks/latest`, `/demo/questions`, `/datasets` and `/models`.
Nothing is computed on this screen.
The tiles fill only for a whole-bank run of kind "official".
With none, the screen says "No official run yet" and links to Results, and a newer smoke or subset run is named in words with no numbers.
The tiles carry no interval of their own, because the statistics define intervals for differences (D-048).
Intervals reach the screen through the headline sentences, and one line says so.

Baselines: `overview-fixture-official`, `overview-no-official-run`, `overview-smoke-only`, `overview-error`, `overview-loading`, `presentation-overview-fixture-official`.

### Live Lab

Purpose: run one question through all three approaches and watch them work.

The layout puts the graph canvas on the left, about three fifths of the width and at least 640 px, and the three approach panels as a rail on the right (D-046).
At 1920 by 1080, the first screen of a running run holds the question bar, the graph, the panels and the timeline.

1. **Question bar.**
   Before a run it is open: the four saved questions, a box for your own question, the market scope and the source (Recorded run or Live).
   Once a run is chosen it collapses to one line with "Change question", "Cancel run" while a live run is going, and Run.
2. **Scorecard**, when a run has completed: a row for each approach with Answer, Evidence score, Starting record, Markets reached, Answer writing time, Context size and Reason.
   B and C show signed changes against A.
   The reason is the failure class in plain words: "the starting record was not found", "the needed evidence was not retrieved", or "the evidence was retrieved but the answer was wrong" (D-054).
   A question with no answer key shows only what can be measured.
3. **Graph canvas** with a tab for B and a tab for C, a toggle that overlays the other approach's evidence path, and "Focus on the path".
   **Three panels** show each approach's status, its steps in order with a word, an icon and a time, and its evidence found, used and set aside.
4. **Timeline**, docked under both: rewind, play or pause, replay, a position slider, the time, speeds 0.5x to 4x, and one track for each approach.
5. After the run: the three answers as the model wrote them, with each citation marker a button, the evidence path rows for B and C, and the market coverage table.

Sources: a **recorded run** replays one of four real captures through the API on the dev world, with qwen3.6 through Ollama and reasoning off (`frontend/src/run/fixtures/recorded/`, D-056).
They need no model, and they are not edited.
A **live run** posts to `/queries`, follows the event stream, resumes with `?after=` if the connection drops, and reads the stored results.
A bank question is scored after the run (D-035).
Your own question can only run live.
Live is disabled with a plain reason when the backend is not ready.

The market coverage table counts a market for an approach only when evidence it used carries that market in its own field, and never reads the question, the scope, the wording of an answer or an id (D-053).

Baselines: `live-lab-idle`, `live-lab-live-running`, `live-lab-h1-mid-replay-paused`, `live-lab-h1-end-b`, `live-lab-h1-end-b-lower`, `live-lab-h1-end-c`, `live-lab-h3-end-c-overlay`, `live-lab-cancelled`, `live-lab-ad-hoc-end`, `live-lab-error-409`, `live-lab-evidence-drawer`, `live-lab-presentation-end`.

States:

| State | What shows |
|---|---|
| Idle | "Choose a question and press Run." Run is disabled. The canvas says "The graph appears when a run starts." |
| Running | The panels and timeline fill as events arrive. Cancel run is shown. |
| Paused or replaying | "Paused at 1.2 s of 26.4 s." or "Playing the recorded run." |
| Completed | The scorecard, answers, paths and coverage |
| Cancelled | Steps that never started read "Not reached", and the cancelled step carries a hatched bar and the word "Cancelled" |
| Failed | "The run failed:" with the recorded reason, or a lost-connection message |
| Error | A notice with a Retry button. A second run while a benchmark job holds the graph shows the API's 409 message. A bank question's score is read up to five more times a second apart, then "The score is still being written." |
| Empty | A pipeline that did not run reads "Not started", and a finished one with no recorded path says "No evidence path was recorded." |

### The graph canvas

The canvas is a primary feature, and it draws only what the run's events record.
Every node and edge is a seed, a traversal, a candidate, selected evidence, set-aside evidence, an ontology concept or a source record.
Nothing is drawn for effect, and the whole enterprise graph is never drawn.

- A recorded run knows every event, so it is laid out once from the final graph and revealed as events arrive.
  The nodes of the evidence path are placed first in each layer, which is ordering only: nothing is styled as on the path until `graph.evidence_path.completed` has been replayed (D-049).
- A live run grows with the stream and settles into the final layout once at the end, with no motion under reduced motion (D-043).
- The picture fits the evidence path and the first starting point.
  A path larger than the frame fits from the starting point at a floor of 14 px for labels.
  The strip above the drawing then says how many evidence nodes are out of view, with a button that brings them in (D-050).
  Six of the eight end states of the four recordings are in this case.
- Nodes beyond the visible cap (default 24, Settings 12 to 60) fold into group nodes, which open as a list in the evidence drawer.
- On C's graph, nodes that C's events record as found through the ontology, and that B does not hold at the same point of the run, are marked "added by the ontology" (D-052).
- The other approach's path overlay needs the run's stored results, so during a live run it reads "Available once the run ends." (D-051).
- Layout is by `elkjs` in a web worker, and drawing by `@xyflow/react`.

Seven evidence states each have their own shape and icon, so colour is never the only cue:

| State | Label | Shape | Icon |
|---|---|---|---|
| seed | Starting point | circle | LocateFixed |
| traversed | Followed | square | ArrowRight |
| candidate | Considered | diamond | Search |
| selected | Used as evidence | hexagon | Check |
| discarded | Set aside | dashed circle | CircleMinus |
| concept | Ontology concept | pill | Shapes |
| source_record | Source record | document | FileText |

Set aside is grey and dashed, because it is not an error.
A concept wears C's tones with its own shape.

### Results

Purpose: every official run, every question, every score, with intervals.

A whole-bank run or a subset shows all panels, and a quick check shows only the Verdict and Reproducibility.

1. **Benchmark runs.** A select of every published run, newest first, with its standing in words (Result, Subset run or Quick check), and a "Start a run" button.
2. **Verdict.** Three tiles, each with the evidence score and the answer score, then the run's headline sentences as the harness wrote them.
   A subset run says what it covered, and a quick check says its numbers are not results.
3. **Scores by kind of question.** A switch between Evidence score and Answer score, grouped bars per kind of question, an interval plot of the paired differences, and an interval plot of the ontology-dependent split marked "Descriptive: not part of the tested family."
   Every chart has a "Show as table" twin.
4. **Questions.** One row per question and world, with filters, the answer, evidence and judge score of each approach, and an expanding table of every measure.
   "Open" goes to the question in Live Lab when its world is loaded.
   Fifty rows a page.
5. **Efficiency.** Latency and context size, with means only.
6. **Failures.** Failure kinds by approach.
   Each non-zero count filters the Questions table.
7. **Judge.** The five judge scores and the agreement with the answer score.
8. **Reproducibility.** Every field of the run's record with its API name, and a raw JSON link.

A cell with fewer than six groups shows "Too few groups for an interval".
Single facts show "No evidence score by design".
While a run is a subset or a quick check, every chart and table carries its label.

**Starting a run.** The form asks for the kind (Official run or Quick check), the worlds, the repeats (3 or more for official), the scope and optionally a limit of instances per question.
It shows, without letting the reader change them, the question bank and the generation and judge models.
A wrong entry is named beside its field before anything is sent.
After Start, a progress line such as "World 2027 (2 of 3): 12 of 40 questions", a progress bar and Cancel replace the form, and a job already running when the page loads is followed the same way.
Cancelling stops after the current question.
The end-to-end tests use a mocked job and never start a live run.

The screen computes no statistic.
Its state lives in the address: `#/results?run=<id>` with `stratum`, `world` and `failure=<approach>:<kind>`.

Baselines: `results-official`, `results-subset`, `results-quick-check`, `results-table-expanded`, `results-failure-filter`, `results-start-form`, `results-job-running`, `results-empty`, `results-error`, `results-loading`, `presentation-results`.
The whole-bank run in `results-official`, `results-table-expanded` and `results-failure-filter` is generated and labelled "Fixture run (test values)".

### Data Model

Purpose: what the warehouse, the graph and the ontology look like, with live counts and sample rows.

Four tabs, each a link: Warehouse, Graph, Ontology and Scenarios (`#/data-model?tab=...`).

- **Warehouse.** A map of the tables as boxes with live row counts and the links between them, grouped by source system.
  Choosing a table (`?table=`) shows its source system, rows and columns, the tables it links to, and its sample rows, 50 to a page.
  A filter takes one column and one value, read as that column's own type.
  A row opens as a record in the evidence drawer, with "Follow into the graph" when it has a node.
- **Graph.** "Kinds of record": the labels as boxes sized by count, in three views (B's relationships, C's relationships, the full schema).
  Choosing a kind shows its properties, its source table and a sample node.
  A node address (`?node=`) shows its properties and up to 20 neighbours.
  Labels that come from the ontology say "Built from the ontology: no sample row."
- **Ontology.** A tree of concepts, a concept card (`?concept=`) with its definition, its relationships and its local terms by market, and a market filter.
  The count of shared codes is always shown.
- **Scenarios.** A card for each planted scenario with strength, noise level, rows planted and a link to its story in Help.
  A scenario not in the active world says "Not planted in this world".

All data is live from the API, and no truth ledger value is shown.
The ontology tree is an ARIA tree, and label text on the maps keeps at least 12 px.

Baselines: `data-model-warehouse-map`, `data-model-rows-filtered`, `data-model-record-drawer`, `data-model-loading`, `data-model-error`, `data-model-empty`, `data-model-graph-full`, `data-model-graph-label-tagged`, `data-model-graph-focused-node`, `data-model-graph-loading`, `data-model-graph-error`, `data-model-graph-empty`, `data-model-ontology-national-draw`, `data-model-ontology-filtered-by-market`, `data-model-ontology-loading`, `data-model-ontology-error`, `data-model-ontology-empty`, `data-model-scenarios`, `presentation-data-model`.

### Help

Purpose: how it works in plain language, every benchmark question with its answer key, the glossary and how to run it.

Eight sections, each a link: What we are testing, The approaches, The data, The planted stories, The questions, How scoring works, Glossary and Running it.
`?section=` scrolls to a section, and `?story=` marks one story and filters the questions.
Help is the one screen that shows answer keys and hidden truths, because they are the scoring reference and not an input to any approach.
It is also the one screen that names vendors and commands, and every command in it is a Makefile target, which a test checks.
Scores appear only when the newest run is a whole-bank official run that scored at least one question.
Otherwise a score cell reads "No official run yet".
The screen never averages scores.

Baselines: `help-top`, `help-stories`, `help-glossary`, `help-questions-no-official-run`, `help-questions-fixture-official-filtered-by-story`, `help-loading`, `help-error`, `presentation-help-fixture-official`.

## Visual language

The tokens are in the `@theme` block of `frontend/src/index.css`, and typed copies are in `frontend/src/design/tokens.ts`.
A test fails if the two drift or a contrast rule breaks.
The tone is calm, restrained and data-first: no neon, glow, glass blur, 3D or decorative gradient.
The graph is 2D and led by evidence.

- **Surfaces.** Surface `#ffffff`, page `#f6f7f9`, raised `#eef0f3`, border `#7f8692` (3:1 or stronger on all three surfaces), hairline `#e3e6eb` for decoration only.
  Text is `#12151b`, `#454c58` and `#596170`, each at 4.5:1 or better on every surface.
  Spacing follows an 8 px grid.
- **Type.** Inter Variable, served from the build (D-041), at 12, 14, 16, 20, 28 and 40 px.
  Figures use tabular numerals.
  Presentation mode raises each step.
- **Icons.** One set, `lucide-react` (D-040).
- **Pipelines.** Each has one fixed colour in three tones (D-044).

| Pipeline | Mark and fill | Tint | Strong, for text |
|---|---|---|---|
| A · Text search | `#2a78d6` | `#e5effa` | `#1c5cab` |
| B · Graph | `#a86e00` | `#f5eee0` | `#7a5000` |
| C · Graph + Ontology | `#c4358f` | `#f8e7f2` | `#a02574` |

  Pipeline hues are marks and fills only, and tinted text uses the strong tone.
  There is no red or green pipeline hue, because status colours are reserved.
  B's gold sits near the warning yellow, so status is always an icon and a label.
  The hues were checked with the project's palette validator, and in the colour-vision floor band direct labels are the second cue.
- **Markets.** A separate categorical set, always shown with its code (UK, GR, AT, CZ).
  Market and status colours are never used as text, and a test scans the source for it.
  The market palette's distances were measured once and no test enforces them.
- **Status.** Good `#0ca30c`, warning `#fab219`, serious `#ec835a` and critical `#d03b3b` as fills, each with an icon and a label.
  Status text uses `#006300`, `#8a5a00` and `#b42323`.
- **Charts.** Drawn in plain SVG and React (D-039).
  A chart never computes a statistic.
  A null is drawn as a gap with the words "no value" and never as zero.
  A table and a tooltip sit beside every chart.

## Interaction and motion

- Every important interaction has a normal, loading, empty, error and disabled state where each applies.
- Clicking a citation, an evidence row or a graph node opens the evidence drawer.
  Clicking a timeline position replays the visual state to that point.
- Graph expansion happens only from recorded events.
  Candidates are muted, selected evidence stays prominent, and set-aside nodes fade but stay inspectable.
- Motion explains system state and is never decoration.
  A node fades in over 200 ms, and the whole product collapses to near-instant under `prefers-reduced-motion` or the Settings switch.
  Evidence is never delayed for effect.
- Copy is plain and short.
  A banned-word list and a glossary of plain replacements are enforced by a scan of the source (D-045), and a word budget caps visible text at 1,300 words outside Help and 1,650 in Help prose (D-055).
  Text from the API, such as headline sentences, is shown verbatim and is outside both.

## Accessibility

The target is WCAG AA.

- Every control is a native element in reading order with a visible focus ring (3 px, the focus token).
- Contrast is enforced by `tokens.test.ts`: text at 4.5:1 on the surfaces and tints, borders and graphical marks at 3:1, the focus ring at 3:1 on every surface and tint.
- Status never relies on colour alone.
- Every chart has a table twin, and every graph has a textual equivalent, the ordered evidence path list plus a summary of the whole view.
- The graph canvas is reachable by keyboard: Tab enters it at one node, the arrow keys move along edges, Enter opens the node, plus and minus zoom, 0 fits, and Escape moves focus on.
  Focus returns to the node or button that opened a drawer when it closes.
- The graph tabs follow the tab pattern.
- The timeline slider has a text value ("1.2 s of 26.4 s"), and each track has a text summary.
- Reduced motion is honoured from the operating system and from Settings.

## Presentation mode

Presentation mode is a header button (`aria-pressed`, with an "On" check mark) and the query parameter `?present=1`, before the hash, so a reload keeps it.
It hides the sidebar, raises the type scale by one step and makes the canvas and maps taller.
It never changes the route.
While it is on, Space plays or pauses the replay of the screen being shown, the right arrow steps it, and R resets it.
Those keys belong to whatever has focus when it is a button, link, tab, text field or open dialog.
Only Live Lab registers a replay.
The recorded runs make the demonstration possible with no model running, and a live run uses the real backend.
No result is fabricated in either.

A suggested run of show, from what is built:

1. Overview: the verdict, or "No official run yet", and how the three approaches differ.
2. Live Lab with a recorded run of an H1 question: replay, open a citation, open the evidence path.
3. Live Lab live, when the model status reads Ready: run a saved question and read the scorecard.
4. Data Model: the warehouse, the graph and the ontology tree, to show that the graph augments the data and does not replace it.
5. Results: the published runs, then Help for the questions and the scoring.

Recovery steps are in [operations.md](operations.md).

## Dev pages

Two pages exist only in development and in the end-to-end build, and a test builds for production and fails if either is present.
The gallery (`#/__gallery`, with `?section=<id>`) shows every primitive in every state from committed fixtures, with the label "Sample values, not results", and its baselines are named `gallery-*`.
The graph harness (`#/__graph`) draws one canvas with its parameters in the address, for the end-to-end specs.

## Operation

```bash
make dev-frontend    # Vite dev server on :5173, with no API proxy (see Configuration)
make build           # the production bundle
make e2e             # build, then the Playwright smoke and functional specs
```

The visual baselines run on the owning machine only, with `pnpm e2e:visual` (D-009).
Font rendering differs between macOS and Linux CI, so the baselines are not a CI gate.
Regenerate them with `--update-snapshots` after an approved UI change.
The Playwright mocks (`e2e/mock-api.ts`) are captured from the API on the dev world and refuse any `/api` request they have no answer for (D-057).
The only invented state is the "fixture-official" run.

## Configuration

The frontend has no environment variables.
It calls relative paths (`/api/v1/...`), so it reaches the API on the page's own origin.
Only `vite preview` proxies `/api` to `http://localhost:8000` (`frontend/vite.config.ts`, line 16).
The dev server of `make dev-frontend` has no proxy: a request to `/api/v1/health` on port 5173 was answered with the app's own `index.html`, so a screen that needs the API shows its error state.
To use the real API from a browser, build with `make build` and run `pnpm preview`, or put a proxy in front.
Browser storage holds only per-reader preferences: the collapsed sidebar, reduced motion and the node cap.

## Testing

- Vitest with Testing Library: 86 test files under `frontend/src/`, covering the reducer, replay clock, graph model and layout, charts, each screen, the router, the copy budget and banned words, the design tokens and the pinned dependencies.
- Playwright: ten spec files in `frontend/e2e/`.
  The default config runs the smoke and functional specs.
  The visual config runs `visual.spec.ts` against 126 committed baselines.
- `pnpm api:check` for the generated types.

## Extension points

- A new screen needs an entry in the destination table with its purpose sentence, and a spec in this page.
- A new status or evidence state needs a shape, an icon and a token pair, and a contrast test.
- A new string needs to fit the copy budget, which has no margin left outside Help.
- Changing a layout, a hierarchy or an interaction pattern of an approved screen changes the visual contract and needs the owner's approval.

## Failure modes

| Failure | What the screen does |
|---|---|
| API unreachable | The panel that failed shows "The server did not answer." with Retry. The other panels still draw. |
| No official run | Overview and Help read "No official run yet" and show no numbers. |
| A recorded run belongs to another world | A record opened from it is refused with a plain message in the drawer. A passage the results carry in full still opens. |
| Stream drops | The subscription reopens with `?after=` and fills any gap from replay, so no event is dropped silently. |
| Event of an unknown type | It is read from the replay route and handed on in order. |

## Known gaps and open owner questions

Recorded at CP2 (`HITL_STATUS.md`) and standing as built until the owner revisits them:

- Overview tiles show no per-approach interval (D-048).
- The replay layout comes from the final graph, and the default fit frames the evidence path with an out-of-view note (D-049, D-050).
- The visible-node cap of 24 is a legibility choice from the 14 px floor.
- The Graph tab's full map is dense, and a per-label neighbourhood map is proposed.
- Help has no A, B, C walk-through of the SCN-007 worked example, because no recorded run covers it.
- Which world is the presentation world is not settled, and Help's recovery table omits `make demo-reset` for that reason.
- The copy budget has no margin left outside Help.
- Small gaps: the replay slider can read just below its end at the end of a run, the flow diagram does not grow in presentation mode, the evidence drawer's group list is fixed when opened while a replay plays, idle approach panels are about 30 px shorter than running ones, and the recordings are cast to their type without validating event types.

The archived screen, flow and journey specifications are under [reference/ux/](reference/ux/screen-specifications.md) and [reference/product/](reference/product/user-journeys.md).
