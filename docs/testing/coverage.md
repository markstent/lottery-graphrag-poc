# Test Matrix and Critical Coverage

Status: HITL-10 artefact, 2026-10-09. Counts refer to the commit that added
this document; `make test` and CI keep them current.

## Layers

| Layer | Where | What |
|---|---|---|
| Static checks | local + CI | ruff format/check, mypy strict (backend); prettier, oxlint, tsc strict (frontend) |
| Unit (offline) | local + CI | 127 backend tests: generation determinism, scenario planting, ontology mapping, ranking, context assembly, scoring, grounding, bank integrity, B/C fairness, failure propagation. 13 frontend vitest suites: shell render, telemetry mock, playback state |
| Integration (live services) | CI (services always up); locally under `GRAPH_E2E=1` / `VECTOR_E2E=1` | 16 backend tests: Neo4j ingestion, bounded GraphRAG traversal against the real graph, full benchmark runner, Qdrant vector store |
| E2E | CI + local | Playwright smoke: application shell renders with primary navigation over the built frontend |
| Visual regression | local only (`pnpm e2e:visual`) | 5 approved screenshot baselines (HITL-07 visual contract); cross-machine font rendering keeps it out of CI |
| Performance evidence | recorded, not gated | the harness records per-question latency and context tokens (docs/evaluation/harness-validation.md); demo-profile generation verified at ~100s (docs/evaluation/harness-validation.md). Timings are never folded into quality scores |
| Live-model benchmark | manual | real-model subset runs through the gateway (docs/evaluation/harness-validation.md); CI never requires a commercial model (fake generator + hashing embedder defaults) |

## Critical areas (AGENTS.md) to tests

| Critical area | Tests |
|---|---|
| Scoring | `test_benchmark_scoring.py` (17): answer checks (number/token/set), evidence precision/recall, failure taxonomy incl. `generation_failure` |
| Truth-ledger isolation | `test_truth_ledger_isolation.py` (5): forbidden literals and imports across retrieval/api/datasets/graph modules |
| Scenario injection | `test_scenarios.py` (9): planted patterns, truth-ledger metadata, determinism |
| Deterministic generation | `test_determinism.py` (3), `test_validation.py` (5), `test_datasets` stage coverage via scenarios |
| Evidence selection | `test_graph_rag.py` ranking/selection/discard tests (17), `test_standard_rag.py` context selection (18) |
| Benchmark execution | `test_benchmark_bank.py` (9), `test_benchmark_grounding.py` (7), `test_benchmark_live.py` (4) |
| Experiment configuration (B/C fairness) | `test_lab_fairness.py` (4): B = C minus `MAPS_TO` and concept expansion, identical budgets, fraud profile symmetric |
| Graph traversal limits | `test_graph_rag.py` depth/limits/beyond-limit discard tests |
| Provenance | `test_provenance.py` (4), `test_graph_statements.py` (6) |

## Failure-mode coverage

Pipelines raise rather than fabricate success when the gateway, embedder or
vector store fails (`test_failure_modes.py`, 6 tests). The benchmark runner
contains gateway failures per question as `generation_failure` results so one
flaky model call cannot destroy an official run, while infrastructure errors
still fail loudly (`test_benchmark_live.py::test_gateway_failure_is_recorded_not_fatal`).
API error mapping is not applicable yet: the HTTP surface is the health
endpoint only; the pipelines are invoked through CLIs. Failure mapping for the
presentation-mode API is Phase 13 work.

## Known gaps

- No automated performance gates: timings are recorded and reviewed
  (harness-validation, generator stage logs) but nothing fails a build on
  latency. Deliberate: timing assertions are flaky in shared CI.
- Frontend unit coverage is thin (13 tests): it covers shell, telemetry
  contract and playback state, not every component. Component tests grow with
  presentation mode (Phase 13).
- Visual regression runs on the owning machine only; baselines regenerate via
  `--update-snapshots` after approved UI changes.
- Single-browser E2E (chromium).
