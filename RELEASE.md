# Release: v0.1.0-rc1

Date: 2026-10-10. Commit: `5b01b71` (main, CI green: run 38028922862).
Gate status: HITL-01..11 APPROVED (see `HITL_STATUS.md`).

## What this is

A presentation-quality experimental POC that measures the incremental value
of a knowledge-graph and enterprise-ontology overlay above a synthetic
enterprise data layer. Conventional RAG (A), graph relationships (B) and
graph + ontology (C) run over one shared lab: same world, corpus, embedding
model, reranker, generator and context budgets. Everything is synthetic;
four scenarios are planted by the scenario engine and scored against an
evaluator-only truth ledger that retrieval can never read (ADR-008).

## Benchmark version record

| Item | Value |
|---|---|
| Question bank version | 1.0.0 (`backend/app/evaluation/bank.py`) |
| Bank size | 30 questions (22 scored on the dev world; 2 not groundable; 8 not planted and never scored) |
| Scoring | Deterministic (answer checks, evidence precision/recall, failure taxonomy); no LLM judge |
| Generator version | 0.1.0 (deterministic, world seed 2026) |
| Validation runs | `docs/evaluation/harness-validation.md` (fake full bank 2026-10-08; real-model subset Q01/Q25/Q28/Q30 2026-10-08) |

Headline validation results: full bank evidence recall A 0.02 vs B/C 0.62
(fake generator, deterministic); real-model subset answer score B/C 0.66 vs
A 0.41, evidence recall 0.65 vs 0.04. Latency and context tokens are
reported separately and never folded into quality.

## Demo run record

Presentation world: `data/generated/demo-seed2026` (generator 0.1.0,
world seed 2026, scenario seed 2026): 5,000,000 tickets, 100,000 players,
100,000 accounts, 120,000 devices, 2,000 documents; scenarios SCN-002,
SCN-003, SCN-007, SCN-015 planted at strength 0.8. Separate evaluator
ledger: `data/truth/ledger-demo.json`.

Recorded live API verification (2026-10-09, deterministic fake generator):
run `RUN-FE47FF6EDFA9`, saved question DEMO-02 (SCN-007 cross-market
platform incident), configurations A/B/C. Pipeline A retrieved 8 document
chunks; B resolved the incident and traversed 103 graph nodes; C traversed
129 nodes with 15 authoritative structured records and one ontology concept
expansion. 757 events recorded for replay. Deterministic regeneration:
same seeds and configuration reproduce the world byte-for-byte; model
answers vary only with the configured gateway model (temperature 0).

## How to run

Full run-of-show and recovery: `docs/demo/presentation.md`. Short form:

```bash
make services-up      # Neo4j + Qdrant (Docker/OrbStack)
make demo-reset       # ingest demo graph + rebuild demo vector index
make serve-demo-api   # API on :8000 against the demo world
make dev-frontend     # UI on :5173
```

Live Lab defaults to the committed demo story (offline-safe). Switch the
composer to "Live backend" to execute real A/B/C runs; saved demo questions
load from the API. For model-generated answers set `GENERATION_PROVIDER=litellm`
and the model/base URL when starting `serve-demo-api` (see
`docs/demo/presentation.md` §2). `make demo-reset` restores the demo state
at any time; `make ingest-graph && make index-vector` returns the
development world.

## Known limitations

- Replay state is in-memory (last 50 runs of the API process); `demo-reset`
  plus an API restart regenerates everything.
- SSE progressive delivery and `GET /queries/{id}/evidence` are deferred
  (docs/07 §20); the UI paces playback from recorded `t_ms`.
- The benchmark executes via CLI (`make run-benchmark`); the API only
  publishes results.
- Visual regression baselines are owner-machine only; E2E is Chromium-only.
- No automated performance gates; timings are recorded, not enforced.
