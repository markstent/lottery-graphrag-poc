# Statistics (benchmark v2, as built)

This page explains how the per-repeat scores of [scoring.md](scoring.md) become the numbers and sentences of a run's `summary.json` and `report.md`.
The code is `backend/app/evaluation/statistics.py` (the tests and the headline sentences) and `backend/app/evaluation/report.py` (`summarize`, the only place a benchmark number is computed).
The frontend and the API never recompute a score; they show `summary.json`.

## The observation

The unit of observation is one bank instance in one world: one logical question grounded to one anchor.
For each metric and pipeline, the instance's value is the mean over its repeats where the metric is defined.
A repeat whose generation failed has no score and is left out; so is a repeat where the metric is undefined, such as evidence metrics when no claim survived anchor exclusion.
The summary keeps, beside each mean, the number of instances (`n`) and of scored repeats (`repeats`).

## Strata

Results are reported per stratum and overall:

- `H1`: multi-hop questions.
- `H2`: ontology-dependent questions anchored by id (the headline H2 cell).
- `H2_name`: ontology-dependent questions anchored by a local-language name; reported as a sub-group, never tested.
- `H3`: single facts.
- `H5`: planted patterns.
- `overall`: every question.

## Pairing

Two comparisons are made: B against A ("Graph" against "text search") and C against B ("Graph + Ontology" against "Graph").
A pair is one instance where both compared pipelines have a value for the metric; its difference is the first pipeline's value minus the second's.
Pairs are formed for two metrics, `evidence_f1` and `answer`, in every stratum except `overall`.

## Clustering

Instances of the same logical question in the same world share an anchor type and a template, so they are not independent.
Pairs are therefore grouped into clusters, one per logical question and world, with the key `question_id:world_seed` (for example `L05:2027`).
Both the interval and the test treat the cluster, not the instance, as the independent unit.
Reports call a cluster a "group".

## Bootstrap interval

The 95 percent interval of a mean difference comes from a clustered paired bootstrap:

1. draw as many clusters as there are, with replacement;
2. pool the differences of the drawn clusters and take their mean;
3. repeat 10,000 times with a fixed random seed (2026), so the interval is reproducible;
4. the interval runs from the 2.5th to the 97.5th percentile of those means.

The reported mean is the mean of all pair differences.
Differences are shown in points, where one point is 0.01 on the 0 to 1 scale.

## Wilcoxon test

The p-value is a two-sided Wilcoxon signed-rank test (Pratt's treatment of zero differences, from scipy) on the per-cluster mean differences: the pairs of each cluster are averaged first, and the test runs on one number per cluster.
When every cluster mean is zero the p-value is 1.

## Holm family

A test runs only for cells in the declared hypothesis family:

| Stratum    | evidence_f1 | answer |
| ---------- | ----------- | ------ |
| H1         | yes         | yes    |
| H2 (by id) | yes         | yes    |
| H3         | no          | yes    |
| H5         | yes         | yes    |
| H2_name    | no          | no     |

Each family cell is tested for both comparisons, so the family holds at most 14 tests.
Holm's step-down correction adjusts the p-values of the cells actually tested, across the whole family at once.
Every comparison cell carries a `reason`: `tested`, `too_few` (in the family but below the minimum below), or `not_in_family`.
Cells that are not tested still report their interval.

## Too few pairs

A cell is tested only when it has at least 10 pairs (`MIN_PAIRS_FOR_CLAIM`) and at least 6 clusters (`MIN_CLUSTERS_FOR_CLAIM`).
Six is the smallest number of clusters at which a two-sided signed-rank test can reach p < 0.05; with fewer, no result could ever be significant.
Six groups are only the floor for a raw p < 0.05: Holm over up to 14 tests needs a smaller raw p for the smallest-ranked test, and with tied or zero cluster means scipy uses the normal approximation instead of the exact distribution.
Twelve pairs in four groups therefore make no claim.

## Headlines

The harness writes one sentence per comparison for each tested stratum, on that stratum's headline metric: `evidence_f1` for H1, H2 and H5, `answer` for H3.
A difference is significant when its Holm-adjusted p-value is below 0.05.
The sentence takes one of four forms (the numbers here are examples):

- "Graph exceeds text search by 25.0 evidence points (95 percent interval 23.0 to 27.0, 36 pairs in 12 groups) on multi-hop questions.", when significant and the whole interval is above zero;
- "... trails ...", when significant and the whole interval is below zero;
- "No detectable difference between Graph and text search on single facts (36 pairs in 12 groups).", otherwise;
- "Too few pairs to say for Graph and text search on planted patterns (8 pairs in 8 groups).", when the cell is below either minimum.

Two more lines describe the name-anchored sub-group, with its interval and the words "no test is run on this sub-group".
Below six groups the sub-group line prints the mean alone, with "too few groups for an interval (N pairs in K groups)", because a bootstrap over so few groups says little.

A smoke run keeps every statistic in `summary.json`, but its only headline says it is a scorer smoke test and not a result, and the comparisons table of its `report.md` marks tested cells "tested (smoke run, not a result)".

## Ontology-dependent split

`summary.json` carries an `ontology_split` list: B versus A and C versus B, on `evidence_f1` and `answer`, for the ontology-dependent questions and for all the others.
That is eight cells, each with `group`, `metric`, `comparison`, `n`, `clusters`, `mean`, `low` and `high`.
The split exists because the spec asks how B and C compare on the questions that need the ontology and on the rest.
Membership comes from the per-instance `ontology_dependent` flag, across every stratum, never from the stratum.
The split therefore differs from H2: it pools the id-anchored H2 cell, the name-anchored H2_name sub-group and any ontology-dependent instance of another stratum (in the pilot, two H5 instances).
The interval is the same cluster bootstrap as for a stratum, computed whenever there is at least one pair.
The split is descriptive.
It is outside the Holm family, so `p` and `p_holm` are always null and `in_family` is false, and it never appears in a headline.
`reason` is `too_few` when the cell is below the pairs or groups minimum and `not_in_family` otherwise.
`report.md` prints the same cells in an "Ontology-dependent split" table after the comparisons.
`summary.json` stays at schema version 2, because the key is additive and readers treat it as optional.

## Agreement of the judge

The judge is compared with the deterministic answer score as described in [scoring.md](scoring.md): agreement rate and Cohen's kappa, overall and per pipeline.
Kappa is undefined when both raters are constant and equal.

## Depth sweep and model comparison

The depth sweep (H1) and the model comparison (H7) report intervals or means only and never run a test; see [reproducibility.md](reproducibility.md) for what they write.
