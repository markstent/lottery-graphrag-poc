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
    'The answer score says whether the answer is right. Each question has an answer key, the correct answer written down before any approach runs. From the key come one or more checks: a yes or no, a name, a number, a date or a list of items. The answer score is the share of checks passed, from 0 to 1. A list earns part marks for the items it gets right. A number earns half marks when the answer gives other numbers beside it. A date in the key also matches the same date written with a time.',
    'The evidence measures say whether the approach found what a correct answer rests on. Each question lists its claims: the facts a correct answer states, each with the records or passages that state it. Evidence recall is the share of the claims that the chosen evidence covers, from 0 to 1. Put simply, it is the share of the needed facts found. This is the evidence measure the method tests.',
    'Precision, the share of the chosen evidence that covers a claim, is shown too but not tested. There is one budget and no limit on the number of pieces, so that share depends on how many pieces fit.',
    'Groundedness is a third measure, shown and not tested. It checks the codes, dates and numbers an answer states. It gives two shares. The first is the share the cited pieces back up. The second is the share that no piece shown to the model contains. It needs no model, and it is computed the same way for all three approaches.',
    'The starting record (the record the question names) is left out of the evidence measures. The approach was given it, so finding it is no discovery. When no claim is left without it, the question’s evidence measures read Missing, and the question counts for the answer score only. This is the case for almost every single-fact question. In the official run, 3 of the 72 single-fact questions still had one needed fact, stated in a document, so they have evidence recall too.',
    'An official run asks each question once by default. A run can be told to ask each question more than once. Each try is then a repeat, and a question’s score is the average of its repeats.',
    'When an answer scores below half, or its evidence covers less than half of the claims, Results gives one failure cause: the starting record was not found, the needed evidence was not retrieved, or the evidence was retrieved but the answer was wrong.',
    'Two comparisons are tested: B against A, which measures what the graph adds, and C against B, which measures what the ontology adds. C against A is also shown, but not tested. Both approaches answer the same questions, so each question gives a pair of scores.',
    'One question is asked in up to three versions in each world, each about a different record. The versions of one question in one world are alike, so together they form a question group, and each group counts once. A world is one copy of the made-up company.',
    'A comparison reports the difference in points. One point is 0.01 on the 0 to 1 scale. It also reports an interval, a margin of error: the range the difference most likely lies in. Then each comparison gets a test, a statistical check against chance. A detectable difference needs two things. It passes the test: it is larger than chance would explain, after allowing for the number of comparisons made at once. And its margin of error leaves out zero, so the difference points one way only. With too few pairs, Results says there are too few to say.',
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
      'number: 1 when the expected number is the only distinct number read, 0.5 when other numbers appear beside it, 0 when it is missing. With a unit, only the numbers next to that unit are read when there are any, else every number is read; 2.50 matches 2.5; a comma followed by exactly three digits is a thousands separator, any other comma a decimal point. Citation markers, identifiers and dates are not numbers, and European or space grouping (1.200,00 or 1 200) is not parsed.',
    ],
    'Every expected answer scores 1.0 against its own checks, and a test asserts it for every frozen instance. Open owner questions (HITL_STATUS.md, CP1): L16 and L17 expect every player linked to the shared devices or payment instruments, baseline players included (D-030), and L22 scores 0.5 when an answer also quotes the stale price from the superseded document.',
    "Answer checks follow scorer {scorer_version}. Three rules need a word. An ISO date in an answer key (YYYY-MM-DD) also matches the same date followed by a time (T and hh:mm, with or without :ss), with the same start and end boundaries, so 2025-10-071 does not match (D-086); it applies to token checks and to ISO-date aliases in set checks, and to nothing else. Where the answer is a version (D-095), it may state the version label instead of the id when it also names what the version belongs to: for a platform version (L02, L07) the platform by name or id, such as 2024.3.0 with Payments Gateway, and for an app release (L15) the market by its English or local name or id, such as 5.3.1 with Greece; a bare label scores 0, because every platform and every market has a version of each label. The label does not count when the answer also names a rival, another platform or market with a version of that label (2024.3.0 of the Payments Gateway is not the Web Portal's version); this is conservative by controller ruling, so a correct answer that names any other platform beside the label (or, for L15, any other market) also scores 0, as in Web Portal 2024.3.0, the Payments Gateway was not involved; and a label inside a longer dotted number (5.3.1 in 1.5.3.1) is not the label. Only L02 was labelled; L07 and L15 follow by the controller's ruling, and for L15 the incident fixes the market, so the label in effect counts on its own unless another market is named. The grounder writes the accepted label, owner names and rivals into the check from the world data, so a frozen bank records the scorer it was grounded for.",
    "Evidence metrics (backend/app/evaluation/scoring.py). A carrier is any record or passage whose text states a claim. The selected evidence is the list of carriers in the prompt, in order, with duplicates and the starting record removed. Recall is the share of claims with at least one carrier selected, and it is the evidence metric of the tested family (D-087); precision is the share of selected items that carry a claim, 0 for an empty selection; the F1 of the two and precision are descriptive, because precision depends on how many items fit the budget; efficiency is claims found per 1,000 context tokens. The starting record is removed from every claim's carriers, a claim left with none is dropped, and with no claim left the metrics are undefined, not zero. Retrieval must select the same carriers in every repeat of an instance, and the run stops with an error if it does not.",
    "Groundedness (backend/app/evaluation/checks.py, D-088), descriptive and outside the family. A checkable atom is an identifier (case-sensitive), a number as the scorer reads numbers, or a date (ISO, with or without a time, or a textual date normalised to YYYY-MM-DD), outside citation markers and outside the question's own text. Per sentence, an atom is supported when a block the sentence cites holds it, unsupported when no block the model was shown holds it, and neither when it sits only in a shown block the sentence does not cite. The supported and unsupported shares are over all atoms; an answer with no atom has no shares. Declared limits: an atom stated in two sentences counts twice; atoms in the verdict are not counted; a plain-word claim is invisible to it; ids in record headings and path lines count as shown support. It reads the full rendered block.",
    'Citation metrics: citation accuracy is the share of cited blocks whose item carries a claim; a citation of a block that was not shown is dropped when the answer is read, and the metric is undefined when the answer cites no shown block or the instance has no claim. The numeric citation rate is the share of sentences stating a number that also carry a citation.',
    "Failure causes (classify_failure, FAILURE_THRESHOLD = 0.5). A repeat is weak when its answer score or its evidence recall is below 0.5, and it gets the first cause that applies: entity_resolution_failure when B or C did not resolve the starting record, retrieval_failure when recall is below 0.5, else generation_failure (D-054 gives the plain words). A has no resolution stage, so it cannot fail at resolution. A repeat whose model call failed has no score and no cause, is left out of every metric and keeps the gateway's message.",
    "The judge's place: it scores every successful repeat on five dimensions from 0 to 2 (chapter 6), reported per kind of question and approach, with its agreement with the answer score. It does not replace a deterministic score (D-031), and a failed judge call has no scores rather than zeros.",
    'From answers to comparisons (backend/app/evaluation/statistics.py and report.py; D-032):',
    [
      'the observation is one bank instance in one world, its value the mean over the repeats where the metric is defined;',
      'pairs: B against A and C against B, one pair per instance where both have a value, for evidence recall and the answer score in each kind of question; C against A is computed for every cell with its interval, pairs and groups, and reported as "not tested: outside the family", with no test and no headline (D-087);',
      'question groups: instances of one logical question in one world share a template and an anchor type, so pairs are grouped by question id and world seed, and the group is the unit of both the interval and the test;',
      'interval: a paired bootstrap over groups, 10,000 resamples with the fixed seed 2026, 95 percent, reported in points;',
      "test: a two-sided Wilcoxon signed-rank test, with Pratt's treatment of zero differences, on the per-group mean differences;",
      "correction: Holm's step-down correction over the declared family, evidence recall on H1, H2 (anchored by id) and H5 and the answer score on H1, H2, H3 and H5, each for both tested comparisons, 14 tests in all;",
      'a difference is detectable when its Holm-adjusted p-value is below 0.05 and its 95 percent interval lies wholly above or below 0; a cell is tested only with at least 10 pairs and 6 groups, the fewest at which a two-sided signed-rank test can reach p below 0.05;',
      'outside the family and untested: the name-anchored sub-group H2_name, shown with an interval, and the ontology-dependent split (D-060), which is descriptive only. H3 is untested on evidence: in the seed 2026 bank no H3 instance keeps a claim once the anchor is removed, and in the official run only 3 of 72 did (L02-2031-INC_012, L02-2032-INC_012 and L02-2033-INC_025, each with one claim, the platform version, carried by a document passage).',
    ],
    'Headlines (_headlines in report.py). Each kind of question gets one headline per tested comparison on its main metric, evidence recall for H1, H2 and H5 and the answer score for H3, whether or not the cell was tested, in one of four forms: "Graph exceeds text search by n points" or "trails" by n points, each with its 95 percent interval and its pairs and groups; "No detectable difference"; or "Too few pairs to say" (including a cell with no pairs). Then the H2_name sub-group gets one descriptive line per tested comparison on the same evidence metric (subgroup_line in statistics.py): the difference with its interval, or the mean alone below 6 groups, or "no pairs", each ending "no test is run on this sub-group". The harness writes the headlines and the screens show them unedited (D-067).',
  ],
  terms: [
    'Answer key',
    'Answer score',
    'Claim',
    'Detectable difference',
    'Evidence recall',
    'Groundedness',
    'Failure cause',
    'Interval',
    'Judge',
    'Kind of question',
    'Pair',
    'Point',
    'Question group',
    'Repeat',
    'Starting record',
    'Test',
    'World',
  ],
}
