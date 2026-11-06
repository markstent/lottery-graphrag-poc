# Benchmark run

Method v0.3 was made after seeing the v0.2.0 result, in which the graph did not win; why, and what changed, is in Help, chapter 9 (D-093).

Run kind: official.
Selection: the whole bank.
Bank version 2.0.0, worlds 2029, 2030, 2031, 2032, 2033, 2034.
Run started: 2026-10-29T14:41:13+00:00 (when the first world started).

## Headlines

- Graph exceeds text search by 22.1 evidence points (95 percent interval 10.4 to 34.1, 72 pairs in 24 groups) on multi-hop questions.
- No detectable difference between Graph + Ontology and Graph on multi-hop questions (72 pairs in 24 groups).
- No detectable difference between Graph and text search on ontology-dependent questions anchored by id (72 pairs in 24 groups).
- No detectable difference between Graph + Ontology and Graph on ontology-dependent questions anchored by id (72 pairs in 24 groups).
- No detectable difference between Graph and text search on single facts (72 pairs in 24 groups).
- No detectable difference between Graph + Ontology and Graph on single facts (72 pairs in 24 groups).
- No detectable difference between Graph and text search on planted patterns (48 pairs in 48 groups).
- No detectable difference between Graph + Ontology and Graph on planted patterns (48 pairs in 48 groups).
- Name-anchored questions: Graph minus text search -16.7 evidence points (95 percent interval -21.1 to -12.0, 36 pairs in 12 groups); no test is run on this sub-group.
- Name-anchored questions: Graph + Ontology minus Graph 38.4 evidence points (95 percent interval 30.1 to 46.3, 36 pairs in 12 groups); no test is run on this sub-group.

## H1: multi-hop questions

Instances: 72.

| Metric | A | B | C |
|---|---|---|---|
| evidence_f1 | 0.098 (n 72) | 0.146 (n 72) | 0.137 (n 72) |
| evidence_recall | 0.426 (n 72) | 0.646 (n 72) | 0.639 (n 72) |
| evidence_precision | 0.058 (n 72) | 0.086 (n 72) | 0.079 (n 72) |
| efficiency_per_1k | 0.643 (n 72) | 0.860 (n 72) | 0.852 (n 72) |
| anchor_resolution | 0.861 (n 72, selection only) | 1.000 (n 72) | 1.000 (n 72) |
| answer | 0.478 (n 72) | 0.602 (n 72) | 0.621 (n 72) |
| citation_accuracy | 0.309 (n 72) | 0.362 (n 72) | 0.363 (n 72) |
| numeric_citation_rate | 0.841 (n 25) | 0.969 (n 25) | 0.925 (n 24) |
| latency_ms | 15665 (n 72) | 16151 (n 72) | 16688 (n 72) |
| context_tokens | 1966 (n 72) | 1986 (n 72) | 1984 (n 72) |
| judge_correctness | 0.806 (n 72) | 1.181 (n 72) | 1.236 (n 72) |
| judge_completeness | 0.750 (n 72) | 1.208 (n 72) | 1.264 (n 72) |
| judge_faithfulness | 1.833 (n 72) | 1.875 (n 72) | 1.889 (n 72) |
| judge_citation_accuracy | 1.833 (n 72) | 1.931 (n 72) | 1.875 (n 72) |
| judge_abstention | 1.069 (n 72) | 1.403 (n 72) | 1.361 (n 72) |

## H2: ontology-dependent questions anchored by id

Instances: 72.

| Metric | A | B | C |
|---|---|---|---|
| evidence_f1 | 0.126 (n 72) | 0.099 (n 72) | 0.131 (n 72) |
| evidence_recall | 0.194 (n 72) | 0.190 (n 72) | 0.380 (n 72) |
| evidence_precision | 0.104 (n 72) | 0.073 (n 72) | 0.090 (n 72) |
| efficiency_per_1k | 0.358 (n 72) | 0.370 (n 72) | 0.649 (n 72) |
| anchor_resolution | 0.917 (n 72, selection only) | 1.000 (n 72) | 1.000 (n 72) |
| answer | 0.192 (n 72) | 0.240 (n 72) | 0.451 (n 72) |
| citation_accuracy | 0.243 (n 71) | 0.245 (n 71) | 0.487 (n 72) |
| numeric_citation_rate | 0.654 (n 13) | 0.000 (n 1) | 0.000 (n 1) |
| latency_ms | 14446 (n 72) | 16211 (n 72) | 17178 (n 72) |
| context_tokens | 1976 (n 72) | 1989 (n 72) | 1989 (n 72) |
| judge_correctness | 0.347 (n 72) | 0.306 (n 72) | 0.681 (n 72) |
| judge_completeness | 0.167 (n 72) | 0.167 (n 72) | 0.583 (n 72) |
| judge_faithfulness | 1.861 (n 72) | 2.000 (n 72) | 1.931 (n 72) |
| judge_citation_accuracy | 1.819 (n 72) | 1.917 (n 72) | 1.931 (n 72) |
| judge_abstention | 0.806 (n 72) | 0.667 (n 72) | 1.056 (n 72) |

## H2_name: name-anchored questions

Instances: 36.

| Metric | A | B | C |
|---|---|---|---|
| evidence_f1 | 0.566 (n 36) | 0.440 (n 36) | 0.659 (n 36) |
| evidence_recall | 0.782 (n 36) | 0.616 (n 36) | 1.000 (n 36) |
| evidence_precision | 0.498 (n 36) | 0.403 (n 36) | 0.506 (n 36) |
| efficiency_per_1k | 1.221 (n 36) | 0.925 (n 36) | 1.593 (n 36) |
| anchor_resolution | 1.000 (n 36, selection only) | 1.000 (n 36) | 1.000 (n 36) |
| answer | 0.556 (n 36) | 0.568 (n 36) | 0.711 (n 36) |
| citation_accuracy | 0.647 (n 36) | 0.445 (n 36) | 0.550 (n 36) |
| numeric_citation_rate | - | - | - |
| latency_ms | 13585 (n 36) | 14475 (n 36) | 15576 (n 36) |
| context_tokens | 1980 (n 36) | 1983 (n 36) | 1988 (n 36) |
| judge_correctness | 0.972 (n 36) | 0.944 (n 36) | 1.056 (n 36) |
| judge_completeness | 0.500 (n 36) | 0.667 (n 36) | 0.750 (n 36) |
| judge_faithfulness | 2.000 (n 36) | 2.000 (n 36) | 2.000 (n 36) |
| judge_citation_accuracy | 2.000 (n 36) | 2.000 (n 36) | 1.972 (n 36) |
| judge_abstention | 1.944 (n 36) | 2.000 (n 36) | 1.889 (n 36) |

## H3: single facts

Instances: 72.

| Metric | A | B | C |
|---|---|---|---|
| evidence_f1 | 0.042 (n 3) | 0.042 (n 3) | 0.081 (n 3) |
| evidence_recall | 0.333 (n 3) | 0.333 (n 3) | 0.667 (n 3) |
| evidence_precision | 0.022 (n 3) | 0.022 (n 3) | 0.043 (n 3) |
| efficiency_per_1k | 0.167 (n 3) | 0.167 (n 3) | 0.334 (n 3) |
| anchor_resolution | 1.000 (n 72, selection only) | 1.000 (n 72) | 1.000 (n 72) |
| answer | 1.000 (n 72) | 0.986 (n 72) | 0.944 (n 72) |
| citation_accuracy | 0.167 (n 3) | 0.111 (n 3) | 0.222 (n 3) |
| numeric_citation_rate | 1.000 (n 26) | 1.000 (n 33) | 1.000 (n 34) |
| latency_ms | 13017 (n 72) | 15088 (n 72) | 16127 (n 72) |
| context_tokens | 1973 (n 72) | 1982 (n 72) | 1984 (n 72) |
| judge_correctness | 2.000 (n 72) | 1.972 (n 72) | 1.889 (n 72) |
| judge_completeness | 2.000 (n 72) | 1.972 (n 72) | 1.972 (n 72) |
| judge_faithfulness | 1.986 (n 72) | 1.944 (n 72) | 1.903 (n 72) |
| judge_citation_accuracy | 1.986 (n 72) | 1.944 (n 72) | 1.958 (n 72) |
| judge_abstention | 2.000 (n 72) | 1.972 (n 72) | 1.917 (n 72) |

## H5: planted patterns

Instances: 48.

| Metric | A | B | C |
|---|---|---|---|
| evidence_f1 | 0.106 (n 48) | 0.144 (n 48) | 0.138 (n 48) |
| evidence_recall | 0.485 (n 48) | 0.417 (n 48) | 0.417 (n 48) |
| evidence_precision | 0.062 (n 48) | 0.095 (n 48) | 0.090 (n 48) |
| efficiency_per_1k | 0.967 (n 48) | 0.806 (n 48) | 0.806 (n 48) |
| anchor_resolution | 0.896 (n 48, selection only) | 1.000 (n 48) | 1.000 (n 48) |
| answer | 0.708 (n 48) | 0.628 (n 48) | 0.628 (n 48) |
| citation_accuracy | 0.422 (n 48) | 0.354 (n 48) | 0.337 (n 48) |
| numeric_citation_rate | 0.917 (n 9) | 0.889 (n 9) | 1.000 (n 7) |
| latency_ms | 14475 (n 48) | 16786 (n 48) | 17115 (n 48) |
| context_tokens | 1965 (n 48) | 1987 (n 48) | 1989 (n 48) |
| judge_correctness | 1.104 (n 48) | 1.042 (n 48) | 1.000 (n 48) |
| judge_completeness | 0.312 (n 48) | 0.271 (n 48) | 0.312 (n 48) |
| judge_faithfulness | 1.979 (n 48) | 1.938 (n 48) | 1.917 (n 48) |
| judge_citation_accuracy | 2.000 (n 48) | 1.958 (n 48) | 1.938 (n 48) |
| judge_abstention | 1.458 (n 48) | 1.292 (n 48) | 1.271 (n 48) |

## overall: every question

Instances: 300.

| Metric | A | B | C |
|---|---|---|---|
| evidence_f1 | 0.181 (n 231) | 0.175 (n 231) | 0.216 (n 231) |
| evidence_recall | 0.420 (n 231) | 0.448 (n 231) | 0.569 (n 231) |
| evidence_precision | 0.141 (n 231) | 0.132 (n 231) | 0.151 (n 231) |
| efficiency_per_1k | 0.705 (n 231) | 0.697 (n 231) | 0.888 (n 231) |
| anchor_resolution | 0.930 (n 300, selection only) | 1.000 (n 300) | 1.000 (n 300) |
| answer | 0.581 (n 300) | 0.607 (n 300) | 0.670 (n 300) |
| citation_accuracy | 0.364 (n 230) | 0.334 (n 230) | 0.424 (n 231) |
| numeric_citation_rate | 0.874 (n 73) | 0.959 (n 68) | 0.958 (n 66) |
| latency_ms | 14297 (n 300) | 15811 (n 300) | 16606 (n 300) |
| context_tokens | 1972 (n 300) | 1985 (n 300) | 1986 (n 300) |
| judge_correctness | 1.050 (n 300) | 1.110 (n 300) | 1.200 (n 300) |
| judge_completeness | 0.810 (n 300) | 0.927 (n 300) | 1.057 (n 300) |
| judge_faithfulness | 1.920 (n 300) | 1.947 (n 300) | 1.920 (n 300) |
| judge_citation_accuracy | 1.913 (n 300) | 1.943 (n 300) | 1.930 (n 300) |
| judge_abstention | 1.397 (n 300) | 1.417 (n 300) | 1.470 (n 300) |

## Comparisons

Differences in points (one point is 0.01 on the 0 to 1 scale); p is Wilcoxon on group means, Holm-adjusted over the family. C_vs_A is reported for reference and never tested.

| Stratum | Metric | Comparison | Pairs | Groups | Mean | 95 percent interval | p | Holm p | Test |
|---|---|---|---|---|---|---|---|---|---|
| H1 | evidence_recall | B_vs_A | 72 | 24 | 22.1 | 10.4 to 34.1 | 0.0022 | 0.0303 | tested |
| H1 | evidence_recall | C_vs_B | 72 | 24 | -0.7 | -6.8 to 4.8 | 0.8947 | 1.0000 | tested |
| H1 | evidence_recall | C_vs_A | 72 | 24 | 21.3 | 9.0 to 34.0 | - | - | not tested: outside the family |
| H1 | answer | B_vs_A | 72 | 24 | 12.4 | 3.6 to 22.2 | 0.0134 | 0.1737 | tested |
| H1 | answer | C_vs_B | 72 | 24 | 1.9 | -6.1 to 10.5 | 0.4653 | 1.0000 | tested |
| H1 | answer | C_vs_A | 72 | 24 | 14.3 | 1.4 to 28.5 | - | - | not tested: outside the family |
| H2 | evidence_recall | B_vs_A | 72 | 24 | -0.3 | -6.8 to 6.5 | 0.7126 | 1.0000 | tested |
| H2 | evidence_recall | C_vs_B | 72 | 24 | 18.9 | 6.2 to 33.2 | 0.0385 | 0.3847 | tested |
| H2 | evidence_recall | C_vs_A | 72 | 24 | 18.6 | 4.4 to 34.1 | - | - | not tested: outside the family |
| H2 | answer | B_vs_A | 72 | 24 | 4.8 | -3.5 to 13.7 | 0.4045 | 1.0000 | tested |
| H2 | answer | C_vs_B | 72 | 24 | 21.0 | 7.3 to 36.4 | 0.0252 | 0.2770 | tested |
| H2 | answer | C_vs_A | 72 | 24 | 25.8 | 10.7 to 41.9 | - | - | not tested: outside the family |
| H2_name | evidence_recall | B_vs_A | 36 | 12 | -16.7 | -21.1 to -12.0 | - | - | not tested: outside the family |
| H2_name | evidence_recall | C_vs_B | 36 | 12 | 38.4 | 30.1 to 46.3 | - | - | not tested: outside the family |
| H2_name | evidence_recall | C_vs_A | 36 | 12 | 21.8 | 14.6 to 28.2 | - | - | not tested: outside the family |
| H2_name | answer | B_vs_A | 36 | 12 | 1.2 | -2.1 to 4.8 | - | - | not tested: outside the family |
| H2_name | answer | C_vs_B | 36 | 12 | 14.3 | 9.2 to 18.9 | - | - | not tested: outside the family |
| H2_name | answer | C_vs_A | 36 | 12 | 15.5 | 9.1 to 21.6 | - | - | not tested: outside the family |
| H3 | evidence_recall | B_vs_A | 3 | 3 | 0.0 | 0.0 to 0.0 | - | - | not tested: outside the family |
| H3 | evidence_recall | C_vs_B | 3 | 3 | 33.3 | 0.0 to 100.0 | - | - | not tested: outside the family |
| H3 | evidence_recall | C_vs_A | 3 | 3 | 33.3 | 0.0 to 100.0 | - | - | not tested: outside the family |
| H3 | answer | B_vs_A | 72 | 24 | -1.4 | -4.2 to 0.0 | 0.3173 | 1.0000 | tested |
| H3 | answer | C_vs_B | 72 | 24 | -4.2 | -8.3 to 0.0 | 0.0833 | 0.7494 | tested |
| H3 | answer | C_vs_A | 72 | 24 | -5.6 | -11.1 to -1.4 | - | - | not tested: outside the family |
| H5 | evidence_recall | B_vs_A | 48 | 48 | -6.9 | -12.1 to -2.5 | 0.0191 | 0.2295 | tested |
| H5 | evidence_recall | C_vs_B | 48 | 48 | 0.0 | -1.7 to 1.7 | 0.9828 | 1.0000 | tested |
| H5 | evidence_recall | C_vs_A | 48 | 48 | -6.9 | -12.3 to -2.1 | - | - | not tested: outside the family |
| H5 | answer | B_vs_A | 48 | 48 | -8.0 | -14.8 to -1.9 | 0.1386 | 1.0000 | tested |
| H5 | answer | C_vs_B | 48 | 48 | 0.0 | 0.0 to 0.0 | 1.0000 | 1.0000 | tested |
| H5 | answer | C_vs_A | 48 | 48 | -8.0 | -14.8 to -1.9 | - | - | not tested: outside the family |

## Ontology-dependent split

Descriptive only: outside the Holm family, so no p values and no claim. Questions are grouped by the ontology-dependent flag across every stratum. Differences in points, with the 95 percent cluster bootstrap interval.

| Group | Metric | Comparison | Pairs | Groups | Mean | 95 percent interval | Note |
|---|---|---|---|---|---|---|---|
| ontology_dependent | evidence_recall | B_vs_A | 120 | 48 | -5.5 | -10.2 to -0.6 | descriptive |
| ontology_dependent | evidence_recall | C_vs_B | 120 | 48 | 22.9 | 14.0 to 32.0 | descriptive |
| ontology_dependent | answer | B_vs_A | 120 | 48 | 3.5 | -1.4 to 9.0 | descriptive |
| ontology_dependent | answer | C_vs_B | 120 | 48 | 16.9 | 8.4 to 26.2 | descriptive |
| other | evidence_recall | B_vs_A | 111 | 63 | 11.7 | 2.7 to 20.4 | descriptive |
| other | evidence_recall | C_vs_B | 111 | 63 | 0.4 | -3.8 to 4.6 | descriptive |
| other | answer | B_vs_A | 180 | 84 | 2.1 | -2.4 to 7.0 | descriptive |
| other | answer | C_vs_B | 180 | 84 | -0.9 | -4.7 to 3.0 | descriptive |

## Groundedness (descriptive)

The share of an answer's checkable atoms (ids, dates, numbers) that the blocks it cites hold, and the share no shown block holds. Answers with no such atom are left out; no test is run.

| Stratum | Pipeline | Supported share | Unsupported share |
|---|---|---|---|
| H1 | A | 0.835 (n 59) | 0.018 (n 59) |
| H1 | B | 0.951 (n 66) | 0.000 (n 66) |
| H1 | C | 0.929 (n 68) | 0.003 (n 68) |
| H2 | A | 0.688 (n 61) | 0.158 (n 61) |
| H2 | B | 0.877 (n 70) | 0.007 (n 70) |
| H2 | C | 0.827 (n 70) | 0.022 (n 70) |
| H2_name | A | 1.000 (n 35) | 0.000 (n 35) |
| H2_name | B | 0.991 (n 36) | 0.000 (n 36) |
| H2_name | C | 0.969 (n 35) | 0.000 (n 35) |
| H3 | A | 1.000 (n 54) | 0.000 (n 54) |
| H3 | B | 1.000 (n 55) | 0.000 (n 55) |
| H3 | C | 1.000 (n 59) | 0.000 (n 59) |
| H5 | A | 0.887 (n 47) | 0.006 (n 47) |
| H5 | B | 0.901 (n 46) | 0.002 (n 46) |
| H5 | C | 0.908 (n 46) | 0.000 (n 46) |
| overall | A | 0.867 (n 256) | 0.043 (n 256) |
| overall | B | 0.939 (n 273) | 0.002 (n 273) |
| overall | C | 0.920 (n 278) | 0.006 (n 278) |

## Judge agreement

The deterministic answer score is put on the judge's three correctness levels.

- Level 0: the answer score is 0, and the judge gives correctness 0.
- Level 1: the answer score is between 0 and 1, and the judge gives correctness 1.
- Level 2: the answer score is exactly 1, and the judge gives correctness 2.

Agreement is the share of judged repeats on the same level; the weighted kappa (linear weights) discounts chance and counts a one-level gap as half a disagreement.
The weighted kappa is shown only over at least 10 judged repeats; below that the table says too few to say.
Answers that say the sources do not answer are reported apart from answers that answer.

| Pipeline | Answers | Judged repeats | Agreement | Weighted kappa |
|---|---|---|---|---|
| all | answered | 637 | 0.881 | 0.771 |
| all | abstained | 263 | 0.703 | 0.248 |
| A | answered | 209 | 0.900 | 0.828 |
| A | abstained | 91 | 0.802 | 0.385 |
| B | answered | 205 | 0.883 | 0.778 |
| B | abstained | 95 | 0.684 | 0.213 |
| C | answered | 223 | 0.861 | 0.700 |
| C | abstained | 77 | 0.610 | 0.171 |

## Failures

| Pipeline | Repeats | Generation failures | Judge failures | Failure classes |
|---|---|---|---|---|
| A | 300 | 0 | 0 | generation_failure 24, retrieval_failure 124 |
| B | 300 | 0 | 0 | generation_failure 17, retrieval_failure 119 |
| C | 300 | 0 | 0 | generation_failure 19, retrieval_failure 100 |

Questions not grounded:

- none

## Reproducibility

Shared by every world:

- git_sha: `4c62325e799848117a773e34dd7256621eb0f3d1`
- git_dirty: `False`
- question_bank_version: `2.0.0`
- generator_version: `0.2.0`
- profile: `dev`
- embedding_model: `bge-m3`
- embedding_dimensions: `1024`
- sparse_model: `Qdrant/bm25`
- rrf_k: `60`
- record_serialiser_version: `2.1.0`
- generation_model: `ollama/qwen3.6:latest`
- generation_temperature: `0.0`
- max_tokens: `4096`
- prompt_version: `3.0.0`
- reranker: `BAAI/bge-reranker-v2-m3`
- top_k: `40`
- context_budget_tokens: `2000`
- context: `{'dedupe_threshold': 0.85}`
- graph_limits: `{'depth': 2, 'nodes_per_hop': 100, 'edges_per_node_type': 4, 'total_nodes': 200, 'relationship_types': 22}`
- ranking_weights: `{'graph_distance': 0.25, 'relationship_type': 0.25, 'semantic_relevance': 0.35, 'temporal_validity': 0.15}`
- reference_date: `2026-01-01`
- excluded_labels: `['Document']`
- ontology_version: `2.0.0`
- graph_label_version: `v2`
- bank_version: `2.0.0`
- scorer_version: `2.2.1`
- prompt_hash: `ac71b7bebd16b82f96fa0988c535966973bb5abb94c819a2b9424fa790b98daa`
- relationship_types_b: `['AFFECTS', 'AFFECTS_MARKET', 'AVAILABLE_IN', 'BELONGS_TO', 'CATEGORISED_AS', 'CONCERNS', 'FROM_MARKET', 'HAS_MECHANIC', 'INSTANCE_OF', 'OF_TYPE', 'PROVIDED_BY', 'RELATED_TO', 'RELATED_TO_APP_VERSION', 'RELATED_TO_VERSION', 'RUNS_ON', 'TARGETS', 'USES', 'USES_PAYMENT', 'VERSION_OF']`
- relationship_types_c: `['AFFECTS', 'AFFECTS_MARKET', 'AVAILABLE_IN', 'BELONGS_TO', 'CATEGORISED_AS', 'CONCERNS', 'FROM_MARKET', 'HAS_MECHANIC', 'INSTANCE_OF', 'IS_A', 'MAPS_TO', 'OF_TYPE', 'PROVIDED_BY', 'RELATED_TO', 'RELATED_TO_APP_VERSION', 'RELATED_TO_VERSION', 'RUNS_ON', 'SIMILAR_TO', 'TARGETS', 'USES', 'USES_PAYMENT', 'VERSION_OF']`
- dedupe_threshold: `0.85`
- generation_quantisation: `None`
- generation_model_family: `qwen`
- repeats: `1`
- run_kind: `official`
- judge_model: `ollama/gemma4:31b`
- judge_model_family: `gemma`
- judge_prompt_version: `1.2.0`
- judge_prompt_hash: `dbc2bcd861773a3184c3018365a8d4f49ae8cdf0921e1936fece40739a394643`
- judge_temperature: `0.0`
- generation_reasoning: `off`
- judge_reasoning: `off`
- selection_rule: `graph-rank-interleave-budget`
- method_version: `0.3.0`
- record_facts_version: `1.0.0`
- prompt_extras: `{'path_line': ['B', 'C'], 'target_type_tier': ['B', 'C'], 'ontology_target_terms': ['C']}`
- answer_parser_version: `2.1.1`

### World 2029

- world_dir: `/Users/mark.stent/Dev/python/2026/lottery-graphrag-poc-v03/data/generated/dev-seed2029`
- world_seed: `2029`
- scenario_seed: `2029`
- started_at: `2026-10-29T14:41:13+00:00`
- bank_hash: `087e1cb22b5d39da5d0b39b1905a64a8cd34d1d5d4d3cd1ab6d0b05555c0c42c`

### World 2030

- world_dir: `/Users/mark.stent/Dev/python/2026/lottery-graphrag-poc-v03/data/generated/dev-seed2030`
- world_seed: `2030`
- scenario_seed: `2030`
- started_at: `2026-10-29T16:37:14+00:00`
- bank_hash: `4f6b27e055d9aa20efa5a3000c1c2fd8a46efe2256f7764d7ff6b7c20d1d4d6c`

### World 2031

- world_dir: `/Users/mark.stent/Dev/python/2026/lottery-graphrag-poc-v03/data/generated/dev-seed2031`
- world_seed: `2031`
- scenario_seed: `2031`
- started_at: `2026-10-29T18:30:47+00:00`
- bank_hash: `133752f60610850968a3bf002a414354754a3176d159de1805db1b21324a56cf`

### World 2032

- world_dir: `/Users/mark.stent/Dev/python/2026/lottery-graphrag-poc-v03/data/generated/dev-seed2032`
- world_seed: `2032`
- scenario_seed: `2032`
- started_at: `2026-10-29T20:31:49+00:00`
- bank_hash: `72e5abac5f4a472212cccac7d29732cbbb1619f5882f75d1a3cf4bd0f2cdacab`

### World 2033

- world_dir: `/Users/mark.stent/Dev/python/2026/lottery-graphrag-poc-v03/data/generated/dev-seed2033`
- world_seed: `2033`
- scenario_seed: `2033`
- started_at: `2026-10-29T22:26:16+00:00`
- bank_hash: `6fc3e91948f361a401010d04b62d5c2a628914e3b2ffd7535b4689754cff22f4`

### World 2034

- world_dir: `/Users/mark.stent/Dev/python/2026/lottery-graphrag-poc-v03/data/generated/dev-seed2034`
- world_seed: `2034`
- scenario_seed: `2034`
- started_at: `2026-10-30T00:18:31+00:00`
- bank_hash: `b504810f9d0597d64fc8afc01ab553e1d26a495b96d305945f9b514410e7f3cb`

