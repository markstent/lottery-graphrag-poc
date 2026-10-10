# Screen Specifications

Phase 6 artefact (HITL-06): low-fidelity wireframes, layout hierarchy and required states per screen. High-fidelity mock-ups and visual language application are the HITL-07 contract. Region letters are referenced by the IA and user flows.

## 1. Live Lab

### 1.1 Idle (default landing)

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ A experiment name · dataset/profile · market scope · model · run id   [.presentation] │
├────────────────────────────────────────────────────────────────────────────┤
│ [B] Question composer                                    scope ◧ conf ◧    │
│     "Why did digital conversion fall in Greece, and have we seen           │
│      the same issue elsewhere?"                          [Run] [Clear]     │
│     demo questions: (q1) (q2) (q3)            ← presentation mode only     │
├────────────────────────────────────────────────────────────────────────────┤
│ [C1] CURRENT APPROACH                │ [C2] + GRAPH & ONTOLOGY             │
│      empty: "Run a question to see   │      empty: seed placeholders       │
│      semantic retrieval"             │      "Entities appear as resolved"  │
├────────────────────────────────────────────────────────────────────────────┤
│ [D] Execution timeline (empty)          [E] Score strip (hidden)           │
└────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Active

- C1: pipeline stage indicators (query → embedding → candidates → similarity → rerank → context), chunk cards with similarity bars, selected/discarded states, context-token count.
- C2: seeded graph grows per event; node states seed/active/candidate/traversed/selected/discarded/ontology/source_record; evidence path label under the graph.
- D: timeline appends one row per event; current event highlighted; click rewinds (UX-LIVE-004).

### 1.3 Completed

- Answers above D: answer text, citations (click → Evidence Explorer), latency, context tokens per side; no score prejudice before evaluation completes.
- E appears after `evaluation_completed`: correctness, evidence recall, grounding, latency, tokens; expanded: relationship discovery, cross-market discovery, ontology contribution (docs/06 section 10).
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

Every chart has a table alternative (accessibility); failure rows deep-link to run replays.

## 6a. Help (HITL-11 addition, 2026-10-10)

In-app documentation screen (`#/help`): a sticky section index and eleven
sections covering the experiment design, quick start, screen-by-screen
guide, run stages and event vocabulary, saved demo questions, metric
sources and honesty rules, data and provenance, operator commands,
troubleshooting, glossary and accessibility. Content quotes only committed
figures (validation results, demo-world scale) and mirrors
docs/demo/presentation.md; it renders no synthetic values. Visual baseline:
`e2e/visual.spec.ts-snapshots/help-darwin.png`.

Live data note (HITL-11): when the dashboard renders the latest published
run from the API, the header states the run id and source; sections with no
bank dimension (market breakdown) are hidden rather than filled with
synthetic values, and unscored questions appear in failure analysis marked
"not scored".

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
