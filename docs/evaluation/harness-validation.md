# Harness Validation (HITL-09)

Status: HITL-09 artefact. Development world (`data/generated/dev-seed2026`),
captured 2026-10-08, committed at Phase 10.

These records, including the `lexical(w=0.3)` reranker, describe the v1 harness and are superseded by the Phase 3 runs.
The v1 30-question bank and its CLI are retired; benchmark v2 (bank 2.0.0) is described in [scoring.md](scoring.md), [statistics.md](statistics.md) and [reproducibility.md](reproducibility.md).

## What this document is

Verbatim reports from two benchmark harness runs over the 30-question bank,
plus the generator performance verification required by the HITL-09 gate:

1. Full bank with the deterministic fake generator (30 questions, 20 scored).
2. Real-model subset (Q01, Q25, Q28, Q30) with a local Qwen model through the
   model gateway, temperature 0.

```bash
cd backend
make ingest-graph    # rebuild the development world graph from parquet
make run-benchmark   # full bank, fake generator
# real-model subset:
GENERATION_MODEL="ollama/qwen3.5:35b-a3b-q4_K_M" \
GENERATION_API_BASE="http://localhost:11434" \
uv run python -m app.evaluation --generator litellm --questions Q01,Q25,Q28,Q30
```

Both runs carry a full reproducibility record (git SHA, bank version, world
seed, generator version, model identifiers, reranker, retrieval budgets).
Absolute local paths in the captured reports are normalised to
repository-relative paths; nothing else is edited.

The fake generator emits templated answers, so answer-correctness scores
exercise the deterministic grader rather than a model; evidence recall is the
discriminating metric. The real-model subset provides the answer-quality
counterpart on scenario questions.

## What the runs validate

- Grounding resolves 20 of 30 questions against this world; 8 map to
  scenarios that are not planted and 2 do not ground (Q06, Q15). All are
  reported, none are scored: the benchmark does not invent truth.
- Pipeline separation on graph questions: evidence recall 0.0 for A versus
  1.0 for B/C on Q01, Q02, Q04, Q05, Q09, Q16, Q21, Q26, Q27.
- Fairness is by construction: all pipelines share the same embedder, vector
  store, corpus, reranker, generator, context budget and scoring.
- Latency and context tokens are recorded per pipeline and reported
  separately from quality.
- The failure taxonomy assigns classes to weak results from telemetry alone
  (`retrieval_failure` marks A's seedless questions).
- With a real model, B/C answer scores beat A on the subset (0.66 vs 0.41
  mean) at matched retrieval settings.

## Generator performance verification

The gate requires evidence that the demo profile is producible. The first
generation attempt exposed a scaling defect: `generate_exposures` rebuilt
cumulative player weights inside the row loop, making generation quadratic in
players x exposures (3M exposures over 100k players did not complete in over
10 minutes). The fix hoists the cumulative weights per market; generated
values are unchanged: the dev world regenerates bit-for-bit, verified by a
full-table `EXCEPT ALL` comparison against the existing parquet set.

After the fix, from scratch on the development machine:

| stage                                      | rows      | elapsed |
| ------------------------------------------ | --------- | ------- |
| tickets + prizes                           | 6,750,899 | 19.2s   |
| campaign exposures                         | 3,000,000 | 25.2s   |
| sessions                                   | 2,000,014 | 31.3s   |
| total: build, scenarios, validation, write | 242 MB    | ~100s   |

The demo world (`data/generated/demo-seed2026`) plants all four enabled
scenarios (SCN-002/003/007/015) and writes its ledger to a separate
evaluator-only path (`data/truth/ledger-demo.json`); the CLI refuses to
overwrite the development ledger. A validation inconsistency was also
corrected: the game catalogue is canonical master data (20 games), so every
profile now declares `games_expected = 20`; profiles scale activity volume,
never the catalogue. Demo generation is approved (HITL-03); stress remains
gated.

## Report: full bank, fake generator

# Benchmark Run

Started: 2026-10-08T16:44:07+00:00

## Configuration

- git_sha: `a468f24478a8a31c1b963e5e092efaa9b8ad90fc`
- question_bank_version: `1.0.0`
- world_dir: `data/generated/dev-seed2026`
- profile: `dev`
- world_seed: `2026`
- scenario_seed: `2026`
- generator_version: `0.1.0`
- embedding_model: `bge-m3`
- generation_model: `fake-answer-v1`
- generation_temperature: `0.0`
- reranker: `lexical(w=0.3)`
- top_k: `8`
- context_budget_tokens: `2000`
- ontology_version: `1.0.0`
- graph_limits: `{'depth': 2, 'nodes_per_hop': 100, 'edges_per_node_type': 4, 'total_nodes': 200, 'evidence_nodes': 12, 'relationship_types': 14}`

Scored questions: 20 of 30

## Per-pipeline summary (means over scored questions)

| pipeline | n   | answer | evidence recall | evidence precision | latency ms | context tokens |
| -------- | --- | ------ | --------------- | ------------------ | ---------- | -------------- |
| A        | 20  | 0.03   | 0.02            | 0.02               | 59         | 209            |
| B        | 20  | 0.03   | 0.62            | 0.11               | 1242       | 898            |
| C        | 20  | 0.03   | 0.62            | 0.10               | 1604       | 973            |

Answer score and evidence metrics are deterministic (docs/evaluation/scoring.md). Latency and context tokens are reported separately and never folded into quality.

## Per-category means (answer score / evidence recall)

| category          | difficulty | n   | A           | B           | C           |
| ----------------- | ---------- | --- | ----------- | ----------- | ----------- |
| CROSS_DOMAIN      | 5          | 1   | 0.00 / 0.00 | 0.00 / 1.00 | 0.00 / 1.00 |
| CROSS_MARKET      | 6          | 1   | 0.00 / 0.17 | 0.00 / 0.83 | 0.00 / 0.83 |
| FACT              | 1          | 4   | 0.00 / 0.00 | 0.00 / 0.81 | 0.00 / 0.81 |
| MULTI_HOP         | 4          | 1   | 0.00 / 0.00 | 0.00 / 0.22 | 0.00 / 0.28 |
| ONTOLOGY          | 6          | 2   | 0.00 / 0.00 | 0.00 / 1.00 | 0.00 / 1.00 |
| PATTERN           | 6          | 1   | 0.00 / 0.00 | 0.00 / 0.29 | 0.00 / 0.29 |
| RELATIONSHIP      | 3          | 4   | 0.01 / 0.00 | 0.01 / 0.49 | 0.01 / 0.49 |
| SEMANTIC          | 2          | 3   | 0.00 / 0.05 | 0.00 / 0.38 | 0.00 / 0.38 |
| TEMPORAL_ONTOLOGY | 6          | 1   | 0.50 / 0.00 | 0.50 / 0.50 | 0.50 / 0.50 |
| TWO_HOP           | 4          | 2   | 0.00 / 0.00 | 0.00 / 0.59 | 0.00 / 0.56 |

## Per-question results

| id  | category          | binding key                     | A ans/rec   | B ans/rec   | C ans/rec   |
| --- | ----------------- | ------------------------------- | ----------- | ----------- | ----------- |
| Q01 | FACT              | game_price                      | 0.00 / 0.00 | 0.00 / 1.00 | 0.00 / 1.00 |
| Q02 | FACT              | game_channels                   | 0.00 / 0.00 | 0.00 / 1.00 | 0.00 / 1.00 |
| Q03 | FACT              | platform_version                | 0.00 / 0.00 | 0.00 / 0.25 | 0.00 / 0.25 |
| Q04 | FACT              | support_count                   | 0.00 / 0.00 | 0.00 / 1.00 | 0.00 / 1.00 |
| Q05 | SEMANTIC          | product_mechanics               | - / 0.00    | - / 1.00    | - / 1.00    |
| Q07 | SEMANTIC          | release_retrieval               | 0.00 / 0.14 | 0.00 / 0.14 | 0.00 / 0.14 |
| Q08 | SEMANTIC          | experiment_retrieval            | 0.00 / 0.00 | 0.00 / 0.00 | 0.00 / 0.00 |
| Q09 | RELATIONSHIP      | segment_mechanic                | 0.00 / 0.00 | 0.00 / 1.00 | 0.00 / 1.00 |
| Q10 | RELATIONSHIP      | game_platform                   | 0.00 / 0.00 | 0.00 / 0.71 | 0.00 / 0.71 |
| Q11 | RELATIONSHIP      | campaign_game                   | 0.00 / 0.00 | 0.00 / 0.25 | 0.00 / 0.25 |
| Q12 | RELATIONSHIP      | platform_incident               | 0.04 / 0.00 | 0.04 / 0.00 | 0.04 / 0.00 |
| Q13 | TWO_HOP           | incident_platform_games         | 0.00 / 0.00 | 0.00 / 0.18 | 0.00 / 0.12 |
| Q16 | TWO_HOP           | game_incident_support           | 0.00 / 0.00 | 0.00 / 1.00 | 0.00 / 1.00 |
| Q18 | MULTI_HOP         | shared_platform_issue           | 0.00 / 0.00 | 0.00 / 0.22 | 0.00 / 0.28 |
| Q21 | CROSS_DOMAIN      | support_precursor               | 0.00 / 0.00 | 0.00 / 1.00 | 0.00 / 1.00 |
| Q25 | CROSS_MARKET      | cross_market_platform_incident  | 0.00 / 0.17 | 0.00 / 0.83 | 0.00 / 0.83 |
| Q26 | ONTOLOGY          | cross_market_product_similarity | 0.00 / 0.00 | 0.00 / 1.00 | 0.00 / 1.00 |
| Q27 | ONTOLOGY          | ontology_equivalence            | 0.00 / 0.00 | 0.00 / 1.00 | 0.00 / 1.00 |
| Q28 | PATTERN           | shared_identity_cluster         | 0.00 / 0.00 | 0.00 / 0.29 | 0.00 / 0.29 |
| Q30 | TEMPORAL_ONTOLOGY | document_structured_conflict    | 0.50 / 0.00 | 0.50 / 0.50 | 0.50 / 0.50 |

## Failure classes (docs/05 section 14)

- generation_failure: 20
- graph_traversal_failure: 2
- retrieval_failure: 34

## Reported but not scored

- Q06 (not_grounded): no GR support documents discuss payment incidents
- Q14 (not_planted): scenario SCN-001 is not planted in this world
- Q15 (not_grounded): no mechanics shared across campaign games of GAME_AT_04
- Q17 (not_planted): scenario SCN-001 is not planted in this world
- Q19 (not_planted): scenario SCN-004 is not planted in this world
- Q20 (not_planted): scenario SCN-005 is not planted in this world
- Q22 (not_planted): scenario SCN-006 is not planted in this world
- Q23 (not_planted): scenario SCN-008 is not planted in this world
- Q24 (not_planted): scenario SCN-013 is not planted in this world
- Q29 (not_planted): scenario SCN-011 is not planted in this world

Questions whose home scenario is not planted in this world are never scored: the benchmark does not invent truth.

## Report: real-model subset (local Qwen via gateway)

# Benchmark Run

Started: 2026-10-08T17:32:01+00:00

## Configuration

- git_sha: `a468f24478a8a31c1b963e5e092efaa9b8ad90fc`
- question_bank_version: `1.0.0`
- world_dir: `data/generated/dev-seed2026`
- profile: `dev`
- world_seed: `2026`
- scenario_seed: `2026`
- generator_version: `0.1.0`
- embedding_model: `bge-m3`
- generation_model: `ollama/qwen3.5:35b-a3b-q4_K_M`
- generation_temperature: `0.0`
- reranker: `lexical(w=0.3)`
- top_k: `8`
- context_budget_tokens: `2000`
- ontology_version: `1.0.0`
- graph_limits: `{'depth': 2, 'nodes_per_hop': 100, 'edges_per_node_type': 4, 'total_nodes': 200, 'evidence_nodes': 12, 'relationship_types': 14}`

Scored questions: 4 of 4

## Per-pipeline summary (means over scored questions)

| pipeline | n   | answer | evidence recall | evidence precision | latency ms | context tokens |
| -------- | --- | ------ | --------------- | ------------------ | ---------- | -------------- |
| A        | 4   | 0.41   | 0.04            | 0.06               | 27583      | 187            |
| B        | 4   | 0.66   | 0.65            | 0.15               | 51258      | 946            |
| C        | 4   | 0.66   | 0.65            | 0.14               | 48676      | 986            |

Answer score and evidence metrics are deterministic (docs/evaluation/scoring.md). Latency and context tokens are reported separately and never folded into quality.

## Per-category means (answer score / evidence recall)

| category          | difficulty | n   | A           | B           | C           |
| ----------------- | ---------- | --- | ----------- | ----------- | ----------- |
| CROSS_MARKET      | 6          | 1   | 1.00 / 0.17 | 1.00 / 0.83 | 1.00 / 0.83 |
| FACT              | 1          | 1   | 0.00 / 0.00 | 1.00 / 1.00 | 1.00 / 1.00 |
| PATTERN           | 6          | 1   | 0.14 / 0.00 | 0.14 / 0.29 | 0.14 / 0.29 |
| TEMPORAL_ONTOLOGY | 6          | 1   | 0.50 / 0.00 | 0.50 / 0.50 | 0.50 / 0.50 |

## Per-question results

| id  | category          | binding key                    | A ans/rec   | B ans/rec   | C ans/rec   |
| --- | ----------------- | ------------------------------ | ----------- | ----------- | ----------- |
| Q01 | FACT              | game_price                     | 0.00 / 0.00 | 1.00 / 1.00 | 1.00 / 1.00 |
| Q25 | CROSS_MARKET      | cross_market_platform_incident | 1.00 / 0.17 | 1.00 / 0.83 | 1.00 / 0.83 |
| Q28 | PATTERN           | shared_identity_cluster        | 0.14 / 0.00 | 0.14 / 0.29 | 0.14 / 0.29 |
| Q30 | TEMPORAL_ONTOLOGY | document_structured_conflict   | 0.50 / 0.00 | 0.50 / 0.50 | 0.50 / 0.50 |

## Failure classes (docs/05 section 14)

- retrieval_failure: 6

## Reported but not scored

All bank questions were grounded and scored.

## Interpretation and caveats

- Answer scores near zero under the fake generator are expected: the fake
  answer factory does not read the retrieved context. Evidence recall is the
  comparator in that run.
- In this world B and C separate on only two scored questions (Q18
  0.22 -> 0.28 in C's favour; Q13 0.18 -> 0.12 against). With concept seeds
  replacing `MAPS_TO` traversal, the ontology layer adds little beyond the
  relationship layer on this bank and world. The comparison stands as
  measured; no post-hoc tuning of C is applied.
- Q28 and Q30 remain partially correct with a real model for every pipeline:
  planted-pattern and document-conflict questions are genuinely hard, not
  artefacts of the fake generator.
- Q12 evidence is 0.0 for all pipelines: the binding support cases sit below
  the fixed traversal fan-out of the v1 harness (this record is the only note
  of it; the v1 bank page never carried one, and the page is now generated
  for bank 2.0.0).
- Q03 evidence is 0.25 for B/C: the binding platform-version row is not a
  first-class evidence node; version recency is resolved by convention.
- Real-model latencies (28-51s per question) are dominated by local 35B
  generation on the development machine and are not comparable with the fake
  generator's retrieval-only latencies.
- Single runs, no variance estimates. Scoring is deterministic and the
  pipelines are deterministic given the world, so a repeat run reproduces
  these numbers.
- The v1 harness used no LLM judge. Benchmark v2 adds a versioned, blinded
  judge beside the deterministic scores (docs/evaluation/scoring.md).
