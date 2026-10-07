# User Flows

Phase 6 artefact (HITL-06). Behavioural flows behind the journeys in docs/product/user-journeys.md. Event names come from docs/07-api-event-spec.md sections 7-11.

## 1. Live comparison flow (Live Lab)

```text
Composer ──Run──> POST /queries ──> run_id + SSE /queries/{run_id}/events
                                       │
        ┌──────────────────────────────┤ event stream
        │                              │
  Current Approach pane          + Graph & Ontology pane
  query_received                 query_received
  embedding_started/done         seed_resolution (entity, concept)
  candidates_retrieved (k)       traversal_started
  similarity_scored              relationship_traversed (per hop)
  reranked                       candidate_discovered / candidate_rejected
  context_selected               evidence_selected
  context_assembled              context_assembled
        │                              │
        └──────────┬───────────────────┘
           answer_streamed (both) ──> evaluation_completed
                                           │
                                     Score strip appears
```

Rules:

- Pane visuals are driven only by received events; nothing animates without a corresponding telemetry event (UX-LIVE-002).
- The execution timeline records event arrival order with timestamps; selecting an event rewinds both panes to that state (UX-LIVE-004).
- A new Run is disabled until the active run completes or errors.
- On `error` events: the failing pane shows the error state, the other pane continues; the score strip marks the failed side as failed, never as zero-scored.

## 2. Evidence-inspection flow

```text
Citation click (answer or timeline)
  → /evidence?run={run_id}&evidence={evidence_id}
      ├─ Sources tab      structured record / document / metric card
      ├─ Graph tab        evidence path with node/edge states (docs/06 section 5)
      └─ Provenance tab   source_system, source_record_id, validity dates,
                          derivation method, confidence, ingestion_version
  → node click → graph node detail (GET /graph/nodes/{id})
  → back returns to the originating run context (URL round-trips)
```

Rules:

- Every citation is inspectable (UX-EVIDENCE-001); disabled citations do not exist.
- Provenance fields are read-only facts from retrieval telemetry; no evaluator truth appears (ADR-008).
- Evidence paths render at most the path plus direct candidates, never the full graph (UX-GRAPH-001).

## 3. Presentation flow

```text
Enter (toggle in Live Lab header)
  → 1920×1080 density, demo-question rail, simplified chrome
  → saved demo questions, one-click Reset (POST /experiments/{id}/reset)
  → run question → live comparison flow as above
  → replay / evidence inspection as above
Exit → normal density; URL unchanged
```

Rules:

- Presentation mode always executes against the real backend (docs/06 section 17).
- Reset restores the approved demo world (same seeds, same scenarios) without manual cleanup (UX-PRESENT-001).
- Scenario truth is never displayed, including in Scenario Lab, unless blind mode is explicitly off.

## 4. Benchmark run flow

```text
Experiment Home ──"Run benchmark"──> POST /benchmarks ──> /benchmark?benchmark_run_id
  progress: question n/N, category, rolling metrics
  per question: "watch this question" → /lab?run={run_id} (opens the finished run replay)
  cancel → POST /benchmarks/{id}/cancel (confirm; partial results marked partial)
  completion → /results?benchmark_run_id
```

Rules:

- Benchmark screens stay calm: no traversal animation while automated (docs/06 section 15).
- Errors per question are recorded and surfaced in failure analysis, never silently skipped.
