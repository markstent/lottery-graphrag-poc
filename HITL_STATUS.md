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
| HITL-09 Benchmark / Scoring | APPROVED | 2026-10-08 | Standing blanket approval. 30-question bank grounded deterministically into the dev world (20 scored; 8 not planted, 2 not groundable, all reported); deterministic scoring (answer checks, evidence precision/recall, failure taxonomy); fairness by shared lab construction; harness + CLI with reproducibility record; demo profile enabled and timed. See gate notes. |
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

## HITL-09 notes (2026-10-08)

Artefacts: benchmark bank with version constant (`app/evaluation/bank.py`),
deterministic grounding (`app/evaluation/grounding.py`), deterministic
scoring + failure taxonomy (`app/evaluation/scoring.py`), shared A/B/C lab
construction (`app/retrieval/graph/lab.py`, also used by the trace CLI),
benchmark harness + CLI with reproducibility record
(`app/evaluation/runner.py`, `app/evaluation/__main__.py`), report renderer
(`app/evaluation/report.py`). Evaluation docs updated: scoring.md
(implementation mapping, LLM-as-judge explicitly deferred), reproducibility.md
(persisted record), question-bank.md (grounding rules and world status).
Demo dataset profile enabled for generation (HITL-03 scaling approval) with
a separate evaluator ledger required, so demo worlds cannot overwrite the
development truth ledger.

Validation artefact: `docs/evaluation/harness-validation.md` holds verbatim
reports for the full-bank fake-generator run and a real-model subset
(Q01/Q25/Q28/Q30 on a local Qwen via the gateway, temperature 0), plus the
demo-profile performance verification. That verification found and fixed a
generator scaling defect (quadratic cumulative-weight rebuild in
`generate_exposures`; dev world regenerates bit-for-bit after the fix) and a
profile inconsistency (all profiles now expect the canonical 20-game
catalogue). Demo profile (5M tickets, 2M sessions, 3M exposures) generates
from scratch in ~100s. Real-model subset: B/C mean answer 0.66 vs A 0.41,
evidence recall 0.65 vs 0.04.

Fairness controls: all pipelines are built from one lab (same embedder
instance, same vector store, same corpus, same reranker, same generator,
same context budget); B is exactly C minus `MAPS_TO` and concept seeds;
the fraud profile for Q28 adds the same two relationship types to B and C.
Question text is identical across pipelines; expected answers and required
evidence live only in the evaluation package (isolation tests extended in
Phase 5 still guard the boundary).

Scoring is deterministic: answer checks (number with decimal normalisation,
word-boundary token, set recall), evidence precision/recall against grounded
required evidence (nodes plus cited chunk `document_id`s), and a failure
taxonomy derived from retrieval telemetry. LLM-as-judge is deliberately not
used; docs/evaluation/scoring.md records the rule that a later judge must be
versioned and identified per result.

Benchmark status in the development world: 20 of 30 questions scored; 8 map
to scenarios that are not planted (SCN-001/004/005/006/008/011/013) and are
reported, never scored; Q06 and Q15 do not ground because the world contains
no support summaries discussing the selected game's payment incidents and no
shared mechanics across the selected campaign's games.

Residual risks and known limitations:

- Set-valued questions grade recall over the full expected set (up to 27
  incidents), which is demanding against the fixed 8-slot evidence budget;
  budgets are identical across pipelines so the comparison is fair, but
  absolute recall on those questions is bounded low by design.
- The harness validation run uses the deterministic fake generator, so
  answer-correctness scores in that report exercise the scorer, not a model.
  The committed real-model subset (docs/evaluation/harness-validation.md)
  provides answer-quality evidence on four scenario questions; a full
  official 30x3 real-model run is presentation-phase work (HITL-11), not
  needed to approve the methodology.
- With the fake generator the answer checks score near zero by construction;
  evidence recall is the discriminating metric in the committed validation
  report (B/C = 1.0 vs A = 0.0 on graph questions such as Q01/Q04/Q09/Q16/Q26).
- Q28 evidence recall is bounded (~0.29 for B/C): traversal reaches a subset
  of both planted clusters within the evidence budget; the metric still
  separates pipelines cleanly (A = 0.0).
