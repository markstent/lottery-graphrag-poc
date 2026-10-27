/**
 * Chapter 7, how scoring works: the deterministic scores, the judge's place,
 * failure causes, repeats and how two approaches are compared. Sources:
 * docs/evaluation.md and backend/app/evaluation/ (checks.py, scoring.py,
 * statistics.py, report.py).
 */

import type { ChapterCopy } from '../chapters'

export const scoring: ChapterCopy = {
  plain: [
    'Every answer gets two scores from fixed rules, the same rules for all three approaches. The judge adds a second opinion (chapter 6), but the fixed rules decide the scores.',
    'The answer score says whether the answer is right. Each question has an answer key, written before any approach runs, and one or more checks taken from it: a yes or no, a name, a number, or a list of items. The answer score is the share of checks passed, from 0 to 1. A list earns part marks for the items it gets right, and a number earns half marks when the answer gives other numbers beside it.',
    'The evidence score says whether the approach found what a correct answer rests on. Each question lists its claims: the facts a correct answer states, each with the records or passages that state it. The evidence score runs from 0 to 1, where 1 is every claim covered and nothing extra. It balances two shares: how many of the claims the chosen evidence covers, and how much of the chosen evidence covers a claim.',
    'The starting record (the record the question names) is left out, because the approach was given it and finding it is no discovery. When no claim is left without it, the question’s evidence score reads Missing and the question counts for the answer score only. This was the case for every single-fact question in the official run.',
    'Each question is asked {repeats} times, because a model can answer differently from one try to the next. Each try is a repeat, and a question’s score is the average of its repeats.',
    'When an answer scores below half, or its evidence covers less than half of the claims, Results gives one failure cause: the starting record was not found, the needed evidence was not retrieved, or the evidence was retrieved but the answer was wrong.',
    'Two comparisons are made: B against A, which measures what the graph adds, and C against B, which measures what the ontology adds. Both approaches answer the same questions, so each question gives a pair of scores. Questions made from one question in one world are alike, so they form a question group and count once. A comparison reports the difference in points (one point is 0.01 on the 0 to 1 scale) and an interval: the range the difference most likely lies in. A detectable difference is one larger than chance would explain, allowing for the number of comparisons made at once. With too few pairs, Results says there are too few to say.',
  ],
  technical: [
    'The settings in this chapter, now and in the newest official run:',
    {
      kind: 'settings',
      keys: ['scorer_version', 'question_bank_version', 'repeats'],
    },
    'Answer checks (backend/app/evaluation/checks.py), written at grounding time from the expected answer. Number, token and set checks read the verdict and the answer text together.',
    [
      'verdict: 1 when the verdict opens with the expected "yes" or "no", else 0;',
      'token: 1 when the answer names the expected value or an alias as a whole word, ignoring case, with Unicode-aware boundaries, so INC_01 does not match inside INC_010;',
      'set: the F1 of the ids the answer names against the expected ids, over a fixed universe of candidates; an alias shared by more than one id identifies none, and the starting record is excluded from every universe;',
      'number: 1 when the expected number is the only distinct number read, 0.5 when other numbers appear beside it, 0 when it is missing. With a unit, only numbers next to that unit are read; 2.50 matches 2.5; a comma followed by exactly three digits is a thousands separator, any other comma a decimal point. Citation markers, identifiers and dates are not numbers, and European or space grouping (1.200,00 or 1 200) is not parsed.',
    ],
    'Every expected answer scores 1.0 against its own checks, and a test asserts it for every frozen instance. Open owner questions (HITL_STATUS.md, CP1): L16 and L17 expect every player linked to the shared devices or payment instruments, baseline players included (D-030), and L22 scores 0.5 when an answer also quotes the stale price from the superseded document.',
    "Evidence metrics (backend/app/evaluation/scoring.py). A carrier is any record or passage whose text states a claim. The selected evidence is the list of carriers in the prompt, in order, with duplicates and the starting record removed. Recall is the share of claims with at least one carrier selected; precision is the share of selected items that carry a claim, 0 for an empty selection; the evidence score is their F1; efficiency is claims found per 1,000 context tokens. The starting record is removed from every claim's carriers, a claim left with none is dropped, and with no claim left the metrics are undefined, not zero. Retrieval must select the same carriers in every repeat of an instance, and the run stops with an error if it does not.",
    'Citation metrics: citation accuracy is the share of cited blocks whose item carries a claim; a citation of a block not shown counts as inaccurate, and the metric is undefined when the answer cites nothing or the instance has no claim. The numeric citation rate is the share of sentences stating a number that also carry a citation.',
    "Failure causes (classify_failure, FAILURE_THRESHOLD = 0.5). A repeat is weak when its answer score or its evidence recall is below 0.5, and it gets the first cause that applies: entity_resolution_failure when B or C did not resolve the starting record, retrieval_failure when recall is below 0.5, else generation_failure (D-054 gives the plain words). A has no resolution stage, so it cannot fail at resolution. A repeat whose model call failed has no score and no cause, is left out of every metric and keeps the gateway's message.",
    "The judge's place: it scores every successful repeat on five dimensions from 0 to 2 (chapter 6), reported per kind of question and approach, with its agreement with the answer score. It does not replace a deterministic score (D-031), and a failed judge call has no scores rather than zeros.",
    'From answers to comparisons (backend/app/evaluation/statistics.py and report.py; D-032):',
    [
      'the observation is one bank instance in one world, its value the mean over the repeats where the metric is defined;',
      'pairs: B against A and C against B, one pair per instance where both have a value, for the evidence score and the answer score in each kind of question;',
      'question groups: instances of one logical question in one world share a template and an anchor type, so pairs are grouped by question id and world seed, and the group is the unit of both the interval and the test;',
      'interval: a paired bootstrap over groups, 10,000 resamples with the fixed seed 2026, 95 percent, reported in points;',
      "test: a two-sided Wilcoxon signed-rank test, with Pratt's treatment of zero differences, on the per-group mean differences;",
      "correction: Holm's step-down correction over the declared family, the evidence score on H1, H2 (anchored by id) and H5 and the answer score on H1, H2, H3 and H5, each for both comparisons, 14 tests in all;",
      'a difference is significant when its Holm-adjusted p-value is below 0.05; a cell is tested only with at least 10 pairs and 6 groups, the fewest at which a two-sided signed-rank test can reach p below 0.05;',
      'outside the family and untested: the name-anchored sub-group H2_name, shown with an interval, and the ontology-dependent split (D-060), which is descriptive only. H3 has no evidence pairs by design.',
    ],
    'Each tested cell gets one headline on its main metric, the evidence score for H1, H2 and H5 and the answer score for H3, in one of four forms: "Graph exceeds text search by n points" or "trails" by n points, each with its 95 percent interval and its pairs and groups; "No detectable difference"; or "Too few pairs to say". The harness writes the headlines and the screens show them unedited (D-067).',
  ],
  terms: [
    'Answer key',
    'Answer score',
    'Claim',
    'Detectable difference',
    'Evidence score',
    'Failure cause',
    'Interval',
    'Judge',
    'Kind of question',
    'Pair',
    'Point',
    'Question group',
    'Repeat',
    'Starting record',
  ],
}
