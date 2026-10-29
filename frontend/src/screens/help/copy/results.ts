/**
 * Chapter 8, reading the results: what Overview and Results show, what a
 * difference means, the kinds of run, and what makes two runs comparable.
 * The official run's figures are typed with their date and source, because
 * they are facts about a past event; the current result is in chapter 1.
 */

import type { ChapterCopy } from '../chapters'

export const results: ChapterCopy = {
  plain: [
    'Every run is labelled with the method it was made under: "Method v0.3", or "Method v0.2 (old method)" for a run such as the official run v0.2.0. A run of method v0.3 also carries a note, written by the run itself, that the method was changed after the v0.2.0 result was seen.',
    'Overview shows the newest official run: for each approach, its evidence measure over the questions that have claims, with the number of those questions and the repeats behind it, and the run\'s headline sentences. The measure reads "Evidence recall, questions with claims" for a run of method v0.3 and "Evidence score, questions with claims" for v0.2.0. Results shows a run you pick in full: its verdict, the scores by kind of question, every question\'s scores, how long each approach took to find the evidence and write each answer, how much evidence the answer model read, the failure causes, the judge\'s marks, and the settings the run recorded.',
    'Only an official run over the whole question bank is a result. A development run asks the models about world 2026 while the method is being built, and it is not a result. A quick check tests the scoring code with fixed programs in place of the answer model and the judge, and Results shows no scores for it. A subset run covers part of the questions and is labelled as such. Runs of the two methods are not compared with each other.',
    'Each headline for a kind of question says one of three things: one approach exceeds or trails another by so many points, with its interval; there is no detectable difference; or there are too few pairs to say. Two more headlines describe the questions that name a game family or mechanic by its local name: they give the difference between two approaches, with its interval where there are enough groups, and say that no test is run on that group.',
    'What a difference means: for these questions, this made-up company and this answer model, one approach got more of the needed evidence to the answer model, or answered correctly more often. It does not show that the same would hold for another company, other questions or another model (chapter 9).',
    'What "no detectable difference" means: any difference was too small for this many questions to show. It does not mean the approaches are equal. The interval shows how large a difference could still be, in either direction.',
    'The result of the first official run, v0.2.0, under the old method, is in chapter 1: no detectable difference in any of the eight headline comparisons (14 tests in all). One group outside the tests does show a difference: on the 18 questions that name a game family or mechanic by its local name, B found less of the evidence than A, and C found more than B and answered correctly more often. These questions were not tested for chance, so they describe the run and prove nothing on their own.',
  ],
  technical: [
    'Kinds of run (backend/app/evaluation/__main__.py; docs/evaluation.md):',
    [
      'official (make run-benchmark): for method v0.3, the whole bank on the six unseen world seeds 2029 to 2034 (OFFICIAL_SEEDS), each question asked once unless --repeats N asks more (D-097), a gateway answer model and a judge of another family, started from the command line after the owner agrees and only from a clean checkout; the API never starts one (D-091). The only kind that is a result. The official run v0.2.0 used seeds 2026, 2027 and 2028, which are now seen.',
      'dev (make dev-run, or "Development run" on Results): method development on seed 2026 only, with the real models; its one headline says it is not a result, Results labels it "Development run, not a result" on every panel and never opens it first (D-091).',
      'subset: an official run with --strata, --questions or --limit, on seen worlds only, labelled "Subset run" on Results and never published as the result (D-063). The four-question dry run (make dry-run, D-079) is one.',
      'quick check (run kind smoke, make run-smoke, on the seen worlds): every statistic with FakeAnswerGenerator and FakeJudge, fixed programs that write template text. It tests the scoring code; Results shows its headline, a warning and its record, and no tiles, charts or tables (D-063).',
      'depth sweep (make run-sweep): the H1 questions with B and C at graph depths 0 to 3, on the seen worlds, with intervals and no test. None had been run by 2026-10-28.',
      "compare (python -m app.evaluation compare SMALL_RUN LARGE_RUN, from backend/): H7, large minus small per approach, kind of question and metric, as clustered intervals, on the evidence metric of the runs' method (F1 for 0.2.0, recall for 0.3.0). It needs two official runs of the same method.",
    ],
    'What is published: a run writes results.json, summary.json (schema version 3 for method v0.3, 2 for v0.2.0; the API publishes both) and report.md to data/evaluation/runs/<run id>/, summary.json last, and the API publishes summary.json only, so a failed or cancelled run is not published. GET /api/v1/benchmarks/latest serves the newest official run of the whole bank. backend/app/evaluation/report.py is the one place a benchmark number is computed; the screens do not recompute a score.',
    "Reading the screens. Every run is read by its recorded method_version (a record without one is 0.2.0, D-092); Overview and Results show it as a badge in words, beside the run's method_note when it has one (every v0.3 summary and report carries the same declaration, D-093). The Overview tiles show each mean of the method's evidence metric with its n from the summary and no interval, because intervals are defined for paired differences only (D-048). On Results, a cell with too few pairs shows no interval, and an untested cell backed by fewer than 6 groups shows neither interval nor difference (D-061). Headlines are shown as the harness wrote them (D-067).",
    'What makes two runs comparable (D-077, D-092). compare and --resume refuse two runs of different methods first, naming both. compare also refuses two runs whose recorded settings differ in any field except started_at, world_dir, git_dirty, git_sha and the answer model, its family and quantisation, and it names every field that differs; worlds pair by seed. A resumed run must match its kept worlds in everything but started_at and world_dir, and an official run resumes only from a clean checkout at the same commit (chapter 12). The record names the selection rule, so runs under different rules do not pair or resume together.',
    "The recorded settings. Every run stores a reproducibility record: the fields its worlds share under run, and each world's full record under worlds. They cover code and bank (git_sha, git_dirty, bank and scorer versions, run kind, repeats), the world (generator version, profile, world and scenario seeds, ontology version), retrieval (embedding, sparse and re-ranking models, top_k, the token budget, graph limits, relationship types, ranking weights; in v0.3 also method_version, record_facts_version and prompt_extras, and in v0.2.0 the evidence and graph slots) and the answer model and judge (model, family, temperature, output cap, reasoning, prompt version and hash). Results shows the record as the API sends it (D-068), and Help's settings tables put the newest official run's values beside the settings now.",
    "The official run v0.2.0, method 0.2.0 (2026-10-26 11:42 to 2026-10-27 03:21 UTC, commit 27a4ce4, clean tree; summary in docs/evaluation.md). It stands as published; labelled addenda beside it (D-090) rescore its stored answers and run no test: the first, written on 2026-10-27 with scorer 2.1.0, moves only the H3 answer scores (A 0.722 to 0.944, B 0.667 to 0.917, C 0.611 to 0.861), and the second, written on 2026-10-28 with scorer 2.2.0 (D-095), moves only C's H3 answer score, to 0.889 (A 0.944 and B 0.917 unchanged):",
    [
      'three worlds, 150 instances, three approaches and 3 repeats: 1,350 answers with no failed answer; 2 judge calls failed, both in B, and the other 1,348 answers were judged;',
      'eight tested headlines, all "No detectable difference": 36 pairs in 12 groups each for H1, H2 and H3, and 24 pairs in 24 groups for H5. Of the 14 tests in the family, the smallest unadjusted p-value was 0.125 and every Holm-adjusted p-value was 1.0;',
      'over all 150 questions the answer score was 0.44 for all three, and over the 114 that have claims the evidence score was 0.19 for A, 0.17 for B and 0.19 for C;',
      'descriptive, outside the family: on the 18 name-anchored instances (6 groups), B was 14.7 evidence points below A (interval 10.8 to 18.6 below) and C 13.4 above B (8.4 to 18.6), with an answer score 10.4 points higher (3.6 to 18.6);',
      'failure causes per 450 answers: "the needed evidence was not retrieved" 216 (A), 213 (B) and 201 (C); "the evidence was retrieved but the answer was wrong" 72, 60 and 81; "the starting record was not found" 0, 9 and 9.',
    ],
  ],
  terms: [
    'Detectable difference',
    'Depth sweep',
    'Development run',
    'Interval',
    'Official run',
    'Pair',
    'Quick check',
    'Subset run',
  ],
}
