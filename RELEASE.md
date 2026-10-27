# Release: v0.2.0

Date: 2026-10-27.
Code of the official run: `27a4ce4` on `overhaul/v2`, clean tree.
Gate status: HITL-12 design approved 2026-10-18; CP1, CP2 and CP3 approved by the project owner (see `HITL_STATUS.md`).
Release status: signed off by the project owner on 2026-10-27, with the go-ahead to tag `v0.2.0` and merge to `main`.

## What this is

The overhaul v2 of the experiment: a synthetic lottery operator in four markets, three approaches over one shared lab (A text search, B graph, C graph and ontology), bank 2.0.0, eight planted scenarios scored against a truth ledger the pipelines cannot read, and a web app with Overview, Live Lab, Results, Data Model and Help.

## Benchmark version record

| Item | Value |
|---|---|
| Question bank | 2.0.0, 50 instances per world, 150 in the run |
| Worlds | dev profile, seeds 2026, 2027 and 2028, generator 0.2.0, ontology 2.0.0 |
| Answer model | `ollama/qwen3.6:latest`, temperature 0, reasoning off, 1,200-token cap, prompt 2.0.0 |
| Judge | `ollama/gemma4:31b`, temperature 0, reasoning off, judge prompt 1.0.0 |
| Retrieval | `bge-m3` embeddings, `Qdrant/bm25` sparse, `BAAI/bge-reranker-v2-m3` re-ranker, top 40 passages, graph depth 2 and at most 200 nodes |
| Selection | `reranker-graph-share` (D-081): 12 evidence slots, 6 for graph records in B and C, 2,000-token budget |
| Scorer | 2.0.0; Wilcoxon on group means, Holm-adjusted over the tested family, cluster bootstrap intervals |
| Repeats | 3 |

## Official run record

Run `official-2026-10-26`, kept in `data/evaluation/runs/official-2026-10-26/` (not in git), from 2026-10-26 11:42 to 2026-10-27 03:21 UTC.

- 1,350 answers, no generation failure, 2 judge failures (Ollama server errors while the machine slept).
- No detectable difference in any of the eight tested comparisons.
- Evidence score over every question A 0.19, B 0.17, C 0.19; answer score 0.44 for each.
- Descriptive only: on name-anchored ontology questions C is 13.4 evidence points and 10.4 answer points above B, and B is 14.7 evidence points below A.
- Judge agreement with the deterministic answer score: 53 percent, kappa 0.07.

The full outcome and its limits are in `README.md` ("Headline numbers") and `docs/evaluation.md` ("Status of results").

## How to run

```bash
make services-up         # Neo4j and Qdrant
make dev                 # API on :8000 and UI on :5173
make run-benchmark OUT=data/evaluation/runs/<name>   # an official run; RESUME=1 resumes it
make dry-run             # the four-question dry run of the official settings
```

An official run wipes and reloads the graph for each world and restores the presentation world at the end, so nothing else may use the graph while it runs.
`GENERATION_*` and `JUDGE_*` choose the models; the official values are in the table above.

## Known limitations

- The judge and the deterministic answer score often disagree (kappa 0.07).
- Each tested comparison rests on 12 question groups, so a small effect would not be detected.
- One small local answer model.
- The re-ranker keeps most of the graph's findings out of the prompt even under D-081.
- The owner items carried with CP3 in `HITL_STATUS.md` stand.

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
| Validation runs | `docs/reference/evaluation/harness-validation.md` (fake full bank 2026-10-08; real-model subset Q01/Q25/Q28/Q30 2026-10-08) |

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

Full run-of-show and recovery: `docs/reference/demo/presentation.md`. Short form:

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
`docs/reference/demo/presentation.md` §2). `make demo-reset` restores the demo state
at any time; `make ingest-graph && make index-vector` returns the
development world.

## Known limitations

- Replay state is in-memory (last 50 runs of the API process); `demo-reset`
  plus an API restart regenerates everything.
- SSE progressive delivery and `GET /queries/{id}/evidence` are deferred
  (docs/reference/07 §20); the UI paces playback from recorded `t_ms`.
- The benchmark executes via CLI (`make run-benchmark`); the API only
  publishes results.
- Visual regression baselines are owner-machine only; E2E is Chromium-only.
- No automated performance gates; timings are recorded, not enforced.
