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

- `--repeats` defaults to 1 for a smoke run and 3 for an official run or a sweep; it must be a whole number of at least 1 (`--repeats 0` is refused, not replaced by the default), and an official run refuses fewer than 3.
- `--strata` keeps only the instances of those strata.
- `--limit N` keeps at most N instances of each logical question, in bank order.
- A run with `--strata` or `--limit` records them as its `selection` and is labelled, for example "subset run (strata H1; at most 2 instances per question)"; it is never published as the official result (see below).
- Before any world is prepared, the run checks its kind, its repeats and the generator and judge settings in the environment, so a wrong setting fails in seconds rather than after a world is generated.
  A smoke run uses the fake generator and judge; a sweep or official run refuses the fake generator and needs `JUDGE_PROVIDER=litellm`; an official run also needs three repeats and the two model families, which must differ.
- Every run, smoke or official, uses graph depth 2; only the sweep changes it.
- The generation and judge models come from the environment (`GENERATION_*` and `JUDGE_*` in `.env.example`); nothing is read from a `.env` file.
- `GENERATION_REASONING` and `JUDGE_REASONING` (`default` or `off`; any other value is refused) control a thinking model's hidden reasoning through the gateway.
  `off` sends LiteLLM's `reasoning_effort="none"`, which LiteLLM turns into `think=false` for Ollama models.
  Local thinking models need `off`: the first local pilot (`pilot-2026`) ran with `default`, and both models spent their token caps (1200 for generation, 300 for the judge) on hidden reasoning, returning empty answers for 159 of 198 generations and every judge call.

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
When a world fails and the restore fails too, the world's error is raised with the restore failure attached as a note and logged; run `make ingest-graph` to restore the graph by hand.

Grounding refuses a truth ledger of another world seed than the world's `_manifest.json`.
A bank file that matches its own hash but cannot be read (a missing or mistyped field) counts as failing, so the bank is grounded again rather than the run crashing.

The runner refuses to score a world when the lab reads another dataset directory than the world, or when the frozen bank was grounded in another world, by another bank version or over another record serialiser than the index in use.

## Run directories and run ids

A run is written to `data/evaluation/runs/<run id>/` unless `--out` names another directory.
The run id is the start time in UTC followed by the run kind, `YYYYMMDDTHHMMSSZ-<kind>`, for example `20261019T140507Z-official`.
Its fixed-width timestamp comes first, so run ids sort in time order as plain text, and it holds only digits, letters and hyphens, so it is safe as a file name on every system.
A run refuses a directory that already holds a run.

| File | Written by | Contents |
|---|---|---|
| `results.json` | `run` | The selection, the record, and per world every instance, every repeat of every pipeline (answer, shown blocks, selected carriers, resolved ids, tokens, latency) and every score. |
| `report.md` | `run`, `sweep` | The summary rendered as tables. |
| `summary.json` | `run` | The published numbers: metrics per stratum, comparisons, headlines, judge agreement, failures, the selection and the record (see [statistics.md](statistics.md)). |
| `sweep.json` | `sweep` | Per depth: the H1 metrics per pipeline (B and C) and that depth's record; no test and no headline. |
| `comparison.json` | `compare` | H7: large minus small per pipeline, stratum and metric, as clustered intervals. |

Each file is written to a temporary file in the same directory and then moved into place, so a reader never sees half a file.
`summary.json` is written last.
The API publishes `summary.json` only: `GET /api/v1/benchmarks/latest` reads `data/evaluation/runs/*/summary.json` (or `BENCHMARK_DIR`), schema version 2 only, and prefers the newest official run of the whole bank (`selection` with no strata and no limit) by start time.
When there is none, it publishes the newest run of any kind, a subset official run included, with its label.
A sweep writes no `summary.json`, so it is never published as the latest run.
`compare` writes to `data/evaluation/comparisons/<run id>/` unless `--out` names another directory.

`data/` is not committed; committed evaluation documents summarise runs and name the command that produced them.

## Model comparison (H7)

`compare` takes two official runs that used different generation models over the same frozen banks (the same bank hash for every world) and the same selection, and refuses anything else.
It pairs instances by instance id; an instance's value is the mean over its scored repeats.
For every pipeline, stratum and the two compared metrics (`answer` and `evidence_f1`) it reports the mean difference, large minus small, with the clustered bootstrap interval of [statistics.md](statistics.md), and no test.

## The reproducibility record

Every run stores the record below as `reproducibility` in `summary.json` and `results.json`, in two parts:

- `worlds`: each world's full record, in run order.
- `run`: the fields every world's record shares, plus `started_at` (described below).
  A field that differs between worlds, such as `world_seed`, `world_dir`, `scenario_seed` or `bank_hash` in a three-world run, appears only under `worlds`.

`report.md` prints the run's start as "Run started" at the top, lists the shared fields, then for each world the fields that differ, its own `started_at` included.
A sweep stores the same two parts for each depth in `sweep.json`.

Code and bank:

- `git_sha`: the commit the run ran on (`unknown` outside a git checkout).
- `git_dirty`: true when `git status --porcelain` listed uncommitted changes, so the code was not exactly `git_sha`; null when git was unavailable.
- `question_bank_version` and `bank_version`: the bank version in the code and in the frozen bank (both 2.0.0).
- `bank_hash`: sha256 of the frozen bank's canonical JSON.
- `scorer_version`: version of the deterministic scorer (2.0.0).
- `run_kind`: `smoke`, `official` or `sweep`.
- `repeats`: generation repeats per pipeline and instance.
- `started_at`: when the world's runner was built, in UTC.
  Under `run` it is the first world's `started_at`, which is when the run started; the API orders runs by it.

World:

- `world_dir`: the generated world the run read.
- `generator_version`, `profile`, `world_seed`, `scenario_seed`: from the world's `_manifest.json`.
- `reference_date`: records whose validity ended before this date rank as superseded in graph evidence ranking.
- `ontology_version`: the ontology the graph and C use.
- `graph_label_version`: the version of the graph's node labels and relationship types (`LABEL_VERSION` in `app/graph/config.py`).

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
- `generation_reasoning`: `default` (provider behaviour unchanged) or `off` (the gateway asks a thinking model not to think), from `GENERATION_REASONING`.
- `prompt_version`, `prompt_hash`: the answer prompt version (2.0.0) and the sha256 of its system prompt.

Judge:

- `judge_model`, `judge_model_family`: the judge model.
- `judge_reasoning`: `default` or `off`, from `JUDGE_REASONING`; null for the fake judge, which calls no model.
- `judge_temperature`: the judge's temperature, from `JUDGE_TEMPERATURE`; null for the fake judge.
- `judge_prompt_version`, `judge_prompt_hash`: the judge prompt version (1.0.0) and the sha256 of its system prompt, its version and its user-message template.

Each repeat in `results.json` carries its own repeat index.

## Logs

The runner writes one structured INFO record per repeat, including repeats whose generation failed, to the `app.evaluation.runner` logger, with these fields as record attributes: `world_seed`, `bank_hash`, `instance_id`, `question_id`, `pipeline`, `repeat`, `latency_ms`, `generation_error`, `judge_failure` and `judge_latency_ms`.
No run id reaches the runner, so the world seed and the bank hash identify the run.
The records never carry a question's expected answer, the generated answer or any secret.

## What is deterministic

Generation of a world, grounding of the bank, retrieval, scoring and the statistics are deterministic for the same code, seeds, models and indices: the bootstrap uses a fixed seed, and the runner stops if retrieval selects different carriers in two repeats.
Answer generation and judging with a real model may vary between repeats even at temperature 0; that is why an official run has three repeats and reports their mean.
