# Screen Specifications

> Note.
> The v2 screens follow section 7 of `docs/superpowers/specs/2026-10-18-overhaul-design.md` until Phase 6 rewrites this file.
> Where this file and that section disagree, the section wins.
> The shell and navigation as built are in `docs/ux/information-architecture.md`.

Phase 6 artefact (HITL-06): low-fidelity wireframes, layout hierarchy and required states per screen. High-fidelity mock-ups and visual language application are the HITL-07 contract. Region letters are referenced by the IA and user flows.

## 1. Live Lab

### 1.1 Idle (default landing)

Live Lab is the home screen: the bare URL `/` resolves to `#/lab`, and the
app name in the header links back to it.

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ A experiment name · dataset/profile · market scope · model · run id   [.presentation] │
├────────────────────────────────────────────────────────────────────────────┤
│ [B] Question composer                                    scope ◧ conf ◧    │
│     "Why did digital conversion fall in Greece, and have we seen           │
│      the same issue elsewhere?"                          [Run] [Clear]     │
│     market scope: (All markets) (UK) (GR) (AT) (CZ)  ← Live backend only   │
│     demo questions: (q1) (q2) (q3)            ← presentation mode only     │
├────────────────────────────────────────────────────────────────────────────┤
│ [C1] CURRENT APPROACH                │ [C2] + GRAPH & ONTOLOGY             │
│      empty: "Run a question to see   │      empty: seed placeholders       │
│      semantic retrieval"             │      "Entities appear as resolved"  │
├────────────────────────────────────────────────────────────────────────────┤
│ [D] Execution timeline (empty)          [E] Score strip (hidden)           │
└────────────────────────────────────────────────────────────────────────────┘
```

The market-scope row (2026-10-18) is a multi-select: All markets is
exclusive and default; selecting one or more markets sends `market_scope`
with the query (docs/07 section 4) and the composer's scope line names the
selected markets. In Demo story mode the row is disabled with the hint
"switch to Live backend to scope a run"; scope is never faked against the
recorded story. Story-mode honesty (2026-10-18): the recorded story only
contains the Greece episode, so dq-2/dq-3 chips and any other question text
disable Run and the chips carry the hint "switch to Live backend to run
this"; the story is never replayed for a question it does not contain.

### 1.2 Active

- C1: pipeline stage indicators (query → embedding → candidates → similarity → rerank → context), chunk cards with similarity bars, selected/discarded states, context-token count.
- C2: seeded graph grows per event; node states seed/active/candidate/traversed/selected/discarded/ontology/source_record; evidence path label under the graph.
- D: timeline appends one row per event; current event highlighted; click rewinds (UX-LIVE-004).

### 1.3 Completed

- Answers above D: answer text, citations (click opens an inline slide-over Evidence Inspector drawer in Live Lab with an "Open full page ↗" permalink to `#/evidence`), latency, context tokens per side; no score prejudice before evaluation completes.
- E appears after `evaluation_completed`: correctness, evidence recall, grounding, latency, tokens; expanded: relationship discovery, cross-market discovery, ontology contribution (docs/06 section 10).
- Backend runs whose question has no published benchmark match show a
  standing explanation instead of E (2026-10-18): "No evaluation scores for
  this run", naming the honesty rule and the scored chips (dq-1..dq-3).
  Latency and tokens remain visible: they are always measured.
- Replay control beside D restarts the stored event stream.

### 1.4 Error

Failing pane: message, retry, "open Evidence Explorer for completed side". Composer stays enabled for a new question.

## 2. Experiment Home

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ [A] Saved experiments list            │ [B] Configuration                  │
│     exp-demo-2026-10  (approved)      │     dataset profile ◧ world seed   │
│     exp-baseline-only                 │     scenario seed ◧ markets ◧      │
│                                       │     scenarios ◧ (catalogue ids)    │
│                                       │     model ◧ provider ◧ embedding   │
│                                       │     top-k ◧ graph depth ◧ budget   │
│                                       │     [Save as…] [Generate dataset]  │
│                                       │     [Run benchmark]                │
└────────────────────────────────────────────────────────────────────────────┘
```

States: generating (progress, deterministic-seed echo), dataset ready (row counts, manifest link), error (validation message from the API). Approval-relevant configuration is labelled with the experiment id that will stamp every run.

## 3. Scenario Lab

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ [A] Scenario cards (catalogue)         [B] Detail                          │
│  ┌──────────────────────┐              │  SCN-007 cross-market incident     │
│  │ SCN-002 ○ enabled    │              │  explanation, markets, strength ◧  │
│  │ SCN-003 ○ enabled    │              │  noise ◧, targets, seeds           │
│  │ SCN-007 ● enabled    │              │  [Validate] [Generate world]       │
│  └──────────────────────┘              │  blind mode banner when active     │
└────────────────────────────────────────────────────────────────────────────┘
```

Blind mode: planted specifics hidden; configuration metadata only (docs/06 section 12, ADR-008).

## 4. Evidence Explorer

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ [A] run context: run id · question excerpt · [back to Live Lab]            │
├────────────────────────────────────────────────────────────────────────────┤
│ tabs: [Sources] [Graph] [Provenance]        ← persistent across tab switch │
│ [B] Sources: record/document/metric cards with source-type badges          │
│ [C] Graph: evidence path, node states, ontology bindings                   │
│ [D] Provenance: source_system, source_record_id, validity, method,         │
│     confidence, ingestion_version (read-only)                              │
└────────────────────────────────────────────────────────────────────────────┘
```

## 5. Benchmark Runner

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ [A] run header: benchmark id · configuration · [Cancel]                    │
│ [B] progress: question 7/30 · category · status (pending/running/ok/error) │
│ [C] rolling metrics: accuracy · evidence recall · latency (compact)        │
│ [D] question rows: [watch] opens /lab?run=…      error rows flagged        │
└────────────────────────────────────────────────────────────────────────────┘
```

## 6. Results Dashboard

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ [A] selector: benchmark run · configuration pair                            │
│ [B] Overview A/B/C          [C] By complexity (L1…L6)                       │
│ [D] Evidence (precision/recall/grounding)   [E] Efficiency (latency/tokens) │
│ [F] Market breakdown (UK/GR/AT/CZ)          [G] Failure analysis (drill-in) │
└────────────────────────────────────────────────────────────────────────────┘
```

Every chart has a table alternative (accessibility); failure rows deep-link to run replays. Includes a collapsible "Benchmark execution & question status log" disclosure at the bottom so operators can inspect per-question execution statuses directly from Results without switching screens (while keeping `#/benchmark` available via "Open standalone runner ↗").

## 6a. Help (HITL-11 addition; SaaS redesign 2026-10-18)

Four-tab guide (`#/help`): 1 Overview & Quick Tour, 2 Concrete Data
Example, 3 Scores & Honesty Rule, 4 Backend & Glossary. Tab 2 carries a
layout-driven diagram of one planted graph neighbourhood (scenario SCN-007):
incident-to-market, incident-to-platform-version-to-platform, the ontology
MAPS_TO triangle between the AT/CZ siblings and CONCEPT_PLATFORM_INCIDENT,
and document REFERENCES/HAS_CHUNK edges. Rows are wrapping chip-and-arrow
sequences (no positioned SVG), each readable as a path; a caption points to
the Live Lab graph pane for the live traversal.

In-app documentation screen (`#/help`), structured as a compact five-section
guide: a page hero with three audience links (presenting / evaluating /
exploring schema), a numbered sticky reading path, and layout-driven HTML
primitives (cards, step rails, chip groups, collapsible disclosures).
Sections: "How it works" (shared embed-search-rerank rail, three pipeline
cards A/B/C, guardrail callout), "Quick tour & demo questions" (three-step
tour plus DEMO-01..04 table), "Scores, metrics & provenance" (metric table,
honesty rule + committed headline callouts, five-step provenance rail),
"Running the backend & troubleshooting" (core commands visible, local LLM
and recovery tables inside collapsible `<details>` disclosures) and
"Glossary and accessibility". Visual baseline:
`e2e/visual.spec.ts-snapshots/help-darwin.png`.

Live data note (HITL-11): when the dashboard renders the latest published
run from the API, the header states the run id and source; sections with no
bank dimension (market breakdown) are hidden rather than filled with
synthetic values, and unscored questions appear in failure analysis marked
"not scored".

## 6b. Data Dictionary (HITL-11 addition; SaaS polish 2026-10-18)

In-app schema documentation (`#/dictionary`), orientation before reference:
a page hero with a "how to read this page" callout, three store cards
(structured layer / graph overlay / vector index), and "How the data
connects" as a 2×2 card grid of entity chains (players play, platforms fail,
knowledge flows, money & identity) with demo row counts. Exhaustive
reference catalogues use progressive disclosure (`<details>` drawers):
"Warehouse tables & fields" groups the 36 tables into five domain drawers
(Reference data open by default) plus a field-level drawer for the ten core
tables; "The graph overlay" renders six cluster cards with label chips, the
derived-relationship table, and an open-by-default drawer of all 26
relationship types; "The ontology" shows the INC_S007_GR/AT/CZ →
CONCEPT_PLATFORM_INCIDENT binding card, the ten-concept catalogue, a
mapping-sources drawer and the reserved-vocabulary scope callout. Baseline:
`dictionary-darwin.png`.

Plain-language layer (2026-10-18, user feedback: "what is an incident?"):
the Sample Data tab opens with a "What this database describes" section
above the sample rows: a lead paragraph (one synthetic operator, world seed
2026, calendar year 2025, four markets, nothing real) and a six-card grid
of what the database covers (what we sell, who plays, where and how,
commercial activity, what goes wrong, what we know), followed by a "What is
an incident?" callout that defines an incident in business terms with a
concrete example (INC_S007_GR, checkout failing after PLV_PAYMENTS_3) and
its links to games, market and incident-report documents. Each sample table
shows a "What a row in … means" definition card above the analytical
takeaway, and the tab ends with a "What every core table means in plain
English" disclosure: 16 table groups, business meaning not schema.

## 6c. Experiment Home "Start here" strip (HITL-11 addition, 2026-10-10)

Additive change to the approved Experiment Home: a "Start here" section at
the top presents the three-step reading order (1 Watch it answer → Live Lab,
2 Check the proof → Evidence Explorer, 3 Read the scoreline → Results) as
linked step cards. The approved saved-experiments and configuration sections
below are unchanged; deep links, hierarchy and colour semantics of the
existing content are preserved. Baseline: `experiment-home-darwin.png`
(re-recorded with the new primary-nav grouping, see
docs/ux/information-architecture.md).

## 7. Semantic Layer

```text
┌────────────────────────────────────────────────────────────────────────────┐
│        structured · documents · telemetry · support        [A] sources     │
│                    \            |            |           /                 │
│                         [B] entity mapping → highlights on select          │
│                               [C] ontology (concepts)                      │
│                                  [D] knowledge graph                       │
│                                  [E] AI agent                              │
│ caption: "The graph is an additional semantic layer above existing data."  │
└────────────────────────────────────────────────────────────────────────────┘
```

Selecting a source highlights mapped entities; selecting a concept highlights local entities; selecting a relationship shows provenance (docs/06 section 14).

## 8. Presentation Mode

Same Live Lab layout at 1920×1080: larger type scale, demo-question rail under the composer, chrome reduced to Reset + Exit, controlled graph zoom. No fabricated content; Reset restores the approved demo world (UX-PRESENT-001).
