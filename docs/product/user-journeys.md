# User Journeys

Phase 6 artefact (HITL-06). Four journeys, each annotated with screens and flows. Behavioural detail lives in docs/ux/user-flows.md; screen layouts in docs/ux/screen-specifications.md.

## Journey 1 — Presenter: the demonstration story

Actor: project owner presenting to an audience. Environment: presentation mode, approved demo world.

1. Open Live Lab in presentation mode; header shows the approved experiment, dataset, market scope, model and run id.
2. Introduce the architecture on the Semantic Layer screen: existing sources, entity mapping, ontology, graph overlay, agent. Key line: the graph adds a semantic layer; it does not replace the data layer.
3. Return to Live Lab. Pick a saved demo question (e.g. the SCN-007 cross-market incident question).
4. Run. Narrate both panes from the execution timeline: semantic candidates on the left, seed resolution and traversal on the right.
5. When the graph pane discovers the cross-market connection, open the evidence path view to explain why.
6. Read both answers; click one citation to show provenance in Evidence Explorer.
7. Show the score strip after evaluation completes.
8. Replay the retrieval for a second audience if asked.
9. Reset restores the approved world for the next session.

Exit: audience can name what the graph added and confirm the graph did not replace the data layer (docs/06 section 25).

## Journey 2 — Analyst: investigate a question

Actor: analyst exploring ad hoc. Environment: normal mode.

1. Open Experiment Home; select or configure an experiment (profile, seeds, models, budgets).
2. Open Live Lab; ask a question beyond the saved set.
3. Watch both panes; pause at a traversal event of interest on the timeline.
4. Click a citation or a graph node: Evidence Explorer opens for that run.
5. Sources tab: read the structured record or document; Graph tab: see the evidence path; Provenance tab: verify source system, record id, validity, derivation method.
6. Adjust the question and re-run; compare timelines between runs via deep links.

Exit: a defensible answer chain from question to evidence to provenance.

## Journey 3 — Analyst: plant and probe a scenario

Actor: analyst preparing benchmark material.

1. Open Scenario Lab; review the catalogue; select a scenario (e.g. SCN-003).
2. Configure strength/noise/markets; Validate; Generate world (deterministic seeds echoed back).
3. Switch to blind benchmark mode: Scenario Lab now hides planted specifics.
4. Run questions in Live Lab against the planted world.
5. Open Results Dashboard to see whether retrieval found the planted signal.
6. Reveal configuration deliberately afterwards to discuss misses.

Exit: evidence about retrieval behaviour on known hidden truth, without the retrieval system ever seeing the truth ledger (ADR-008).

## Journey 4 — Operator: run the benchmark suite

Actor: operator running the official suite.

1. Experiment Home: choose the approved configuration; Run benchmark.
2. Benchmark Runner: monitor progress, rolling metrics, per-question status; watch a question in Live Lab when a result looks surprising.
3. Cancel if infrastructure fails; partial results are marked partial.
4. On completion, open Results Dashboard: overview, by complexity, by market, evidence metrics, efficiency, failure analysis.
5. Drill into failures; each failure links to the run replay and its evidence.
6. Export/share the results link (URL round-trips the benchmark run id).

Exit: a complete, reproducible benchmark record for the configuration (docs/evaluation/reproducibility.md).
