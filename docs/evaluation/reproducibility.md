# Reproducibility (benchmark v2, as built)

This page explains how a benchmark run is started, where it is written, and every field it records so the run can be repeated and audited.
The code is `backend/app/evaluation/official.py` (orchestration) and `backend/app/evaluation/runner.py` (the record).
How answers are scored is in [scoring.md](scoring.md); how scores become comparisons is in [statistics.md](statistics.md).

## Commands

| Command | What it does |
|---|---|
| `make ground-bank` | Grounds bank 2.0.0 into the presentation world (seed 2026) and writes `data/evaluation/bank/bank-2.0.0-seed2026.json`. |
| `make run-smoke` | Scorer smoke test on seeds 2026, 2027 and 2028 with the fake generator and the fake judge. |
| `make run-benchmark` | Official run on the same three seeds with three repeats; needs `GENERATION_PROVIDER=litellm` and `JUDGE_PROVIDER=litellm` with their models and families set. |
| `make run-sweep` | The H1 depth sweep at depths 0, 1, 2 and 3 for B and C on the three seeds; needs a gateway judge. |

The Makefile targets call the CLI, which takes more options:

```bash
cd backend
uv run python -m app.evaluation run --kind smoke|official [--seeds 2026,2027,2028] [--repeats N] [--strata H1,H3] [--limit N] [--out DIR]
uv run python -m app.evaluation sweep [--seeds ...] [--depths 0,1,2,3] [--repeats N] [--limit N] [--out DIR]
uv run python -m app.evaluation compare SMALL_RUN_DIR LARGE_RUN_DIR [--out DIR]
```

- `--repeats` defaults to 1 for a smoke run and 3 for an official run or a sweep; an official run refuses fewer than 3.
- `--strata` keeps only the instances of those strata.
- `--limit N` keeps at most N instances of each logical question, in bank order.
- Every run, smoke or official, uses graph depth 2; only the sweep changes it.
- The generation and judge models come from the environment (`GENERATION_*` and `JUDGE_*` in `.env.example`); nothing is read from a `.env` file.

## Three worlds in turn

An official run uses the dev profile on world seeds 2026, 2027 and 2028, one after the other, with the scenario seed equal to the world seed.
Before each world is scored it is brought up to date:

| Step | When it runs |
|---|---|
| Generate the world (`app.datasets`) | The world or its ledger is missing, or `_manifest.json` names another generator version, world seed or scenario seed. |
| Ingest the graph (`app.graph --wipe`) | Every time, because Neo4j holds one world at a time. |
| Index the vector collection (`app.retrieval.standard`) | The world was just generated, the collection is empty, or `vector-index.json` names another record serialiser version or collection. |
| Ground and freeze the bank | The bank file is missing, fails its own hash, or names another bank version, world manifest hash, ledger hash or record serialiser version. |

Where each seed lives:

| Seed | World | Truth ledger | Frozen bank | Qdrant collection |
|---|---|---|---|---|
| 2026 (presentation) | `data/generated/dev-seed2026` | `data/truth/ledger.json` | `data/evaluation/bank/bank-2.0.0-seed2026.json` | `QDRANT_COLLECTION` (default `semantic_context_lab`) |
| 2027, 2028 | `data/generated/dev-seed{seed}` | `data/truth/dev-seed{seed}.json` | `data/evaluation/bank/bank-2.0.0-seed{seed}.json` | `QDRANT_COLLECTION` plus `_seed{seed}` |

After the last world, and also when any world fails, the presentation world's graph (seed 2026) is ingested again, so Live Lab and Data Model read the world they expect.

The runner refuses to score a world when the lab reads another dataset directory than the world, or when the frozen bank was grounded in another world, by another bank version or over another record serialiser than the index in use.

## Run directories and run ids

A run is written to `data/evaluation/runs/<run id>/` unless `--out` names another directory.
The run id is the start time in UTC followed by the run kind, `YYYYMMDDTHHMMSSZ-<kind>`, for example `20261019T140507Z-official`.
Its fixed-width timestamp comes first, so run ids sort in time order as plain text, and it holds only digits, letters and hyphens, so it is safe as a file name on every system.
A run refuses a directory that already holds a run.

| File | Written by | Contents |
|---|---|---|
| `results.json` | `run` | Every instance, every repeat of every pipeline (answer, shown blocks, selected carriers, resolved ids, tokens, latency) and every score, per world, each world with its own record. |
| `report.md` | `run`, `sweep` | The summary rendered as tables. |
| `summary.json` | `run` | The published numbers: metrics per stratum, comparisons, headlines, judge agreement, failures and the run record (see [statistics.md](statistics.md)). |
| `sweep.json` | `sweep` | Per depth: the H1 metrics per pipeline (B and C) and that depth's record; no test and no headline. |
| `comparison.json` | `compare` | H7: large minus small per pipeline, stratum and metric, as clustered intervals. |

Each file is written to a temporary file in the same directory and then moved into place, so a reader never sees half a file.
`summary.json` is written last.
The API publishes `summary.json` only: `GET /api/v1/benchmarks/latest` reads `data/evaluation/runs/*/summary.json` (or `BENCHMARK_DIR`), schema version 2 only, and prefers the newest official run by start time.
A sweep writes no `summary.json`, so it is never published as the latest run.
`compare` writes to `data/evaluation/comparisons/<run id>/` unless `--out` names another directory.

`data/` is not committed; committed evaluation documents summarise runs and name the command that produced them.

## Model comparison (H7)

`compare` takes two official runs that used different generation models over the same frozen banks (the same bank hash for every world) and refuses anything else.
It pairs instances by instance id; an instance's value is the mean over its scored repeats.
For every pipeline, stratum and the two compared metrics (`answer` and `evidence_f1`) it reports the mean difference, large minus small, with the clustered bootstrap interval of [statistics.md](statistics.md), and no test.

## The reproducibility record

Every run stores the record below: as `reproducibility` in `summary.json` and `results.json`, and once per world under `worlds` in `results.json`.
Over several worlds the run-level record is the first world's; the world-level records differ only in the world fields (`world_dir`, `world_seed`, `scenario_seed`, `generator_version`, `profile`), `bank_hash`, `record_serialiser_version` and `started_at`.

Code and bank:

- `git_sha`: the commit the run ran on (`unknown` outside a git checkout).
- `question_bank_version` and `bank_version`: the bank version in the code and in the frozen bank (both 2.0.0).
- `bank_hash`: sha256 of the frozen bank's canonical JSON.
- `scorer_version`: version of the deterministic scorer (2.0.0).
- `run_kind`: `smoke`, `official` or `sweep`.
- `repeats`: generation repeats per pipeline and instance.
- `started_at`: when the world's runner was built, in UTC (the API orders runs by this time).

World:

- `world_dir`: the generated world the run read.
- `generator_version`, `profile`, `world_seed`, `scenario_seed`: from the world's `_manifest.json`.
- `reference_date`: records whose validity ended before this date rank as superseded in graph evidence ranking.
- `ontology_version`: the ontology the graph and C use.

Retrieval:

- `embedding_model`, `embedding_dimensions`: the dense model.
- `sparse_model`: the sparse (BM25) model.
- `rrf_k`: the reciprocal rank fusion constant (60).
- `record_serialiser_version`: the serialiser that built the index in use, from `vector-index.json`.
- `reranker`: the shared reranker model.
- `top_k`: dense and sparse hits each before fusion.
- `context_budget_tokens`: the one token budget of every pipeline.
- `context`: the dedupe threshold and the evidence slot count.
- `dedupe_threshold`: the near-duplicate threshold, also at the top level.
- `graph_limits`: depth, nodes per hop, edges per node type, total nodes and the number of relationship types.
- `relationship_types_b`, `relationship_types_c`: the full relationship allow-lists of B and C.
- `ranking_weights`: the graph evidence ranking weights.
- `excluded_labels`: node labels traversal never follows (`Document`).

Generation:

- `generation_model`, `generation_model_family`, `generation_quantisation`: the answer model.
- `generation_temperature`, `max_tokens`: its parameters.
- `prompt_version`, `prompt_hash`: the answer prompt version (2.0.0) and the sha256 of its system prompt.

Judge:

- `judge_model`, `judge_model_family`: the judge model.
- `judge_prompt_version`, `judge_prompt_hash`: the judge prompt version (1.0.0) and the sha256 of its system prompt plus version.

Each repeat in `results.json` carries its own repeat index.

## What is deterministic

Generation of a world, grounding of the bank, retrieval, scoring and the statistics are deterministic for the same code, seeds, models and indices: the bootstrap uses a fixed seed, and the runner stops if retrieval selects different carriers in two repeats.
Answer generation and judging with a real model may vary between repeats even at temperature 0; that is why an official run has three repeats and reports their mean.
