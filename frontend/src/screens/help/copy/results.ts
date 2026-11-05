/**
 * Chapter 8, reading the results: what Overview and Results show, what a
 * difference means, the kinds of run, and what makes two runs comparable.
 * The official run's figures are typed with their date and source, because
 * they are facts about a past event; the current result is in chapter 1.
 */

import type { ChapterCopy } from '../chapters'

export const results: ChapterCopy = {
  plain: [
    'Overview shows the newest official run in plain words. For each approach it gives the share of the needed evidence it found ("Evidence found") and its answer score. Then it says which tested differences were clear, how many others leaned one way without passing the test, and any differences outside the tests.',
    "Results shows a run you pick in full: its verdict, the scores by kind of question and every question's scores. It also shows how long each approach took to find the evidence and write each answer, how much evidence the answer model read, the failure causes, the judge's marks and the settings the run recorded.",
    "When a second judge has marked the run, Results also shows the judges' verdict: each approach's judges' mark, its own tests, how often the two judges gave the same verdict, and every answer on which the judges disagree, with both verdicts in words. Overview then adds the judges' mark to each approach, and states any of its tests that passed apart from the others.",
    'There are several kinds of run. Only an official run over the whole question bank is a result. A development run asks the models about world 2026, one copy of the made-up company, while the method is being built. It is not a result. A quick check tests the scoring code with fixed programs in place of the answer model and the judge, and Results shows no scores for it. A subset run covers part of the questions and is labelled as such.',
    'Each kind of question gets a headline for each tested comparison. It says one of three things. One approach exceeds or trails another by so many points, with its interval, the margin of error. Or there is no detectable difference. Or there are too few pairs to say.',
    'Two more headlines describe the questions that name a game family or mechanic by its local name. They give the difference between two approaches, with its interval where there are enough groups. They also say that no test is run on that group.',
    'What a difference means: for these questions, this made-up company and this answer model, one approach got more of the needed evidence to the answer model, or answered correctly more often. It does not show that the same would hold for another company, other questions or another model (chapter 9).',
    'What "no detectable difference" means: any difference was too small for this many questions to show. It does not mean the approaches are equal. The interval shows how large a difference could still be, in either direction.',
    'The result is the official run that started on 2026-10-29 (chapter 1). Of its 14 tests, one found a difference: on multi-hop questions the graph (B) got more of the needed evidence to the answer model than text search (A). Multi-hop questions are those that need links followed across several records. The other 13 found no detectable difference.',
    'When the interval and the test disagree. In five of those 13 comparisons the interval leaves out zero, yet the test does not pass. The interval looks at one comparison alone, through its average. The test ranks the differences of the question groups, and it allows for 14 comparisons made at once, so it asks for more. For one of the five, planted-story answers, the test fails even before that allowance. The rule written before the run is the test, so these five are not findings.',
    'The five are: the ontology against the graph on questions that need the ontology (more evidence and better answers for C); the graph against text search on multi-hop answers (better for B); and the graph against text search on planted stories (less evidence and worse answers for B). Overview and Results count such comparisons in one line under the headlines, which points to the difference for each question group.',
    'One group outside the tests also differs. It is the 36 questions that name a game family or mechanic by its local name. On them, B found less of the evidence than A. C found more than B, and answered correctly more often. These questions were not tested for chance, so they describe the run and prove nothing on their own.',
  ],
  technical: [
    'Kinds of run (backend/app/evaluation/__main__.py; docs/evaluation.md):',
    [
      'official (make run-benchmark): the whole bank on the six unseen world seeds 2029 to 2034 (OFFICIAL_SEEDS), each question asked once unless --repeats N asks more (D-097), a gateway answer model and a judge of another family, started from the command line after the owner agrees and only from a clean checkout; the API never starts one (D-091). The only kind that is a result.',
      'dev (make dev-run, or "Development run" on Results): method development on seed 2026 only, with the real models; its one headline says it is not a result, Results labels it "Development run, not a result" on every panel and never opens it first (D-091).',
      'subset: an official run with --strata, --questions or --limit, on seen worlds only, labelled "Subset run" on Results and never published as the result (D-063). The four-question dry run (make dry-run, D-079) is one.',
      'quick check (run kind smoke, make run-smoke, on the seen worlds): every statistic with FakeAnswerGenerator and FakeJudge, fixed programs that write template text. It tests the scoring code; Results shows its headline, a warning and its record, and no tiles, charts or tables (D-063).',
      'depth sweep (make run-sweep): the H1 questions with B and C at graph depths 0 to 3, on the seen worlds, with intervals and no test. None had been run by 2026-10-28.',
      'compare (python -m app.evaluation compare SMALL_RUN LARGE_RUN, from backend/): H7, large minus small per approach, kind of question and metric, as clustered intervals, on evidence recall and the answer score. It needs two official runs with the same recorded settings (below).',
    ],
    'What is published: a run writes results.json, summary.json (schema version 3) and report.md to data/evaluation/runs/<run id>/, summary.json last, and the API publishes summary.json only, so a failed or cancelled run is not published. The API publishes a run only when its recorded method_version is the method the code runs now (D-104). GET /api/v1/benchmarks/latest serves the newest official run of the whole bank. backend/app/evaluation/report.py is the one place a benchmark number is computed; the screens do not recompute a score.',
    { kind: 'heading', text: 'Reading the screens' },
    'The Overview tiles show each mean of evidence recall with its n from the summary and no interval, because intervals are defined for paired differences only (D-048). On Results, a cell with too few pairs shows no interval, and an untested cell backed by fewer than 6 groups shows its mean difference with no interval, and no difference over the bars (D-061). Headlines are shown as the harness wrote them (D-067).',
    'What makes two runs comparable (D-077, D-092). compare and --resume first refuse two runs whose method_version differs, naming both. compare also refuses two runs whose recorded settings differ in any field except started_at, world_dir, git_dirty, git_sha and the answer model, its family and quantisation, and it names every field that differs; worlds pair by seed. A resumed run must match its kept worlds in everything but started_at and world_dir, and an official run resumes only from a clean checkout at the same commit (chapter 11). The record names the selection rule, so runs under different rules do not pair or resume together.',
    { kind: 'heading', text: 'The recorded settings' },
    "Every run stores a reproducibility record: the fields its worlds share under run, and each world's full record under worlds. They cover code and bank (git_sha, git_dirty, bank and scorer versions, run kind, repeats), the world (generator version, profile, world and scenario seeds, ontology version), retrieval (embedding, sparse and re-ranking models, top_k, the token budget, graph limits, relationship types, ranking weights; method_version, selection_rule, record_facts_version and prompt_extras) and the answer model and judge (model, family, temperature, output cap, reasoning, prompt version and hash). Results shows the record as the API sends it (D-068), and Help's settings tables put the newest official run's values beside the settings now.",
    "The judges' mark (D-105). GET /api/v1/benchmarks/<run id>/second-judge returns the second judge's summary and, as combined, the run's combined.json (schema 1): definitions and versions, counts (answers, both judged, same level, missing by reason, disagreements), per kind and approach the mean mark, the judges' family of comparisons in the summary's cell shape, its headlines, the agreement between the judges, and the list of answers the judges disagree on. combined is null when it has not been written for the pass the summary describes. Results draws it with the same interval plot and rows as the paired differences; Overview reads the overall means, the per-kind means and the family's tested cells.",
    'The official run (official-2026-10-29, started 2026-10-29 14:41 UTC, commit 4c62325, clean tree; scorer 2.2.1, judge prompt 1.2.0, answer parser 2.1.1, max_tokens 4096; report.md and summary.json in the run directory, summary in docs/evaluation.md):',
    [
      'six unseen worlds (2029 to 2034), 300 instances, three approaches and 1 repeat: 900 answers, with no failed answer and no failed judge call;',
      'of the 14 tests in the family, one detectable difference: H1 evidence recall, B against A, 22.1 points (95 percent interval 10.4 to 34.1, 72 pairs in 24 groups, p 0.0022, Holm-adjusted p 0.030). The other seven headlines read "No detectable difference": 72 pairs in 24 groups for H1, H2 and H3, and 48 pairs in 48 groups for H5;',
      'tested, interval excluding zero, Holm-adjusted p of 0.17 or more, so not a finding: H2 C against B, evidence recall 18.9 (6.2 to 33.2, Holm 0.38) and answer 21.0 (7.3 to 36.4, Holm 0.28); H1 B against A, answer 12.4 (3.6 to 22.2, Holm 0.17); H5 B against A, evidence recall -6.9 (-12.1 to -2.5, Holm 0.23) and answer -8.0 (-14.8 to -1.9, Holm 1.0);',
      'over all 300 questions the answer score was 0.58 for A, 0.61 for B and 0.67 for C, and over the 231 that have claims evidence recall was 0.42, 0.45 and 0.57 (not tested); H3 answer scores 1.00, 0.99 and 0.94;',
      'descriptive, outside the family: on the 36 name-anchored instances (12 groups), B was 16.7 evidence points below A (interval 12.0 to 21.1 below) and C 38.4 above B (30.1 to 46.3), with an answer score 14.3 points higher (9.2 to 18.9); C against A, never tested, 21.3 evidence points above on H1 (9.0 to 34.0) and 18.6 on H2 (4.4 to 34.1);',
      'failure causes per 300 answers: "the needed evidence was not retrieved" 124 (A), 119 (B) and 100 (C); "the evidence was retrieved but the answer was wrong" 24, 17 and 19; none classed "the starting record was not found";',
      'judge agreement on three levels: answered 88 percent of 637, weighted kappa 0.77; abstained 70 percent of 263, weighted kappa 0.25 (chapter 6).',
    ],
  ],
  terms: [
    'Depth sweep',
    'Detectable difference',
    'Development run',
    'Interval',
    "Judges' mark",
    'Judges disagree',
    'Kind of question',
    'Method',
    'Official run',
    'Pair',
    'Quick check',
    'Subset run',
    'Test',
    'World',
  ],
}
