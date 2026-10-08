# Human-in-the-Loop Status

| Gate | Status | Approval date | Notes |
|---|---|---|---|
| HITL-01 Product Scope | APPROVED | 2026-10-07 | Approved by project owner in session. |
| HITL-02 Architecture | APPROVED | 2026-10-07 | Approved by project owner in session. ADR-006..009 accepted. |
| HITL-03 Synthetic Data Model | APPROVED | 2026-10-07 | Approved by project owner in session. Dev dataset + generator accepted. |
| HITL-04 Ontology and Graph Model | APPROVED | 2026-10-07 | Approved by project owner ("APPROVE EVERYTHING"). |
| HITL-05 Scenario / Truth Ledger | APPROVED | 2026-10-07 | Standing blanket approval; scenario engine, 4 planted scenarios, ledger + isolation tests verified. |
| HITL-06 UX Information Architecture | APPROVED | 2026-10-07 | Standing blanket approval; IA, user flows, journeys, wireframes committed. |
| HITL-07 High-Fidelity UX Prototype | APPROVED | 2026-10-07 | Standing blanket approval; all seven IA screens implemented with mocked docs/07 event telemetry, replay/rewind, presentation mode; visual baselines committed (frontend/e2e/visual.spec.ts-snapshots/); vitest 13, smoke e2e, tsc, oxlint, prettier, build green. |
| HITL-08 Retrieval Behaviour | APPROVED | 2026-10-08 | Standing blanket approval. Conventional RAG + GraphRAG B/C implemented with evidence tracking, traversal telemetry, context assembly; real side-by-side A/B/C traces for SCN-007/015/003 in docs/retrieval/example-traces.md; specs docs/retrieval/graph-rag.md + evidence-ranking.md; 17 offline + 4 live GraphRAG tests, truth-ledger isolation verified; known limitations recorded (see gate notes). |
| HITL-09 Benchmark / Scoring | PENDING | | |
| HITL-10 Testing / Quality | PENDING | | |
| HITL-11 Presentation Readiness | PENDING | | |

Only the project owner may mark a gate `APPROVED`.

On 2026-10-07 the project owner issued a blanket approval ("APPROVE EVERYTHING"),
authorising continuous progression through the remaining gates without
individual pauses. Each gate is still marked `APPROVED` only once its phase
artefacts exist and all checks pass, under this standing approval.

## HITL-08 notes (2026-10-08)

Artefacts: pipelines A/B/C (`app/retrieval/standard`, `app/retrieval/graph`),
evidence tracking with per-candidate components and discard reasons,
traversal telemetry on the docs/07 section 8 event names, shared context
assembly, side-by-side trace CLI (`app/retrieval/graph/traces.py`), three
captured traces with real retrieval telemetry and local-model generation
(`docs/retrieval/example-traces.md`).

Key implementation decisions (documented in the retrieval specs): traversal
covers the structured-record subgraph; documents stay in the shared vector
channel for all pipelines; budget cuts are relationship-strength ordered, not
alphabetical; evidence scores use bottleneck path strength; B equals C minus
the ontology relationships and concept seeds.

Residual risks and known limitations:

- With generous traversal budgets the version-edge path often ranks ontology
  expansion redundant for SCN-007; the ontology's demonstrated value is
  robustness (seeding + concept expansion when structural edges are absent or
  cut) rather than large score deltas. The benchmark (HITL-09) must quantify
  this honestly rather than assume a large C advantage.
- `DOC_S007_UK` has no structural path within the allow-list; its content is
  covered through the shared vector channel, and document-level recall is
  scored via chunk `document_id` in Phase 10.
- Node evidence (12 slots) trades precision for story recall on incident
  questions; UK incidents intentionally rank into the selected set for the
  "why was the UK unaffected" contrast.
