# Headline numbers

## Official run v0.3.0

The official run v0.3.0 ran from 2026-10-29 14:41 UTC to about 02:06 UTC on 2026-10-30 (when summary.json was written; the run record has no end time) at commit 4c62325 with a clean tree.
It covered six worlds no one had looked at (seeds 2029 to 2034), the whole bank (300 instances) and the three approaches, with each question asked once: 900 answers, each judged.
The answer model was qwen3.6 and the judge gemma4 31B, both local through Ollama with reasoning off.
The settings were scorer 2.2.1, judge prompt 1.2.0, answer parser 2.1.1, an output limit of 4,096 tokens and one evidence budget of 2,000 tokens for every approach.
No answer and no judge call failed.

Development used seed 2026 only, every rule was written down before the official run, and the run used worlds no one had looked at.

The result of the 14 tests fixed before the run (Wilcoxon on group means, Holm-adjusted, a difference counts when the adjusted p-value is below 0.05):

- one comparison shows a detectable difference: on multi-hop questions, B (graph) found 22.1 evidence-recall points more than A (text search), with a 95 percent interval of 10.4 to 34.1, 72 pairs in 24 groups and a Holm-adjusted p of 0.030;
- the other 13 show no detectable difference, and that includes every test of C (graph and ontology) against B.

Five of those 13 have a 95 percent interval that leaves out zero, but the Holm-adjusted test does not pass:

- ontology-dependent questions anchored by id, C against B: evidence recall 18.9 points higher (6.2 to 33.2, Holm-adjusted p 0.38) and answer score 21.0 points higher (7.3 to 36.4, Holm-adjusted p 0.28);
- multi-hop questions, B against A: answer score 12.4 points higher (3.6 to 22.2, Holm-adjusted p 0.17);
- planted patterns, B against A: evidence recall 6.9 points lower (2.5 to 12.1 lower, Holm-adjusted p 0.23) and answer score 8.0 points lower (1.9 to 14.8 lower, Holm-adjusted p 1.0).

Here the interval and the test disagree.
The rule written before the run is the test, so these five are not findings, and they are not hidden either.

| Over every question | A: text search | B: graph | C: graph and ontology |
|---|---|---|---|
| Evidence recall (231 instances with claims) | 0.42 | 0.45 | 0.57 |
| Answer score (300 instances) | 0.58 | 0.61 | 0.67 |

These overall means are not tested.

Outside the tested family, and so descriptive only:

- on the 36 instances that name a game in a market's own language (12 groups), B found 16.7 evidence points less than A (95 percent interval 12.0 to 21.1 less), and C found 38.4 more than B (30.1 to 46.3) and answered 14.3 points better (9.2 to 18.9);
- C against A, which is never tested: 21.3 evidence points more on multi-hop questions (9.0 to 34.0) and 18.6 more on ontology-dependent questions anchored by id (4.4 to 34.1);
- single facts are near the ceiling for every approach: answer score 1.00 for A, 0.99 for B and 0.94 for C, with C 5.6 points below A (1.4 to 11.1 below);
- groundedness, the share of the ids, dates and numbers in an answer that the evidence it cites holds, is 0.87 for A, 0.94 for B and 0.92 for C, with no test run.

What this says: under these settings the graph helped get the needed evidence to the answer model on multi-hop questions, and that is the one tested finding.
C's averages were higher than B's on the questions that need the ontology, but no test of C against B passed, so this run does not show that the ontology helps.
On planted patterns the graph's averages were lower than text search's, and that did not pass the test either.

Limits on reading it:

- the judge and the deterministic answer score agree on 88 percent of the 637 answers that answered (weighted kappa 0.77) and on 70 percent of the 263 that said "unknown" (weighted kappa 0.25);
- judge prompt 1.2.0 reads the whole answer and was not checked against hand labels; the hand-label check was made on a sample of answers, with labels from one model labeller, not a human (D-094, D-096);
- "the needed evidence was not retrieved" is still the most common failure cause: 124, 119 and 100 of 300 answers for A, B and C; "the evidence was retrieved but the answer was wrong" is 24, 17 and 19;
- each comparison rests on 24 question groups (48 for planted patterns), so a difference must be large to pass the test;
- one small local answer model, and each question asked once (D-097); a larger model might use the evidence differently.

The run is kept in `data/evaluation/runs/official-2026-10-29/` (not in git) and is the run the Overview and Results screens open on.
The owner approved it on 2026-10-30 (CP4, see [`HITL_STATUS.md`](../HITL_STATUS.md)).

An earlier official run under method 0.2.0 found no detectable difference; the screens show only runs of the current method (D-104), and the earlier run's record is in [docs/evaluation.md](evaluation.md).
The rules of the method are in [docs/retrieval.md](retrieval.md) and [docs/evaluation.md](evaluation.md).
