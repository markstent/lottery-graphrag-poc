# Evaluation

This page describes how the three pipelines are compared: the hypotheses, the question bank, how one answer is scored, how scores become comparisons, and what a run records so it can be repeated.
The pipelines are in [retrieval.md](retrieval.md), the planted scenarios in [scenarios.md](scenarios.md), and the routes that publish results in [api.md](api.md).

Two generated pages sit beside this one and are never edited by hand:

- [evaluation/question-bank.md](evaluation/question-bank.md) lists every question of bank 2.0.0 with its instances, answer checks and claims for the presentation world.
- [evaluation/example-traces.md](evaluation/example-traces.md) shows the demo questions run side by side through A, B and C, with the stand-in generator.

## Status of results

The official run v0.2.0 is the one official result.
It ran from 2026-10-26 11:42 to 2026-10-27 03:21 UTC at commit 27a4ce4 with a clean tree, after the owner approved CP3, and is kept in `data/evaluation/runs/official-2026-10-26/` (not in git).
Three worlds (2026, 2027, 2028), the whole bank of 150 instances, three approaches and three repeats gave 1,350 answers, each judged; the answer model was `ollama/qwen3.6:latest` and the judge `ollama/gemma4:31b`, both with reasoning off, under the selection rule `reranker-graph-share` (D-081).

- None of the eight tested comparisons shows a detectable difference (Holm-adjusted Wilcoxon on group means).
- Over every question, the evidence score (F1) is 0.19 for A, 0.17 for B and 0.19 for C, and the answer score is 0.44 for all three.
- Descriptive, outside the family: on the 18 name-anchored instances B is 14.7 evidence points below A (interval 10.8 to 18.6 below) and C is 13.4 above B (8.4 to 18.6) with an answer score 10.4 points higher (3.6 to 18.6); over every ontology-dependent question C is 4.0 evidence points and 4.1 answer points above B.
- Failure causes per 450 answers: "the needed evidence was not retrieved" 216 (A), 213 (B), 201 (C); "the evidence was retrieved but the answer was wrong" 72, 60, 81; "the starting record was not found" 0, 9, 9.
- The judge's correctness agrees with the deterministic answer score (at least 0.5) on 53 percent of 1,348 judged answers, kappa 0.07: the two measures of a right answer disagree often, which limits how far either can be read alone.
- No answer failed; 2 judge calls failed, both in B, with an Ollama server error while the machine slept.

Read with the selection diagnostic below, the result points at evidence selection: the graph reaches many of the facts, and the re-ranker and the 12 prompt slots keep most of them from the model.
It does not show that a graph or an ontology cannot help; it shows that, with this selection rule, this answer model and this bank, they did not measurably help.

Evidence from before the official run is development evidence:

- four recorded live runs in the Live Lab (one question each from H1, H2, H3 and H5, one model, one repeat), which showed B and C no better than A;
- the selection rule changed on 2026-10-25, after the CP3 proposal and after pilot runs and a diagnostic in which B and C did no better than A: half of the 12 evidence slots now go to the graph's own selection (D-081, see [retrieval.md](retrieval.md)), and the development pilot runs below used the old rule (D-025);
- on the multi-hop question, the shared re-ranker kept the graph's claim record out of the prompt (decision D-025), which led to the change of rule above (see [retrieval.md](retrieval.md));
- the selection diagnostic of 2026-10-25 found that the graph finds 55 (B) and 88 (C) of the 122 claims of seed 2026, but only 38 and 39 reach the prompt, against 43 for A, because the 12 prompt slots cut them; the options and the recommendation are in [the official run proposal](evaluation/official-run-proposal.md);
- the same diagnostic, run once after the change, found 41 (B) and 43 (C) claims in the prompt, against 43 for A, with 23 and 51 of the graph's claims still left out, because within the graph's six slots the re-ranker prefers other graph records;
- local pilot and smoke runs of the harness (two subset runs with a local model and one scorer smoke test, kept under `data/`, which is not committed).
  The API lists them with their label, "subset run" or "scorer smoke test", and none is an official result.

## Purpose

The benchmark measures the incremental value of two layers: the graph (B against A) and the ontology (C against B).
It reports each metric on its own, with no composite score, and it states what it cannot say.

### Hypotheses

| Id | Hypothesis | How it is measured |
|---|---|---|
| H1 | Graph retrieval improves evidence recall as relationship depth increases | Multi-hop questions (stratum H1), and the depth sweep from 0 to 3 for B and C |
| H2 | The ontology improves cross-market concept matching beyond graph structure alone | Ontology-dependent questions (stratum H2), C against B |
| H3 | Single facts show little or no advantage from the graph | Single-fact questions (stratum H3), answer score |
| H4 | The graph improves provenance and explainability | Citation accuracy and the numeric citation rate. Path explainability has no metric. |
| H5 | The graph improves discovery of planted multi-entity patterns | Planted-pattern questions (stratum H5) |
| H6 | The graph may increase latency but improve quality and context efficiency | Latency, context tokens and evidence per 1,000 tokens, reported as their own metrics |
| H7 | A smaller local model with richer context may approach a larger model | `compare`: two official runs with different generation models |

All hypotheses are measured and not assumed.
H4, H6 and H7 are metrics or run kinds over the questions and have no stratum of their own.

### What would count as success

From the product's success criteria: the three configurations run over the same world, results are reproducible, every graph traversal on screen is backed by recorded events, evidence is inspectable, and graph and ontology value are measured separately.
The owner's thesis is that graphs and ontologies add value to questioning, and the product's job is to find out and show the answer either way.

## Architecture

### The question bank

Bank 2.0.0 (`BANK_VERSION`, in `backend/app/evaluation/bank.py`) has 22 logical questions.
A logical question is written once in plain English with one slot for its anchor: a record id, or for two questions a local-language name.
Grounding fills the slot for a given world.

| Stratum | Questions | What they test |
|---|---|---|
| H3 single facts | L01 to L04 | One price, one link, one date, one flag, each read from one record |
| H1 multi-hop | L05 to L08 | Two or more relationships: other markets with incidents on the same platform version, mechanics of games affected by an incident, the platform version behind a support case's incident, games affected on a platform version |
| H2 ontology-dependent, id-anchored | L09 to L12 | Equivalence across markets: games of the same kind of family, incidents of the same kind, segments that correspond, games with the same kind of main mechanic |
| H2 ontology-dependent, name-anchored (`H2_name`) | L13, L14 | A local-language family or mechanic name resolved to a concept |
| H5 planted patterns | L15 to L22 | One question for each of SCN-001, 002, 003, 007, 009, 010, 011 and 015 |

Each structural question is grounded to up to three anchors per world.
Each planted question is grounded to one instance, read from the truth ledger.
The seed 2026 world's frozen bank has 50 instances: 14 structural questions at three anchors, and 8 planted questions at one.
The three benchmark worlds (seeds 2026, 2027 and 2028) therefore give 150 instances.
The full text, checks and claims of the seed 2026 instances are in [evaluation/question-bank.md](evaluation/question-bank.md).

Every question carries its plain-English text, what it tests in one sentence, its stratum, its scenario or base fact, an `ontology_dependent` flag, an expected answer and the claims a correct answer makes.
Every published question maps to a planted scenario or to a base fact of the world.
The bank has no "not planted" questions.

### Grounding and freezing

`python -m app.evaluation ground` (`make ground-bank`) grounds the bank into one world and writes `data/evaluation/bank/bank-2.0.0-<dataset directory name>.json`.
Anchors are chosen in a stable hash order (sha256 of `bank version:question id:anchor`), among anchors inside fixed eligibility bounds: an answer set of 1 to 6 members once the anchor is excluded, with bounds of their own for L06, L11, L13 and L14 (D-030).
The file is frozen with its hash, the world manifest hash, the ledger hash and the record serialiser version.
A run refuses a bank that is missing, fails its own hash, or names another bank version, world, ledger or serialiser.
Retrieval code never sees the bank, the claims or the checks.

L13 and L14 anchors are one per concept, spread across languages.
L14 has exactly three qualifying concepts in seed 2026, so it has no margin, and a world with fewer would give it fewer instances.

### Claims and carriers

A claim is one plain sentence a correct answer states, plus its carriers.
A carrier is a source item that states the fact: a structured record id, or the id of any document chunk whose text states it.
For example, the multi-hop claim "Incident INC_024 in MKT_CZ was seen on platform version PLV_IDENTITY_2." is carried by the incident's record and by any chunk that says so.
The evidence metric credits a pipeline for whichever source it found.

Carriers are computed once at grounding time from the world's record blocks and chunks, and frozen with the bank.
Planted claims and expected answers come from the ledger only.

### The anchor is excluded

A structural question names its anchor, so the pipeline is given the id and finding it is no discovery.
The anchor is removed from every claim's carriers and from the pipeline's selected evidence before the evidence metrics are computed.
A claim left with no carrier is dropped.
When no claim survives, the instance's evidence metrics are undefined and not zero, and the instance counts toward the answer metrics only.

L01 and L04 are scored on the answer only, because the only source of a game's price or digital flag is the game's own record, which is the anchor.
In the seed 2026 bank the same holds for every H3 instance, so single facts are compared on the answer.
H1 and H2 anchors that would leave no claim are not eligible, so every H1 and H2 instance has evidence to discover.
Whether the anchor was reached is reported separately as anchor resolution.
Pipeline A has no entity resolution stage, so for A that metric reads the selection alone, and the report labels it "selection only".

### Evidence metrics

The selected evidence is the list of carriers a pipeline placed in the prompt, in order, with duplicates and the anchor removed.
Every pipeline has at most the same number of slots and the same token budget, so the metrics compare equal context.

| Metric | Definition |
|---|---|
| Recall | The share of claims with at least one carrier selected |
| Precision | The share of selected items that carry at least one claim. An empty selection has precision 0. |
| F1 | The harmonic mean of recall and precision. The screens call it the evidence score. |
| Efficiency | Claims found per 1,000 context tokens |

Retrieval must select the same carriers in every repeat of an instance, and only generation may vary.
The runner stops the run with an error if a repeat selects anything else.

### Answer checks

Each instance carries one or more checks written at grounding time from the expected answer.
The answer score is the mean of its checks, from 0 to 1.
Number, token and set checks read the verdict and the answer text together.

| Check | Rule |
|---|---|
| Verdict | 1 when the verdict opens with the expected "yes" or "no", else 0 |
| Token | 1 when the answer names the expected value or an alias as a whole word, ignoring case. Boundaries are Unicode-aware, so `INC_01` does not match inside `INC_010`. |
| Set | The F1 of the ids the answer names against the expected ids, over a fixed universe of candidates. An alias shared by more than one id identifies none. The anchor is excluded from every universe. |
| Number | 1 when the expected number is the only distinct number read, 0.5 when other numbers appear beside it, 0 when it is missing |

For a number check with a unit, only numbers standing next to that unit are read (`2.50 EUR`, `€2.50`).
Numbers are compared after normalisation, so `2.50` matches `2.5`.
A comma followed by exactly three digits is a thousands separator, and any other comma is a decimal point.
Citation markers, identifiers such as `INC_042` and dates are not numbers.
European grouping (`1.200,00 €`) and space grouping (`1 200`) are not parsed, and a number run together with its unit (`59Kč`) is not read.

Every expected answer scores 1.0 against its own checks, and a test asserts this for every frozen instance.

Question-specific rules and open owner questions:

- L18's set check leaves out the primary market and the market the answer should name as unaffected, so it measures recall only.
- L16 and L17 expect every other player linked to the anchor's shared devices or payment instruments in the world data, so the expected sets include baseline players and not only the planted cluster (D-030).
  This is an open owner question.
- L22's expected answer states only the authoritative price, so an answer that also quotes the stale price from the superseded document scores 0.5.
  This is an open owner question.

### Citation metrics

Answers cite context blocks as `[n]` or `[n, m]`.

- Citation accuracy is the share of cited blocks whose carrier carries one of the instance's claims.
  A citation of a block that was not shown counts as inaccurate.
  It is undefined when the answer cites nothing or the instance has no claim.
- The numeric citation rate is the share of the answer's sentences that state a number and also carry a citation.

### Failure class

A repeat is weak when its answer score or its evidence recall is below 0.5.
A weak repeat gets one class from its scores and telemetry alone:

- `entity_resolution_failure`: B or C did not resolve the anchor.
- `retrieval_failure`: evidence recall is below 0.5.
- `generation_failure`: the evidence was found and the answer is still weak.

The archived taxonomy listed ten classes.
Three are built.
A repeat whose generation call failed has no score and no class, and is left out of every metric.
Its record keeps the gateway's message.

### The judge

A judge model scores every successful repeat on five dimensions, each 0 (wrong or absent), 1 (partly) or 2 (fully): correctness, completeness, faithfulness to the shown context, citation accuracy and appropriate abstention.
The judge is a second opinion and never replaces a deterministic score (D-031).

- It sees the question, the expected answer, the claim statements, the text of each block the generator was shown, and the answer capped at 2,400 characters.
  The blocks come without titles or ids, in an order shuffled by a hash of the instance, pipeline and repeat, and renumbered from 1.
  Citation markers are rewritten to the new numbers, and any other bracket holding a digit becomes `[?]`.
- No word of the prompt names a pipeline or how the context was retrieved.
- It must be of another model family than the generator in an official run, and the run refuses to start otherwise.
- A judge failure is recorded with its reason and has no scores.
  It is never scored as zero.
- The agreement of "judge correctness is 2" with "answer score is at least 0.5" is reported as a rate and as Cohen's kappa, overall and for each pipeline.
- The prompt version is 1.0.0, and `judge_prompt_hash` covers the system prompt, its version and the user-message template.

Known limitation: a graph node without a record block reaches the judge as `<Label> <id>`, which can differ in form from the record text A retrieves for the same record.
Blinding is therefore not complete.

### Statistics

The code is `backend/app/evaluation/statistics.py`, and `report.py` is the only place a benchmark number is computed.
The API and the frontend show `summary.json` and never recompute a score.

- **The observation** is one bank instance in one world.
  Its value for a metric is the mean over its repeats where the metric is defined.
- **Pairing.** B is compared with A (Graph against text search) and C with B (Graph + Ontology against Graph).
  A pair is one instance where both pipelines have a value, and its difference is the first minus the second.
  Pairs are formed for `evidence_f1` and `answer` in every stratum except `overall`.
- **Clustering.** Instances of one logical question in one world share an anchor type and a template, so they are not independent.
  Pairs are grouped into clusters keyed `question_id:world_seed`, and the cluster is the unit for both the interval and the test (D-032).
- **Interval.** A paired bootstrap over clusters, with 10,000 resamples and a fixed seed of 2026, gives a 95 percent interval of the mean difference.
  Differences are shown in points, where one point is 0.01 on the 0 to 1 scale.
- **Test.** A two-sided Wilcoxon signed-rank test (Pratt's treatment of zero differences) on the per-cluster mean differences.
- **Correction.** Holm's step-down correction across the declared family.
  The family is evidence F1 on H1, H2 (id-anchored) and H5, and answer on H1, H2, H3 and H5, each for both comparisons, so at most 14 tests.
  `H2_name` is reported as a sub-group with an interval and no test.
- **Too few pairs.** A cell is tested only with at least 10 pairs and at least 6 clusters.
  Six is the fewest at which a two-sided signed-rank test can reach p < 0.05.
  Twelve pairs in four clusters make no claim.
- **Headlines.** The harness writes one sentence per tested cell on that stratum's main metric: evidence F1 for H1, H2 and H5, answer for H3.
  A difference is significant when its Holm-adjusted p-value is below 0.05.
  The four forms, with example numbers, are:
  - "Graph exceeds text search by 25.0 evidence points (95 percent interval 23.0 to 27.0, 36 pairs in 12 groups) on multi-hop questions."
  - the same with "trails", when significant and the whole interval is below zero;
  - "No detectable difference between Graph and text search on single facts (36 pairs in 12 groups)."
  - "Too few pairs to say for Graph and text search on planted patterns (8 pairs in 8 groups)."

The arithmetic of the design: per world the bank gives 12 H1 instances, 18 H2 (12 id-anchored and 6 name-anchored), 12 H3 and 8 H5, so three worlds give at most 36, 36, 36 and 24 pairs for the H1, H2 (id-anchored), H3 and H5 headline cells.
H3 has no evidence pairs by design.

The `ontology_split` in `summary.json` compares B with A and C with B on the ontology-dependent instances (from the per-instance flag, across every stratum) and on all others.
It is descriptive: outside the Holm family, with no p-value and no headline.

The intervals are on differences.
The Overview tiles show each approach's mean evidence score with the number of questions and runs behind it, and no interval of their own (D-048, which is an open owner question).

A smoke run keeps every statistic but its only headline says it is a scorer smoke test and not a result.

### Run kinds

| Kind | Command | What it does |
|---|---|---|
| smoke | `make run-smoke` | Scores the three worlds with the stand-in generator and judge. It tests the scoring code, and its numbers are not results. |
| official | `make run-benchmark` | Three worlds, three repeats, a hosted or local generation model, and a judge of another family |
| sweep | `make run-sweep` | The H1 questions with B and C at graph depth 0, 1, 2 and 3. Reports intervals, runs no test. |
| compare | `python -m app.evaluation compare SMALL_RUN LARGE_RUN` | H7: large minus small per pipeline, stratum and metric, as clustered intervals. Needs two official runs with the same frozen banks and the same settings except the generation model (see Kept worlds and resume). |

Every run uses graph depth 2 except the sweep.
An official run uses the dev profile on world seeds 2026, 2027 and 2028 in turn, with the scenario seed equal to the world seed.
A run with `--strata`, `--questions` or `--limit` is labelled a subset run and is never published as the official result.
`--questions` names logical questions of the bank, and an id the bank does not define is refused before any world is prepared.
The dry run is `make dry-run`: the first bank instance of each of the strata H1, H2, H3 and H5, chosen as `GET /api/v1/demo/questions` chooses them, on world 2026 with the official three repeats.
`python -m app.evaluation dry-run-questions` prints those question ids by reading the frozen bank file, so a bank change cannot leave them stale.

## Operation

```bash
make ground-bank        # freeze the bank into the active world (seed 2026)
make run-smoke          # needs the services, no model
make dry-run            # four questions on world 2026, three repeats; the official settings, so owner approval first
make run-benchmark      # needs GENERATION_PROVIDER=litellm and JUDGE_PROVIDER=litellm with models and families set
make run-sweep
```

Direct form, from `backend/`:

```bash
uv run python -m app.evaluation run --kind smoke|official [--seeds 2026,2027,2028] [--repeats N] [--strata H1,H3] [--questions L01,L05] [--limit N] [--out DIR] [--resume]
uv run python -m app.evaluation dry-run-questions
uv run python -m app.evaluation sweep [--seeds ...] [--depths 0,1,2,3] [--repeats N] [--limit N] [--out DIR]
uv run python -m app.evaluation compare SMALL_RUN_DIR LARGE_RUN_DIR [--out DIR]
uv run python -m app.evaluation bank-doc --bank FILE --out FILE
```

Before any world is prepared, the run checks its kind, its repeats and the generator and judge settings, so a wrong setting fails in seconds.
`--repeats` defaults to 1 for a smoke run and 3 otherwise, and an official run refuses fewer than 3.
A sweep or official run refuses the stand-in generator and needs a gateway judge.

### What the shared re-ranker keeps

`make diagnose-selection` measured D-025 with no answer model; its recorded numbers are for the old slot rules (D-025, D-081).
Under method v0.3 (D-083, D-084) it reports the same counts under the graph-rank interleave rule, with one token budget and no item limit.
The embedding model and the re-ranking model still run, because they are part of what it measures.
For every seed 2026 instance that has claims, it runs retrieval for A, B and C and stops where the answer model would start.
The lab is given a generator that refuses, and every candidate and selection event is emitted before a pipeline calls it.
It counts claims with the scorer's carrier notion, after the anchor is removed.
For each stratum and approach it reports the claims to find, the claims found among the graph candidates (B and C), among the document candidates, and among the records that reached the prompt.
Graph candidates are the seeds and the nodes the traversal discovered, less nodes of an excluded label, which the graph never orders.
Document candidates are A's retrieved chunks, and for B and C the chunks they selected or discarded.
C's document search uses the expanded question, as C does in a run.
It also lists every claim the graph found and no selected record states.
For each such claim it gives the discard reason, the record's tier (seed, target or other) and graph rank, and how many records reached the prompt, so a drop because the budget was full can be told from a record the graph ranked low.
Only documents carry a re-ranker score, so the diagnostic shows none for graph records.
It refuses unless the presentation world is the dev world, the vector collection exists, holds the whole corpus and was built by the bank's record serialiser, and the live graph's label counts equal that world's `_graph_stats.json`.
It builds with the official run's settings (graph depth 2) and writes them into the output.
It only reads the graph, with read-access sessions, and it writes `selection.json` and `selection.md` to `data/evaluation/diagnostics/<UTC>-selection/`.

### Kept worlds and resume

A run writes each finished world to `worlds/<seed>.json` inside its run directory.
These files stay after a successful run as part of its record.
If a run fails or is cancelled in a later world, the earlier worlds are already on disk, and nothing is published, because the API publishes only a directory that holds `summary.json`.
The failed run is continued with the same command and `--out DIR --resume`, or `make run-benchmark OUT=DIR RESUME=1`.
`--resume` needs `--out`, and it skips the worlds already kept.
The API never resumes a run; a failed job says how many worlds were kept and names this command.

Resume refuses to mix worlds made under different settings.
Before any world is prepared, it checks each kept world against this run and against the other kept worlds:

- the run kind and the selection of the bank (`--strata`, `--questions`, `--limit`);
- every setting the environment, the configuration, the code and git fix: the repeats, the generation and judge settings, the retrieval and graph limits, the ranking weights, the prompt, the scorer and ontology versions, and the code revision (`git_sha`);
- the frozen bank of that seed, which must be the one the world was scored on;
- the kept worlds among themselves.

The names of the embedding, sparse and re-ranking models need a built lab, so they are checked after the next world is prepared and before it is scored.
Only when the run started, where its world directory is and, for a smoke run, whether the checkout was dirty may differ.
An official run resumes only from a clean checkout at the same revision, now and in every kept world, because an uncommitted edit would mix two code versions without leaving a trace in the record.
Any code change therefore means a new run, not a resume.
A directory that already holds `summary.json` or `results.json` is never resumed, a directory that holds kept worlds is refused unless `--resume` is given, and `--resume` on a directory that does not exist is refused.
A kept file that cannot be read is named in the refusal, and deleting it reruns that world.

A relative `--out` is relative to the repository root, so the same command works from the root and from `backend/`.
A cancelled API job keeps its finished worlds in the same way, and its message names the resume command too.

`compare` applies the same rule to two runs.
It refuses runs whose recorded settings differ in anything except the generation model, its family and quantisation, the code revision and where the run happened, and it names every field that differs with both values.
The worlds are paired by seed, and the output says when the two runs were made at different code revisions.

Each world is brought up to date before it is scored:

| Step | When it runs |
|---|---|
| Generate the world | The world or its ledger is missing, or its manifest names another generator version or seed |
| Ingest the graph | Every time, because Neo4j holds one world at a time |
| Index the vectors | The world was just generated, the collection is empty, or the index names another serialiser version or collection |
| Ground and freeze the bank | The bank is missing, fails its hash, or names another bank version, world, ledger or serialiser |

Seeds 2027 and 2028 use the collection name plus `_seed<seed>`.
After the last world, and after a failed world, the seed 2026 graph is ingested again so the Live Lab and Data Model read the world they expect.
When that restore fails, run `make ingest-graph`.

The benchmark can also be started from the Results screen, as a job on a background thread of the API (one at a time).
It refuses to run unless the active world is the dev world with its own ledger.

Local thinking models need `GENERATION_REASONING=off` and `JUDGE_REASONING=off`.
The first local pilot ran with `default`, and both models spent their token caps on hidden reasoning, returning empty answers for 159 of 198 generations and every judge call.

## Reproducibility

A run is written to `data/evaluation/runs/<run id>/`, where the run id is the UTC start time and the kind, such as `20261019T140507Z-official`.
A run refuses a directory that already holds a run.
Files are written to a temporary name and moved into place, and `summary.json` is written last.

| File | Contents |
|---|---|
| `results.json` | The selection, the record, and for each world every instance, every repeat of every pipeline (answer, shown blocks, selected carriers, resolved ids, tokens, latency) and every score |
| `summary.json` | The published numbers: metrics per stratum, comparisons, headlines, judge agreement, failures, the selection and the record. Schema version 2. |
| `report.md` | The summary as tables |
| `sweep.json` | Per depth, the H1 metrics for B and C |
| `comparison.json` | H7, written to `data/evaluation/comparisons/` |

The API publishes `summary.json` only.
`GET /api/v1/benchmarks/latest` serves the newest official run of the whole bank, and when there is none it serves the newest run of any kind with its label.
While only a smoke run or a subset run exists, the Overview shows "No official run yet" and names the newest run's kind without numbers.

The reproducibility record of every run, stored as `run` (fields every world shares) and `worlds` (each world's full record), holds:

- **Code and bank:** `git_sha`, `git_dirty`, `question_bank_version`, `bank_version`, `bank_hash`, `scorer_version` (2.0.0), `run_kind`, `repeats`, `started_at`.
- **World:** `world_dir`, `generator_version`, `profile`, `world_seed`, `scenario_seed`, `reference_date`, `ontology_version`, `graph_label_version`.
- **Retrieval:** `embedding_model`, `embedding_dimensions`, `sparse_model`, `rrf_k`, `record_serialiser_version`, `reranker`, `top_k`, `context_budget_tokens`, `context`, `dedupe_threshold`, `graph_limits`, `relationship_types_b`, `relationship_types_c`, `ranking_weights`, `excluded_labels`.
- **Generation:** `generation_model`, `generation_model_family`, `generation_quantisation`, `generation_temperature`, `max_tokens`, `generation_reasoning`, `prompt_version`, `prompt_hash`.
- **Judge:** `judge_model`, `judge_model_family`, `judge_reasoning`, `judge_temperature`, `judge_prompt_version`, `judge_prompt_hash`.

Each repeat also records its own repeat index.
The runner writes one structured log record per repeat with the world seed, bank hash, instance, question, pipeline, repeat, latency and failure fields.
The records never carry an expected answer, the generated answer or a secret.

What is deterministic: generation of a world, grounding, retrieval, scoring and the statistics, for the same code, seeds, models and indices.
Generation and judging with a real model can vary between repeats even at temperature 0, which is why an official run takes three repeats and reports their mean.

## Configuration

| Variable | Meaning |
|---|---|
| `GENERATION_*` | The answer model (see [retrieval.md](retrieval.md)). An official run needs `GENERATION_MODEL_FAMILY`. |
| `JUDGE_PROVIDER` | `fake` or `litellm`. Smoke runs always use the fake judge. |
| `JUDGE_MODEL`, `JUDGE_MODEL_FAMILY`, `JUDGE_API_BASE`, `JUDGE_TEMPERATURE`, `JUDGE_REASONING` | The judge. Its family must differ from the generator's in an official run. |
| `BENCHMARK_DIR` | Where the API looks for runs. Default `data/evaluation/runs`. |
| `DATASET_DIR`, `TRUTH_LEDGER_PATH` | The presentation world and its ledger. The ledger is read only inside `app.evaluation`. |
| `OPENROUTER_API_KEY` | Read by LiteLLM for hosted models |

The judge reply is capped at 300 tokens, so a thinking judge needs `JUDGE_REASONING=off`.
The Python code reads no `.env` file; the Makefile exports a root `.env` to the benchmark targets.

## Testing

- `test_benchmark_bank.py`, `test_benchmark_grounding.py`, `test_claims.py`: the bank, grounding, carriers and anchor exclusion.
- `test_checks.py`, `test_benchmark_scoring.py`: answer checks, citation metrics, evidence metrics and failure classes.
- `test_judge.py`: blinding, parsing, the family rule and agreement.
- `test_statistics.py`, `test_benchmark_report.py`: bootstrap, Wilcoxon, Holm, headlines and the summary.
- `test_diagnostics.py`: the selection diagnostic, its refusals and its output.
- `test_benchmark_runner.py`, `test_official.py`: repeats, refusals, three-world orchestration, sweep and compare.
- `test_benchmark_live.py` (`LIVE_WORLD_E2E=1`): the live benchmark on the presentation world.

CI never needs a live model.
It uses the stand-in generator, the hashing embedder and the lexical judge.

## Extension points

- A new question: add it to `bank.py` with a grounder in `grounders.py`, or `planted.py` for a planted question, then re-ground every world and bump `BANK_VERSION`.
- A new metric: compute it in `report.py` beside the others, so the one place that computes numbers stays one place.
- A new hypothesis stratum needs the Holm family declared again, which changes the correction for every other cell.
- A new judge dimension changes the judge prompt version and hash.

## Failure modes

| Failure | What happens |
|---|---|
| Generation call fails | That repeat has no score, is left out of every metric and keeps the gateway's message. A run with failures says why. |
| Judge call fails | Recorded with its reason, never scored as zero. |
| Retrieval selects different carriers across repeats | The run stops with an error. |
| Frozen bank is stale or missing | The run refuses to start. The API answers 503 `CONFIGURATION_ERROR` naming `make ground-bank`. |
| Another world is in the graph | The benchmark ingests the one it needs, then restores seed 2026. A server stop during a job can leave a benchmark world in Neo4j. Run `make ingest-graph`. |
| Run cancelled or failed | No `summary.json` is written, so the run is never published, and the seed 2026 graph is ingested again. |
| `--repeats` below 3 on an official run | Refused. |

The archived benchmark specifications are [reference/05-benchmark-spec.md](reference/05-benchmark-spec.md) and the pages under [reference/evaluation/](reference/evaluation/scoring.md).
