/**
 * Chapter 8, reading the results: what Overview and Results show, what a
 * difference means, the kinds of run, and what makes two runs comparable.
 * The official run's figures are typed with their date and source, because
 * they are facts about a past event; the current result is in chapter 1.
 */

import type { ChapterCopy } from '../chapters'

export const results: ChapterCopy = {
  plain: [
    "Overview shows the newest official run: for each approach, its evidence score, with the number of questions and repeats behind it, and the run's headline sentences. Results shows a run you pick in full: its verdict, the scores by kind of question, every question's scores, how long each approach took to find the evidence and write each answer, how much evidence the answer model read, the failure causes, the judge's marks, and the settings the run recorded.",
    'Only an official run over the whole question bank is a result. A quick check tests the scoring code with a fixed program in place of the answer model and the judge, and Results shows no scores for it. A subset run covers part of the questions and is labelled as such.',
    'Each headline for a kind of question says one of three things: one approach exceeds or trails another by so many points, with its interval; there is no detectable difference; or there are too few pairs to say. Two more headlines describe the questions that name a game family or mechanic by its local name: they give the difference between two approaches, with its interval where there are enough groups, and say that no test is run on that group.',
    'What a difference means: for these questions, this made-up company and this answer model, one approach got more of the needed evidence to the answer model, or answered correctly more often. It does not show that the same would hold for another company, other questions or another model (chapter 9).',
    'What "no detectable difference" means: any difference was too small for this many questions to show. It does not mean the approaches are equal. The interval shows how large a difference could still be, in either direction.',
    'The result of the first official run is in chapter 1: no detectable difference in any of the eight headline comparisons (14 tests in all). One group outside the tests does show a difference: on the 18 questions that name a game family or mechanic by its local name, B found less of the evidence than A, and C found more than B and answered correctly more often. These questions were not tested for chance, so they describe the run and prove nothing on their own.',
  ],
  technical: [
    'Kinds of run (backend/app/evaluation/__main__.py; docs/evaluation.md):',
    [
      'official (make run-benchmark): the whole bank on world seeds 2026, 2027 and 2028, at least {repeats} repeats, a gateway answer model and a judge of another family. The only kind that is a result.',
      'subset: an official run with --strata, --questions or --limit, labelled "Subset run" on Results and never published as the result (D-063). The four-question dry run (make dry-run, D-079) is one.',
      'quick check (run kind smoke, make run-smoke): every statistic with FakeAnswerGenerator and FakeJudge, fixed programs that write template text. It tests the scoring code; Results shows its headline, a warning and its record, and no tiles, charts or tables (D-063).',
      'depth sweep (make run-sweep): the H1 questions with B and C at graph depths 0 to 3, with intervals and no test. None had been run by 2026-10-27.',
      'compare (python -m app.evaluation compare SMALL_RUN LARGE_RUN, from backend/): H7, large minus small per approach, kind of question and metric, as clustered intervals. It needs two official runs.',
    ],
    'What is published: a run writes results.json, summary.json (schema version 2) and report.md to data/evaluation/runs/<run id>/, summary.json last, and the API publishes summary.json only, so a failed or cancelled run is not published. GET /api/v1/benchmarks/latest serves the newest official run of the whole bank. backend/app/evaluation/report.py is the one place a benchmark number is computed; the screens do not recompute a score.',
    'Reading the screens. The Overview tiles show each mean evidence score with no interval, because intervals are defined for paired differences only (D-048). On Results, a cell with too few pairs shows no interval, and an untested cell backed by fewer than 6 groups shows neither interval nor difference (D-061). Headlines are shown as the harness wrote them (D-067).',
    'What makes two runs comparable (D-077). compare refuses two runs whose recorded settings differ in any field except started_at, world_dir, git_dirty, git_sha and the answer model, its family and quantisation, and it names every field that differs; worlds pair by seed. A resumed run must match its kept worlds in everything but started_at and world_dir, and an official run resumes only from a clean checkout at the same commit (chapter 12). The record names the selection rule, so runs under different rules do not pair or resume together.',
    "The recorded settings. Every run stores a reproducibility record: the fields its worlds share under run, and each world's full record under worlds. They cover code and bank (git_sha, git_dirty, bank and scorer versions, run kind, repeats), the world (generator version, profile, world and scenario seeds, ontology version), retrieval (embedding, sparse and re-ranking models, top_k, the token budget, the evidence and graph slots, graph limits, relationship types, ranking weights) and the answer model and judge (model, family, temperature, output cap, reasoning, prompt version and hash). Results shows the record as the API sends it (D-068), and Help's settings tables put the newest official run's values beside the settings now.",
    'The official run v0.2.0 (2026-10-26 11:42 to 2026-10-27 03:21 UTC, commit 27a4ce4, clean tree; summary in docs/evaluation.md):',
    [
      'three worlds, 150 instances, three approaches and 3 repeats: 1,350 answers, all judged but 2: no answer failed, and 2 judge calls failed, both in B;',
      'eight tested headlines, all "No detectable difference": 36 pairs in 12 groups each for H1, H2 and H3, and 24 pairs in 24 groups for H5. Of the 14 tests in the family, the smallest unadjusted p-value was 0.125 and every Holm-adjusted p-value was 1.0;',
      'over all 150 questions the answer score was 0.44 for all three, and over the 114 that have claims the evidence score was 0.19 for A, 0.17 for B and 0.19 for C;',
      'descriptive, outside the family: on the 18 name-anchored instances (6 groups), B was 14.7 evidence points below A (interval 10.8 to 18.6 below) and C 13.4 above B (8.4 to 18.6), with an answer score 10.4 points higher (3.6 to 18.6);',
      'failure causes per 450 answers: "the needed evidence was not retrieved" 216 (A), 213 (B) and 201 (C); "the evidence was retrieved but the answer was wrong" 72, 60 and 81; "the starting record was not found" 0, 9 and 9.',
    ],
  ],
  terms: [
    'Detectable difference',
    'Depth sweep',
    'Interval',
    'Official run',
    'Pair',
    'Quick check',
    'Subset run',
  ],
}
