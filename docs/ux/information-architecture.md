# Information Architecture

This file describes the five-destination shell as built in Phase 5.
The governing specification is section 7 of `docs/superpowers/specs/2026-10-18-overhaul-design.md`.
It replaces the seven-screen architecture of HITL-06, which the overhaul retired.

The shell is built.
The content of each destination is still the earlier application's view until Phase 6 rebuilds it.
This file records what the shell does today and what each destination is for.

## 1. Destinations

The left sidebar lists five destinations, in this order.
Each destination is described by one sentence, taken from spec section 7.1.
The sentence is the link's tooltip and its accessible description.

| Destination | Route          | Purpose in one sentence                                                                                   |
| ----------- | -------------- | --------------------------------------------------------------------------------------------------------- |
| Overview    | `#/overview`   | The verdict from the latest official run, how the three approaches differ, and a button to run a question |
| Live Lab    | `#/live-lab`   | Run one question through all three approaches and watch them work                                         |
| Results     | `#/results`    | Every official run, every question, every score, with intervals                                           |
| Data Model  | `#/data-model` | What the warehouse, the graph and the ontology look like, with live counts and sample rows                |
| Help        | `#/help`       | How it works in plain language, every benchmark question with its answer key, glossary, how to run it     |

Overview is the default.
The bare address and any unknown hash open it and are rewritten to `#/overview`, so a refresh or a shared link reopens the same screen.

Setup, Scenario Lab, Benchmark Runner and Evidence Explorer are no longer pages.
Setup is the Settings drawer plus, from Phase 6, the Overview configuration strip.
Scenarios live in Data Model and Help.
Benchmark execution lives in Results.
Evidence is a drawer.

## 2. Old routes

The routes of the earlier application redirect to the destination that took their place.

| Old route                                   | Opens      |
| ------------------------------------------- | ---------- |
| `#/lab`, `#/evidence`                       | Live Lab   |
| `#/experiment`                              | Overview   |
| `#/benchmark`                               | Results    |
| `#/dictionary`, `#/semantic`, `#/scenarios` | Data Model |

Query parameters on a route survive the redirect.

## 3. The shell

### 3.1 Header

The header carries only the product name, the active dataset, the model status, the presentation toggle and Settings.
The product name links to Overview.
The dataset reads in plain words, for example "dev world, 2026", and reads "No active dataset" when none is active.
Seeds, versions and model identifiers live in Settings and, from Phase 6, in the Results reproducibility panel.

The model status is one button with a coloured dot and a word: Checking, Ready, Starting or Not ready.
It opens a list of the five readiness checks, each with its own state and detail.
The status polls every 15 seconds while something is not ready and every 60 seconds once all is ready, and pauses while the tab is hidden.
A server that does not answer reads as Not ready, with the sentence "The server did not answer."

### 3.2 Sidebar

The sidebar holds the five destinations and a collapse button.
Collapsed, it shows icons only, and each destination's name and purpose stay available as its tooltip and accessible name.
The collapsed state is kept in the browser.
The active destination carries a heavy left bar and bold text, so it does not rely on colour.

### 3.3 Drawers

Two drawers open from the right edge.
Both trap focus while open, close with Escape or the Close button, and return focus to what opened them.

| Drawer   | Opens from                               | Holds                                                                                                                                                                  |
| -------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Settings | The Settings button in the header        | Reduce motion, the visible-node cap for the graph, the world and scenario numbers, generator and ontology versions, and the model names with whether each is reachable |
| Evidence | Any citation, evidence row or graph node | The record itself (table row or graph node properties), then where it came from                                                                                        |

The evidence drawer shows loading, error with a retry, and "This node has no source record" as states of its own.

### 3.4 Presentation mode

Presentation mode hides the sidebar and raises the type scale by one step.
The header button shows it is on with a filled background and the word On beside a tick, as well as `aria-pressed`.
It never changes the route.
It lives in the address as `?present=1`, before the hash, so a reload keeps it.
While it is on, Space plays or pauses the replay of the screen being shown, the right arrow steps it, and R resets it.
Those keys are left alone when focus is in a field, a drawer or a pressable control.

## 4. Graph canvas pages

The graph canvas is drawn from recorded events only.
It has a replay mode, where the whole run is known, and a live mode, where the graph grows with the stream.
The fit keeps type at 14 px or more on screen, so evidence can fall outside the frame.
When it does, the strip above the drawing says how many evidence nodes are out of view and offers "Bring into view", which frames each one in turn and moves focus to it.
The canvas carries `data-layout-ready` once its layout is placed and the fit applied, which the end-to-end specs wait on.
Every canvas is described to a screen reader by a summary of the whole view and an ordered evidence path list.
The canvas is reachable by keyboard: Tab enters it at one node, the arrow keys move along edges, Enter opens the node in the evidence drawer, plus and minus zoom, 0 fits, and Escape moves focus on.

## 5. Required states

Every panel and chart defines normal, loading, empty, error and disabled states.

| State    | Requirement                                                                                                |
| -------- | ---------------------------------------------------------------------------------------------------------- |
| Loading  | A skeleton of the content to come, or the previous render dimmed. No motion under reduced motion           |
| Empty    | A plain sentence saying why there is nothing, and the action that creates something                        |
| Error    | An understandable sentence, with Retry when the failure can be retried. Technical detail stays in the logs |
| Disabled | The panel says why it is not available                                                                     |

Every status has a cue besides colour: an icon, a word or a position.
Reduced motion is honoured from the operating system setting and from the Settings drawer.

## 6. Development pages

Two pages exist only in development and in the end-to-end build, never in a production build.
A test builds for production and fails if either is present.

| Page               | Route         | Use                                                                                                                                                          |
| ------------------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Foundation gallery | `#/__gallery` | Every primitive in every state from the committed fixtures. `?section=<id>` shows one section: tokens, evidence-states, charts, panel, graph, paths, drawers |
| Graph harness      | `#/__graph`   | One graph canvas with its parameters in the address, used by the end-to-end specs. The gallery draws the same page once per graph state                      |

The visual baselines in `frontend/e2e/visual.spec.ts` come from these pages and from the shell.
The shell is baselined on each destination with the view's own content hidden, because Phase 6 rebuilds those views.
