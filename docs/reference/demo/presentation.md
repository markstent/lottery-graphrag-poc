# Demo Script and Recovery (HITL-11)

Status: HITL-11 artefact, 2026-10-09. The run-of-show for presenting the
Semantic Context Lab, with the recovery procedures that back it.

## 1. Demo state

The presentation state is separate from the development state and never
overwrites it:

| Artefact                      | Development                                  | Demo                                        |
| ----------------------------- | -------------------------------------------- | ------------------------------------------- |
| Dataset                       | `data/generated/dev-seed2026` (250k tickets) | `data/generated/demo-seed2026` (5M tickets) |
| Truth ledger (evaluator only) | `data/truth/ledger.json`                     | `data/truth/ledger-demo.json`               |
| Neo4j graph                   | `ingest-graph`                               | `ingest-demo-graph`                         |
| Qdrant collection             | `semantic_context_lab`                       | `semantic_context_lab_demo`                 |

Both worlds share one generator version and world seed 2026; every planted
pattern comes from the scenario engine (SCN-002/003/007/015).

## 2. Bring-up (before the audience arrives)

```bash
make services-up        # Neo4j + Qdrant
make generate-demo-data # only if data/generated/demo-seed2026 is absent (~100s)
make demo-reset         # ingest demo graph + rebuild demo vector index
make ground-demo-bank   # freeze the question bank of the demo world (needs ledger-demo.json)
make serve-demo-api     # API on :8000 against the demo world
make dev-frontend       # UI on :5173 (or open the built bundle)
```

Generation model: `serve-demo-api` inherits the gateway configuration from
the environment. Deterministic fake answers are the default and are safe;
for model-generated answers run:

```bash
GENERATION_PROVIDER=litellm GENERATION_MODEL="ollama/qwen3.5:35b-a3b-q4_K_M" \
GENERATION_API_BASE="http://localhost:11434" make serve-demo-api
```

Answers then take tens of seconds; the UI shows the loading state and every
pane event still streams from real recorded telemetry.

## 3. Run of show

1. **Live Lab, demo story** (default, offline-safe). Walk the recorded
   SCN-007 story: embedding, candidate ranking, context assembly on the
   left; seed resolution, bounded traversal, ontology expansion on the
   right. Rewind the timeline to replay any moment.
2. **Switch to Live backend.** The composer loads the demo questions from
   `GET /api/v1/demo/questions`: the first instance of strata H1, H2, H3
   and H5 in the frozen bank (`make ground-demo-bank` first; the bank is named
   after the demo world's directory, so the development bank is not used). Each one is scored
   against the answer key once its run completes. Run the H1 question:
   both panes animate from the recorded event stream of a real A/B/C
   execution, and the scores per pipeline appear under the panes.
3. **Evidence explorer.** Open a citation from the answer: chunk text,
   source system, market, validity window. Graph citations resolve to the
   node evidence with its ranking components.
4. **Benchmark runner / results dashboard.** Show the published validation
   run (docs/evaluation/harness-validation.md): evidence recall A 0.02 vs
   B/C 0.62 on the full bank, and the real-model subset where B/C answer
   0.66 vs A 0.41. The dashboard serves `GET /api/v1/benchmarks/latest`,
   which publishes the harness output only.
5. **Semantic layer.** The concept catalogue and cross-market equivalences
   that pipeline C used (SCN-007's `PLATFORM_INCIDENT` concept, shared
   game families), each with source provenance.

## 4. Talking points (what the experiment claims)

- Incremental graph value: pipeline A and B/C share embedder, store, corpus,
  reranker, generator and budgets; the only difference is the graph/ontology
  overlay (B = C minus `MAPS_TO` and concept seeds, pinned by tests).
- Honest comparison: 8 of 30 bank questions are not scored because their
  scenarios are not planted; the benchmark never invents truth.
- Provenance everywhere: every answer citation resolves to a source system
  and record; graph nodes reference warehouse rows; authoritative numbers
  come from the structured layer, the graph guides the way there.

## 5. Failure modes and recovery

| Symptom                                   | Cause                                     | Recovery                                                                                                                  |
| ----------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| "Saved questions unavailable" in Live Lab | API not running or wrong world            | start `make serve-demo-api`; check `curl :8000/api/v1/health`                                                             |
| Backend run fails with MODEL_ERROR        | gateway/model down                        | switch the composer back to Demo story, or restart the model server; the run is recorded as failed, nothing fake is shown |
| Traversal returns no seeds for a question | question names no graph-resolvable entity | use a saved demo question (they name real ids)                                                                            |
| Graph/world looks wrong after live tests  | a GRAPH_E2E test wiped Neo4j              | `make demo-reset` (re-ingests demo state in ~2 min)                                                                       |
| Need the development world back           | demo/dev share Neo4j                      | `make ingest-graph` then `make index-vector`                                                                              |
| Answer generation too slow on stage       | 35B local model                           | fall back to the deterministic fake generator (default)                                                                   |

In-memory run state (replayable runs) lives in the API process: restarting
`serve-demo-api` clears it. The committed datasets and ledgers are
deterministic: the same seeds regenerate byte-identical worlds.
