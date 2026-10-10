# Information Architecture

Phase 6 artefact (HITL-06). Governing spec: docs/06-ux-spec.md; API naming: docs/07-api-event-spec.md. Low-fidelity here; high-fidelity mock-ups are the HITL-07 contract.

## 1. Primary navigation

```text
Live Lab | Experiment Home | Scenario Lab | Evidence Explorer | Benchmark | Results | Semantic Layer
```

- Live Lab is the default landing screen in presentation mode.
- Settings is a global drawer (provider, model defaults, theme, reduced motion), not a primary destination.
- Deviation from the Phase 1 nav stub: Experiment Home moves into primary navigation (docs/06 section 11 defines it as a first-class screen) and Settings becomes a drawer. The stub's single "Settings" entry could not carry experiment configuration.

## 2. Route map

| Route | Screen | Deep link |
|---|---|---|
| `/lab` | Live Lab | `?run={run_id}` reopens a finished run |
| `/experiment` | Experiment Home | `?experiment_id={experiment_id}` |
| `/scenarios` | Scenario Lab | `?scenario_id=SCN-007` |
| `/evidence` | Evidence Explorer | `?run={run_id}&evidence={evidence_id}` |
| `/benchmark` | Benchmark Runner | `?benchmark_run_id={id}` |
| `/results` | Results Dashboard | `?benchmark_run_id={id}` |
| `/semantic` | Semantic Layer | `?concept={concept_id}` |

All state needed to reconstruct a view comes from the API (experiments, runs, benchmark runs), never from in-page memory alone: every screen survives refresh and direct entry.

## 3. Screen inventory

| Screen | Purpose | Primary user | Key API (docs/07) | Acceptance |
|---|---|---|---|---|
| Live Lab | Watch A/B/C retrieval live; ask questions | Presenter, analyst | `POST /queries`, `GET /queries/{run_id}/events` (SSE), `GET /queries/{run_id}/evidence` | UX-LIVE-001..004, UX-GRAPH-001 |
| Experiment Home | Create/choose experiment configuration; dataset, seeds, models, budgets | Analyst | `POST /experiments`, `GET /experiments/{id}`, `POST /datasets/generate`, `GET /models` | UX-PRESENT-001 |
| Scenario Lab | Inspect scenario catalogue; trigger deterministic world generation | Analyst (not blind mode) | `GET /scenarios`, `POST /datasets/generate`, `POST /scenarios/validate` | blind-mode truth rule |
| Evidence Explorer | Inspect every citation: source records, graph paths, provenance | Analyst | `GET /queries/{run_id}/evidence`, `GET /graph/nodes/{id}`, `GET /graph/evidence-paths/{run_id}` | UX-EVIDENCE-001 |
| Benchmark Runner | Run the suite; monitor progress; drill into a question | Analyst | `POST /benchmarks`, `GET /benchmarks/{id}`, `POST /benchmarks/{id}/cancel` | — |
| Results Dashboard | A/B/C outcomes by complexity, market, evidence, efficiency, failure | Presenter, analyst | `GET /benchmarks/{id}/results` | — |
| Semantic Layer | Explain the architecture: sources → mapping → ontology → graph → agent | Presenter | `GET /graph/nodes/{id}` | user-research question 5 |

Settings drawer: provider/model defaults, `GET /models/status`, reduced motion, theme. No truth-ledger surface exists anywhere in the UI (ADR-008).

## 4. Navigation rules

- Back/forward and refresh work on every route (URL is the state owner).
- Live Lab run deep links load replayable events; replay is client-side over stored telemetry.
- Evidence Explorer opens as a route with the originating run in the URL, so citations from Live Lab remain shareable during a session.
- Presentation mode changes density and chrome, never routes: the same seven screens exist, plus a fixed demo-question rail in Live Lab.
- Help (added at HITL-11, 2026-10-10) is an eighth route: in-app operator
  and presenter documentation (sections, troubleshooting, glossary). It is
  documentation chrome, not one of the seven experiment screens, and links
  back into Live Lab, Results and Semantic Layer.
- Blind benchmark mode hides Scenario Lab truth details (docs/06 section 12); the Scenario Lab route shows configuration but not planted specifics.

## 5. Required states per screen

| State | Requirement |
|---|---|
| Loading | Skeletons match final layout; graph panes show seed placeholders, never fake activity |
| Empty | Explicit empty copy (e.g. no benchmark results yet) with the action that creates data |
| Error | Understandable message + retry; backend error detail preserved in logs, not in faces |
| Disabled | Present during running operations (e.g. Run while a run is active); reasons visible on focus |
| Presentation | Larger type, simplified chrome, fixed demo questions, reset control |

Non-colour cues (icons/labels/position) accompany every status; reduced motion collapses all animation to opacity changes (docs/ux/accessibility.md).
