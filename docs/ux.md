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
| Evidence score | The evidence F1 of method v0.2, from 0 to 1 with two decimals (D-047) |
| Evidence recall | The share of the needed facts the chosen evidence covers, from 0 to 1 with two decimals; the evidence metric of method v0.3 (D-087) |
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
  Below 768 px wide it stays collapsed and the toggle is hidden, so the page keeps its width.
- The screens are designed for a 16:9 desktop, and a phone 390 px wide still reads them without sideways page scroll.
  Below 768 px Live Lab stacks the canvas, the three approach panels (each capped in height and scrolling inside itself) and the answers in one column; Results stacks its paired panels.
  Charts keep a readable width and scroll sideways in their own box, as wide tables do (the scorecard, market coverage, the question table, the Help tables).
  A table box that scrolls takes keyboard focus, with its name and the shared focus ring, so the arrow keys scroll it; when the table fits it is not a tab stop (`frontend/src/components/scroll-box.tsx`).
  A chart box scrolls only below 768 px, so on a desktop no tooltip is clipped; its marks take focus and bring themselves into view.
  The reproducibility record puts each value under its name.
  At 768 px and wider the layout is the desktop one, unchanged.
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

1. "Latest official run": the run's method badge first, "Method v0.3" or "Method v0.2 (old method)", read from the API's `method_version`.
   A v0.3 run's `method_note`, its declaration of the method change, stands beside the badge as plain text; a v0.2 run has none.
   Then one tile for each approach in its own tint, each showing the mean of the method's evidence metric over the questions with claims, with the number of those questions and the runs behind it.
   The tile reads "Evidence score, questions with claims" for a v0.2 run (its F1) and "Evidence recall, questions with claims" for a v0.3 run (owner, 2026-10-27).
   The number of questions comes from the summary, never from the screen.
   The run's headline sentences follow, verbatim and unedited.
2. "How the three approaches differ": a flow diagram of method v0.3, the code as it runs.
   The question fans out to one shared lane, "Search passages" then "Re-order passages": only passages are re-ranked.
   B adds "Find starting points", "Follow relationships" and "Rank by the graph".
   C adds "Find starting points", "Add ontology terms", "Follow relationships", "Add linked records" and "Rank by the graph".
   All lanes join at "Fill one budget", then "Answer with sources", and a caption says "B and C take turns: a passage, then a graph record."
   The diagram always describes the current method; a v0.2 run above it carries its own old-method badge.
   The lane order comes from one module (`run/lanes.ts`), and a test pins it to the order of events in the recordings and the run fixture.
3. "Run a question" and "Configuration" side by side.
   The first has a button to Live Lab and the four demo questions as links.
   The second lists the active dataset and the four model roles with their configured names.

Data: `GET /benchmarks/latest`, `/demo/questions`, `/datasets` and `/models`.
Nothing is computed on this screen.
The tiles fill only for a whole-bank run of kind "official".
With none, the screen says "No official run yet" and links to Results, and a newer smoke or subset run is named in words with no numbers.
The tiles carry no interval of their own, because the statistics define intervals for differences (D-048).
Intervals reach the screen through the headline sentences, and one line says so.

Baselines: `overview-fixture-official`, `overview-fixture-v03`, `overview-no-official-run`, `overview-smoke-only`, `overview-error`, `overview-loading`, `presentation-overview-fixture-official`.

### Live Lab

Purpose: run one question through all three approaches and watch them work.

The layout puts the graph canvas on the left, about three fifths of the width and at least 640 px, and the three approach panels as a rail on the right (D-046).
At 1920 by 1080, the first screen of a running run holds the question bar, the graph, the panels and the timeline.

1. **Question bar.**
   Before a run it is open: the four saved questions, a box for your own question, the market scope and the source (Recorded run or Live).
   Once a run is chosen it collapses to one line with "Change question", "Cancel run" while a live run is going, and Run.
2. **Scorecard**, when a run has completed: a row for each approach with Answer, Evidence recall, Starting record, Markets reached, Answer writing time, Context size and Reason.
   A recording made under the old method shows its Evidence score (F1) in place of Evidence recall, because that is what it was scored on.
   B and C show signed changes against A.
   The reason is the failure class in plain words: "the starting record was not found", "the needed evidence was not retrieved", or "the evidence was retrieved but the answer was wrong" (D-054).
   A question with no answer key shows only what can be measured.
3. **Graph canvas** with a tab for B and a tab for C, a toggle that overlays the other approach's evidence path, and "Focus on the path".
   **Three panels** show each approach's status, its steps in order with a word, an icon and a time, and its evidence found, used and set aside.
   The re-rank step says what method v0.3 does: "Re-order and pick passages" in A, and "Re-order passages, take turns" in B and C, where the graph has already ranked its own records and the two lists take turns filling one budget.
   A recording of the old method keeps the old name, "Re-order and pick".
   B and C also show the question's target types ("Question's target: incident, market, platform version", or "none named") and the context against its budget ("Context: 1,996 of 2,000 tokens"); both are silent for an old recording, which recorded neither.
   Each graph record carries its place in the graph's order: "starting point", "question's target" or "other", and "graph rank n".
   A record set aside says why in plain words: "the same record is already in the context", "the context was full", "a duplicate", "outside the markets asked about" or "a kind of record this question does not use".
   A reason only the old method gave (`slot_limit`, `superseded_by_structured_fact`) reads "Set aside under the old method".
4. **Timeline**, docked under both: rewind, play or pause, replay, a position slider, the time, speeds 0.5x to 4x, and one track for each approach.
5. After the run: the three answers as the model wrote them, with each citation marker a button, the evidence path rows for B and C, and the market coverage table.

Sources: a **recorded run** replays one of four real captures through the API on the dev world, with qwen3.6 through Ollama and reasoning off (`frontend/src/run/fixtures/recorded/`, D-056).
They need no model, and they are not edited.
All four were made under the old method (v0.2), and the question bar says "recorded under the old method (v0.2)" beside the source; a recording names its method, and one that names none was made before the field existed, so it is of the old method.
The tests' own live runs (`frontend/src/run/fixtures/run-*.json`) are runs of typed questions through the API on the tiny world with the fake model, written by `backend/tests/test_run_fixtures.py`, so every selection and budget in them is what the code did.
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

A whole-bank run, a subset or a development run shows all panels, and a quick check shows only the Verdict and Reproducibility.

1. **Benchmark runs.** A select of every published run, newest first, with its standing in words (Result, Subset run, Quick check, or the kind followed by ", not a result", such as "Development run, not a result"), and a "Start a run" button.
2. **Verdict.** The method badge, "Method v0.3" or "Method v0.2 (old method)", with a v0.3 run's `method_note` beside it as plain text (none for v0.2).
   Three tiles, each with the method's evidence metric ("Evidence score" for v0.2, its F1; "Evidence recall" for v0.3) and the answer score, then the run's headline sentences as the harness wrote them.
   A subset run says what it covered, a development run says it is not a result, and a quick check says its numbers are not results.
3. **Scores by kind of question.** A switch between the method's evidence metric and Answer score, grouped bars per kind of question, an interval plot of the paired differences, and an interval plot of the ontology-dependent split marked "Descriptive: not part of the tested family."
   A v0.3 run also reports C against A, which is never tested: its rows read "<kind>: C against A" with the note "Not tested".
   Every chart has a "Show as table" twin.
4. **Questions.** One row per question and world, with filters, the answer, the method's evidence metric (headed "Evidence recall" or "Evidence score") and judge score of each approach, and an expanding table of every measure.
   "Open" goes to the question in Live Lab when its world is loaded.
   Fifty rows a page.
5. **Efficiency.** Latency and context size, with means only.
6. **Failures.** Failure kinds by approach.
   Each non-zero count filters the Questions table.
7. **Judge.** The five judge scores and the agreement with the answer score.
   A v0.3 run splits each group into answers that answered and answers that abstained ("All questions, answered", "All questions, abstained" and so on), with "Pairs judged", "Agreement" and "Weighted kappa", and one line explains the levels.
   A v0.2 run keeps its one row per group with "Kappa".
   Every row shows its number of judged answers and the exact agreement; a kappa is shown only from 10 judged answers, and below that, or with none judged, the cell reads "Too few to say" (owner, 2026-10-27).
   **Groundedness**, for a v0.3 run only: "Descriptive, not tested.", with each kind and approach's share of its answers' ids, dates and numbers "Held by cited blocks" and "In no shown block", and the questions behind them.
8. **Reproducibility.** Every field of the run's record with its API name, and a raw JSON link.

A tested comparison with fewer pairs than the minimum shows "Too few pairs", with no interval and no delta.
An untested cell with fewer than six groups shows "Too few groups for an interval".
A run written before that rule can carry such an interval in its recorded headlines, which are never rewritten.
For that run the Verdict adds one note under the headlines saying the charts omit it.
Single facts show "No evidence score by design".
While a run is not a result (a subset, a quick check or a development run), every chart and table carries its label.
The screen opens the newest result, else the newest subset run, and a development run only when there is nothing else.

**Starting a run.** The form asks for the kind, "Development run" (the default) or "Quick check", the worlds, the repeats (at least 1), the scope and optionally a limit of instances per question.
A development run uses world 2026 only, so 2027 and 2028 are disabled with "World 2026 only" beside them; a quick check may use any seen world.
There is no "Official run" choice, and a line says why: "Neither is a result. Official runs use the unseen worlds 2029 to 2034, from the command line." (D-091).
The default request is one the API accepts as it stands, and a backend test posts it.
It shows, without letting the reader change them, the question bank and the generation and judge models.
A wrong entry is named beside its field before anything is sent.
After Start, a progress line such as "World 2027 (2 of 3): 12 of 40 questions", a progress bar and Cancel replace the form, and a job already running when the page loads is followed the same way.
Cancelling stops after the current question.
The end-to-end tests use a mocked job and never start a live run.

The screen computes no statistic.
Its state lives in the address: `#/results?run=<id>` with `stratum`, `world` and `failure=<approach>:<kind>`.

Baselines: `results-official`, `results-v03`, `results-v03-agreement-and-groundedness`, `results-subset`, `results-quick-check`, `results-table-expanded`, `results-failure-filter`, `results-start-form`, `results-job-running`, `results-empty`, `results-error`, `results-loading`, `presentation-results`.
The whole-bank run in `results-official`, `results-table-expanded` and `results-failure-filter` is a v0.2 run generated by `backend/scripts/fixture_official.py` and labelled "Fixture run (test values)".
The v0.3 run in `results-v03` is the report tests' synthetic run through `summarize`, written by `backend/tests/test_benchmark_report.py`, with the same label.

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

Purpose: the one place that explains the whole experiment, at two reading levels, with every benchmark question and its answer key, the glossary and how to run it.

A labelled two-option control at the top sets the reading level, Plain or Technical.
Plain is the default and the level used in presentation mode.
Technical shows each chapter's Plain text first and its technical detail after it, so a technical reader still sees the framing.
The level is in the address (`?level=technical`) and is remembered per browser, with a fallback when storage fails.
Presentation mode ignores the remembered level, and an explicit `?level=` always wins.
A link with `?section=`, `?story=` or `?stratum=` opens at Plain, and a bare `#/help` uses the remembered level.
Switching level keeps the chapter in view.

Twelve chapters, each a link in the Help navigation: 1 Why this exists, 2 The made-up company, 3 The planted stories, 4 The three approaches, 5 How evidence is chosen, 6 The answer and the judge, 7 How scoring works, 8 Reading the results, 9 Assumptions and limits, 10 The questions, 11 Glossary, 12 Running it.
`?section=` scrolls to a chapter by its id.
The eight ids of the first Help stay as aliases: `what` to chapter 1, `data` to 2, `stories` to 3, `approaches` to 4, `scoring` to 7, `questions` to 10, `glossary` to 11 and `running` to 12.
`?story=` marks one story and filters the questions.
Chapters 4 and 5 draw a diagram of each approach and of how evidence is chosen, and chapter 9 holds the assumptions and limits register, with its reasons, costs if wrong and sources at Technical.

Settings panel: a chapter's settings table lists each setting with its value now and its value in the newest official run.
Now comes from `GET /api/v1/settings`, which returns the same fields a run records, so the two are the same schema.
A setting that differs between the two carries a "Differs" mark, a run that did not record one reads "Not recorded", and a failed load reads "Not available" with a retry.
A number stated in prose is a `{setting_key}` placeholder filled from the same source.
It falls back to the newest official run's recorded value, and then to "not available".
While either load is under way a placeholder reads "…" and the evidence diagram says its settings are loading, so no value is shown that a later load could change; "not available" appears only after both loads have settled.
A test resolves every placeholder and settings-table key against `frontend/src/test/settings.fixture.json`, and a backend test checks that the fixture names exactly the fields `GET /settings` serves.
No setting is typed into Help by hand.
A past measurement, such as the pilot or the dry run, is typed with its date and source record.

Help is the one screen that shows answer keys and hidden truths, because they are the scoring reference and not an input to any approach.
It is also the one screen that names vendors, models and commands at Technical, and every command in it is a Makefile target, which a test checks.
Scores appear only when the newest run is a whole-bank official run that scored at least one question.
A score cell gives the answer and the evidence metric of that run's method, "Evidence recall" for v0.3 and "Evidence score" (its F1) for v0.2.
When that run scored none of these world 2026 questions, as a v0.3 official run on the unseen worlds does, the screen says so above the table and links to Results.
With no whole-bank official run, a score cell reads "No official run yet".
The screen never averages scores.

Copy: each chapter holds its Plain and its Technical text as separate fields.
The banned-word scan covers the Plain text and the glossary's plain definitions, and not the Technical text.
Technical text uses real terms, each defined where first used in the chapter or linked to the glossary.
The Help word cap is removed (D-082).

Baselines: `help-top`, `help-settings-technical` (the settings table with recorded values and "Differs" marks), `help-stories`, `help-evidence`, `help-evidence-technical`, `help-limits-technical`, `help-glossary`, `help-questions-no-official-run`, `help-questions-fixture-official-filtered-by-story`, `help-loading`, `help-error`, `presentation-help-fixture-official`.

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
  A banned-word list and a glossary of plain replacements are enforced by a scan of the source (D-045), and a word budget caps visible text at 1,360 words outside Help (D-055, D-066; raised from 1,300 by the owner on 2026-10-27 because method v0.3 labels two methods).
  Help has no word cap since D-082, and the scan covers Help's Plain text and not its Technical text, where real terms, vendor and model names and dated historical figures (such as the single cut at 12 places of D-025, typed in chapter 5) are allowed.
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
make dev-frontend    # Vite dev server on :5173, forwarding /api to :8000
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
Both the dev server (`make dev-frontend`) and `vite preview` forward `/api` to `http://localhost:8000` (`frontend/vite.config.ts`), so the API must be on that port.
Browser storage holds only per-reader preferences: the collapsed sidebar, reduced motion, the node cap and the Help reading level.

## Testing

- Vitest with Testing Library: 92 test files under `frontend/src/`, covering the reducer, replay clock, graph model and layout, charts, each screen, the router, the copy budget and banned words, the design tokens and the pinned dependencies.
- Playwright: ten spec files in `frontend/e2e/`.
  The default config runs the smoke and functional specs.
  The visual config runs `visual.spec.ts` against 130 committed baselines.
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

Recorded at CP2 (`docs/reference/hitl-history.md`) and standing as built until the owner revisits them:

- Overview tiles show no per-approach interval (D-048).
- The replay layout comes from the final graph, and the default fit frames the evidence path with an out-of-view note (D-049, D-050).
- The visible-node cap of 24 is a legibility choice from the 14 px floor.
- The Graph tab's full map is dense, and a per-label neighbourhood map is proposed.
- Help has no A, B, C walk-through of the SCN-007 worked example, because no recorded run covers it.
- Which world is the presentation world is not settled, and Help's recovery table omits `make demo-reset` for that reason.
- The copy budget has no margin left outside Help.
- Small gaps: the replay slider can read just below its end at the end of a run, the flow diagram does not grow in presentation mode, the evidence drawer's group list is fixed when opened while a replay plays, idle approach panels are about 30 px shorter than running ones, and the recordings are cast to their type without validating event types.

The archived screen, flow and journey specifications are under [reference/ux/](reference/ux/screen-specifications.md) and [reference/product/](reference/product/user-journeys.md).
