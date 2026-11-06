/**
 * Chapter 12, what the results teach: which kinds of question each approach
 * did best at in the official run (official-2026-10-29), why, as read
 * from the run's record, and what that suggests about text search, a graph and
 * an ontology. Every figure is a fact about that one run, so it is typed here
 * with its source, as chapter 8 types the run's headline figures; a newer run
 * needs this chapter rewritten, not refilled. Only the chart that opens the
 * chapter (resultsByKind) reads the newest official run from the API.
 *
 * Plain is short lists of findings, each section's explanation folded into
 * "More detail"; the cases behind them are at Technical.
 *
 * KIND_FIGURES are the means of `metrics` in the run's summary.json, to four
 * decimals. QUESTION_FIGURES were computed from the run's results.json, read
 * only, by a script outside the repository (the technical text says how); a
 * test checks that the two agree and that the tables show these numbers.
 *
 * The judges' mark figures come from the run's combined.json (D-105),
 * written by `make second-judge RUN=official-2026-10-29` on 2026-11-03 at
 * commit 4fe7c5c: the overall means of `metrics.overall` and the family's
 * tested cells of `comparisons`, rounded as Plain rounds them.
 */

import { percent } from '../../../app/score-words'
import type { PipelineId } from '../../../design/pipelines'
import type { ChapterCopy, TableBlock } from '../chapters'

/** One value per approach. */
export type PerApproach<T> = Readonly<Record<PipelineId, T>>

/** The kinds of question the run reports, as its summary names them. */
export type KindId = 'H1' | 'H2' | 'H2_name' | 'H3' | 'H5' | 'overall'

export interface KindFigures {
  /** Instances asked of each approach. */
  questions: number
  /** Mean evidence recall and the instances it is over. */
  evidence: PerApproach<number>
  evidenceN: number
  /** Mean answer score, over every instance. */
  answer: PerApproach<number>
}

/** summary.json of official-2026-10-29, `metrics.<kind>.evidence_recall` and `.answer`, means to four decimals. */
export const KIND_FIGURES: Readonly<Record<KindId, KindFigures>> = {
  H1: {
    questions: 72,
    evidence: { A: 0.4257, B: 0.6463, C: 0.6389 },
    evidenceN: 72,
    answer: { A: 0.478, B: 0.6023, C: 0.6208 },
  },
  H2: {
    questions: 72,
    evidence: { A: 0.1935, B: 0.1903, C: 0.3796 },
    evidenceN: 72,
    answer: { A: 0.1922, B: 0.2401, C: 0.4506 },
  },
  H2_name: {
    questions: 36,
    evidence: { A: 0.7824, B: 0.6157, C: 1.0 },
    evidenceN: 36,
    answer: { A: 0.5561, B: 0.5683, C: 0.7108 },
  },
  H3: {
    questions: 72,
    evidence: { A: 0.3333, B: 0.3333, C: 0.6667 },
    evidenceN: 3,
    answer: { A: 1.0, B: 0.9861, C: 0.9444 },
  },
  H5: {
    questions: 48,
    evidence: { A: 0.4854, B: 0.4167, C: 0.4167 },
    evidenceN: 48,
    answer: { A: 0.7075, B: 0.6279, C: 0.6279 },
  },
  overall: {
    questions: 300,
    evidence: { A: 0.4201, B: 0.4476, C: 0.5685 },
    evidenceN: 231,
    answer: { A: 0.5808, B: 0.6075, C: 0.6696 },
  },
}

/** Wins, ties and losses over a question's instances: alone highest, sharing the highest, below it. */
type Tally = readonly [win: number, tie: number, loss: number]

export interface QuestionFigures {
  id: string
  kind: Exclude<KindId, 'overall'>
  /** Instances: one per world for planted questions, three per world otherwise. */
  n: number
  /** Instances that keep a claim once the question's own record is left out. */
  evidenceN: number
  /** Means to four decimals; evidence is null when no instance keeps a claim. */
  evidence: PerApproach<number> | null
  answer: PerApproach<number>
  /** The judge's correctness, 0 to 2, descriptive only. */
  judge: PerApproach<number>
  evidenceWtl: PerApproach<Tally> | null
  answerWtl: PerApproach<Tally>
  /** Failure causes: [the needed evidence was not retrieved, it was retrieved but the answer was wrong]. */
  failures: PerApproach<readonly [number, number]>
  /** Answers whose verdict opens with "unknown". */
  unknown: PerApproach<number>
  /** Instances whose named record was among B's and C's starting points. */
  started: { B: number; C: number }
}

/** Per question, from results.json of official-2026-10-29 (300 instances, one answer each). */
export const QUESTION_FIGURES: readonly QuestionFigures[] = [
  {
    id: 'L01',
    kind: 'H3',
    n: 18,
    evidenceN: 0,
    evidence: null,
    answer: { A: 1.0, B: 1.0, C: 1.0 },
    judge: { A: 2.0, B: 2.0, C: 2.0 },
    evidenceWtl: null,
    answerWtl: { A: [0, 18, 0], B: [0, 18, 0], C: [0, 18, 0] },
    failures: { A: [0, 0], B: [0, 0], C: [0, 0] },
    unknown: { A: 0, B: 0, C: 0 },
    started: { B: 18, C: 18 },
  },
  {
    id: 'L02',
    kind: 'H3',
    n: 18,
    evidenceN: 3,
    evidence: { A: 0.3333, B: 0.3333, C: 0.6667 },
    answer: { A: 1.0, B: 1.0, C: 1.0 },
    judge: { A: 2.0, B: 2.0, C: 2.0 },
    evidenceWtl: { A: [0, 2, 1], B: [0, 2, 1], C: [1, 2, 0] },
    answerWtl: { A: [0, 18, 0], B: [0, 18, 0], C: [0, 18, 0] },
    failures: { A: [2, 0], B: [2, 0], C: [1, 0] },
    unknown: { A: 0, B: 0, C: 0 },
    started: { B: 18, C: 18 },
  },
  {
    id: 'L03',
    kind: 'H3',
    n: 18,
    evidenceN: 0,
    evidence: null,
    answer: { A: 1.0, B: 0.9444, C: 0.9444 },
    judge: { A: 2.0, B: 1.8889, C: 1.8889 },
    evidenceWtl: null,
    answerWtl: { A: [1, 17, 0], B: [0, 17, 1], C: [0, 17, 1] },
    failures: { A: [0, 0], B: [0, 1], C: [0, 1] },
    unknown: { A: 0, B: 1, C: 1 },
    started: { B: 18, C: 18 },
  },
  {
    id: 'L04',
    kind: 'H3',
    n: 18,
    evidenceN: 0,
    evidence: null,
    answer: { A: 1.0, B: 1.0, C: 0.8333 },
    judge: { A: 2.0, B: 2.0, C: 1.6667 },
    evidenceWtl: null,
    answerWtl: { A: [0, 18, 0], B: [0, 18, 0], C: [0, 15, 3] },
    failures: { A: [0, 0], B: [0, 0], C: [0, 3] },
    unknown: { A: 0, B: 0, C: 0 },
    started: { B: 18, C: 18 },
  },
  {
    id: 'L05',
    kind: 'H1',
    n: 18,
    evidenceN: 18,
    evidence: { A: 0.3796, B: 0.9306, C: 0.9306 },
    answer: { A: 0.6495, B: 0.7222, C: 0.75 },
    judge: { A: 0.8333, B: 1.5, C: 1.6111 },
    evidenceWtl: { A: [0, 4, 14], B: [0, 18, 0], C: [0, 18, 0] },
    answerWtl: { A: [2, 6, 10], B: [2, 9, 7], C: [5, 8, 5] },
    failures: { A: [11, 1], B: [1, 1], C: [1, 1] },
    unknown: { A: 0, B: 0, C: 0 },
    started: { B: 18, C: 18 },
  },
  {
    id: 'L06',
    kind: 'H1',
    n: 18,
    evidenceN: 18,
    evidence: { A: 0.212, B: 0.5435, C: 0.5694 },
    answer: { A: 0.1, B: 0.5315, C: 0.6778 },
    judge: { A: 0.1667, B: 1.0, C: 1.2222 },
    evidenceWtl: { A: [1, 6, 11], B: [3, 10, 5], C: [4, 10, 4] },
    answerWtl: { A: [0, 5, 13], B: [1, 12, 5], C: [5, 11, 2] },
    failures: { A: [15, 3], B: [9, 2], C: [8, 0] },
    unknown: { A: 16, B: 7, C: 7 },
    started: { B: 18, C: 18 },
  },
  {
    id: 'L07',
    kind: 'H1',
    n: 18,
    evidenceN: 18,
    evidence: { A: 0.1111, B: 0.1111, C: 0.0556 },
    answer: { A: 0.1667, B: 0.1667, C: 0.0556 },
    judge: { A: 0.2222, B: 0.2222, C: 0.1111 },
    evidenceWtl: { A: [2, 13, 3], B: [2, 13, 3], C: [1, 13, 4] },
    answerWtl: { A: [3, 11, 4], B: [3, 11, 4], C: [1, 11, 6] },
    failures: { A: [16, 0], B: [16, 0], C: [17, 0] },
    unknown: { A: 16, B: 16, C: 17 },
    started: { B: 2, C: 0 },
  },
  {
    id: 'L08',
    kind: 'H1',
    n: 18,
    evidenceN: 18,
    evidence: { A: 1.0, B: 1.0, C: 1.0 },
    answer: { A: 0.9957, B: 0.9889, C: 1.0 },
    judge: { A: 2.0, B: 2.0, C: 2.0 },
    evidenceWtl: { A: [0, 18, 0], B: [0, 18, 0], C: [0, 18, 0] },
    answerWtl: { A: [0, 17, 1], B: [0, 17, 1], C: [0, 18, 0] },
    failures: { A: [0, 0], B: [0, 0], C: [0, 0] },
    unknown: { A: 0, B: 0, C: 0 },
    started: { B: 18, C: 18 },
  },
  {
    id: 'L09',
    kind: 'H2',
    n: 18,
    evidenceN: 18,
    evidence: { A: 0.2778, B: 0.1852, C: 0.1852 },
    answer: { A: 0.2312, B: 0.2537, C: 0.2537 },
    judge: { A: 0.2778, B: 0.1111, C: 0.2778 },
    evidenceWtl: { A: [6, 11, 1], B: [0, 12, 6], C: [0, 12, 6] },
    answerWtl: { A: [3, 10, 5], B: [0, 15, 3], C: [0, 15, 3] },
    failures: { A: [16, 1], B: [18, 0], C: [18, 0] },
    unknown: { A: 12, B: 15, C: 15 },
    started: { B: 18, C: 18 },
  },
  {
    id: 'L10',
    kind: 'H2',
    n: 18,
    evidenceN: 18,
    evidence: { A: 0.237, B: 0.4463, C: 0.4444 },
    answer: { A: 0.1615, B: 0.4823, C: 0.491 },
    judge: { A: 0.3889, B: 0.8889, C: 0.8333 },
    evidenceWtl: { A: [0, 7, 11], B: [2, 13, 3], C: [2, 13, 3] },
    answerWtl: { A: [1, 2, 15], B: [7, 5, 6], C: [5, 5, 8] },
    failures: { A: [14, 3], B: [8, 0], C: [10, 1] },
    unknown: { A: 5, B: 2, C: 1 },
    started: { B: 18, C: 18 },
  },
  {
    id: 'L11',
    kind: 'H2',
    n: 18,
    evidenceN: 18,
    evidence: { A: 0.0, B: 0.0, C: 0.7593 },
    answer: { A: 0.0278, B: 0.0, C: 0.8333 },
    judge: { A: 0.0, B: 0.1111, C: 1.5 },
    evidenceWtl: { A: [0, 0, 18], B: [0, 0, 18], C: [18, 0, 0] },
    answerWtl: { A: [0, 0, 18], B: [0, 0, 18], C: [18, 0, 0] },
    failures: { A: [18, 0], B: [18, 0], C: [4, 0] },
    unknown: { A: 18, B: 18, C: 0 },
    started: { B: 0, C: 0 },
  },
  {
    id: 'L12',
    kind: 'H2',
    n: 18,
    evidenceN: 18,
    evidence: { A: 0.2593, B: 0.1296, C: 0.1296 },
    answer: { A: 0.3483, B: 0.2242, C: 0.2242 },
    judge: { A: 0.7222, B: 0.1111, C: 0.1111 },
    evidenceWtl: { A: [11, 6, 1], B: [0, 7, 11], C: [0, 7, 11] },
    answerWtl: { A: [8, 8, 2], B: [0, 10, 8], C: [0, 10, 8] },
    failures: { A: [14, 1], B: [17, 0], C: [17, 0] },
    unknown: { A: 7, B: 16, C: 16 },
    started: { B: 18, C: 18 },
  },
  {
    id: 'L13',
    kind: 'H2_name',
    n: 18,
    evidenceN: 18,
    evidence: { A: 0.7454, B: 0.537, C: 1.0 },
    answer: { A: 0.4333, B: 0.3995, C: 0.5185 },
    judge: { A: 1.0, B: 0.9444, C: 0.8333 },
    evidenceWtl: { A: [0, 6, 12], B: [0, 2, 16], C: [12, 6, 0] },
    answerWtl: { A: [0, 15, 3], B: [0, 11, 7], C: [3, 14, 1] },
    failures: { A: [1, 11], B: [7, 8], C: [0, 11] },
    unknown: { A: 0, B: 0, C: 0 },
    started: { B: 18, C: 18 },
  },
  {
    id: 'L14',
    kind: 'H2_name',
    n: 18,
    evidenceN: 18,
    evidence: { A: 0.8194, B: 0.6944, C: 1.0 },
    answer: { A: 0.6788, B: 0.737, C: 0.9032 },
    judge: { A: 0.9444, B: 0.9444, C: 1.2778 },
    evidenceWtl: { A: [0, 11, 7], B: [0, 7, 11], C: [7, 11, 0] },
    answerWtl: { A: [0, 4, 14], B: [1, 9, 8], C: [7, 10, 1] },
    failures: { A: [0, 3], B: [0, 4], C: [0, 1] },
    unknown: { A: 0, B: 0, C: 0 },
    started: { B: 18, C: 18 },
  },
  {
    id: 'L15',
    kind: 'H5',
    n: 6,
    evidenceN: 6,
    evidence: { A: 0.5, B: 0.5, C: 0.5 },
    answer: { A: 1.0, B: 1.0, C: 1.0 },
    judge: { A: 2.0, B: 2.0, C: 2.0 },
    evidenceWtl: { A: [0, 6, 0], B: [0, 6, 0], C: [0, 6, 0] },
    answerWtl: { A: [0, 6, 0], B: [0, 6, 0], C: [0, 6, 0] },
    failures: { A: [0, 0], B: [0, 0], C: [0, 0] },
    unknown: { A: 0, B: 0, C: 0 },
    started: { B: 6, C: 6 },
  },
  {
    id: 'L16',
    kind: 'H5',
    n: 6,
    evidenceN: 6,
    evidence: { A: 0.8333, B: 0.8, C: 0.8 },
    answer: { A: 0.8603, B: 0.8917, C: 0.8917 },
    judge: { A: 1.8333, B: 1.8333, C: 1.8333 },
    evidenceWtl: { A: [1, 5, 0], B: [0, 5, 1], C: [0, 5, 1] },
    answerWtl: { A: [1, 3, 2], B: [0, 5, 1], C: [0, 5, 1] },
    failures: { A: [0, 1], B: [0, 0], C: [0, 0] },
    unknown: { A: 0, B: 0, C: 0 },
    started: { B: 6, C: 6 },
  },
  {
    id: 'L17',
    kind: 'H5',
    n: 6,
    evidenceN: 6,
    evidence: { A: 1.0, B: 1.0, C: 1.0 },
    answer: { A: 1.0, B: 0.8538, C: 0.8538 },
    judge: { A: 2.0, B: 1.8333, C: 1.8333 },
    evidenceWtl: { A: [0, 6, 0], B: [0, 6, 0], C: [0, 6, 0] },
    answerWtl: { A: [1, 5, 0], B: [0, 5, 1], C: [0, 5, 1] },
    failures: { A: [0, 0], B: [0, 1], C: [0, 1] },
    unknown: { A: 0, B: 0, C: 0 },
    started: { B: 6, C: 6 },
  },
  {
    id: 'L18',
    kind: 'H5',
    n: 6,
    evidenceN: 6,
    evidence: { A: 0.6667, B: 0.6333, C: 0.6333 },
    answer: { A: 0.9167, B: 0.75, C: 0.75 },
    judge: { A: 1.3333, B: 1.5, C: 1.1667 },
    evidenceWtl: { A: [2, 0, 4], B: [1, 1, 4], C: [2, 1, 3] },
    answerWtl: { A: [3, 2, 1], B: [0, 3, 3], C: [0, 3, 3] },
    failures: { A: [0, 0], B: [1, 0], C: [2, 0] },
    unknown: { A: 0, B: 0, C: 0 },
    started: { B: 6, C: 6 },
  },
  {
    id: 'L19',
    kind: 'H5',
    n: 6,
    evidenceN: 6,
    evidence: { A: 0.4167, B: 0.0, C: 0.0 },
    answer: { A: 0.6667, B: 0.25, C: 0.25 },
    judge: { A: 0.1667, B: 0.0, C: 0.0 },
    evidenceWtl: { A: [5, 1, 0], B: [0, 1, 5], C: [0, 1, 5] },
    answerWtl: { A: [5, 1, 0], B: [0, 1, 5], C: [0, 1, 5] },
    failures: { A: [1, 0], B: [6, 0], C: [6, 0] },
    unknown: { A: 5, B: 6, C: 6 },
    started: { B: 1, C: 1 },
  },
  {
    id: 'L20',
    kind: 'H5',
    n: 6,
    evidenceN: 6,
    evidence: { A: 0.1333, B: 0.0667, C: 0.0667 },
    answer: { A: 0.3833, B: 0.4444, C: 0.4444 },
    judge: { A: 0.6667, B: 0.1667, C: 0.1667 },
    evidenceWtl: { A: [2, 4, 0], B: [0, 4, 2], C: [0, 4, 2] },
    answerWtl: { A: [1, 2, 3], B: [0, 5, 1], C: [0, 5, 1] },
    failures: { A: [6, 0], B: [6, 0], C: [6, 0] },
    unknown: { A: 1, B: 4, C: 4 },
    started: { B: 6, C: 6 },
  },
  {
    id: 'L21',
    kind: 'H5',
    n: 6,
    evidenceN: 6,
    evidence: { A: 0.0, B: 0.0, C: 0.0 },
    answer: { A: 0.0, B: 0.0, C: 0.0 },
    judge: { A: 0.0, B: 0.0, C: 0.0 },
    evidenceWtl: { A: [0, 6, 0], B: [0, 6, 0], C: [0, 6, 0] },
    answerWtl: { A: [0, 6, 0], B: [0, 6, 0], C: [0, 6, 0] },
    failures: { A: [6, 0], B: [6, 0], C: [6, 0] },
    unknown: { A: 6, B: 6, C: 6 },
    started: { B: 6, C: 6 },
  },
  {
    id: 'L22',
    kind: 'H5',
    n: 6,
    evidenceN: 6,
    evidence: { A: 0.3333, B: 0.3333, C: 0.3333 },
    answer: { A: 0.8333, B: 0.8333, C: 0.8333 },
    judge: { A: 0.8333, B: 1.0, C: 1.0 },
    evidenceWtl: { A: [0, 6, 0], B: [0, 6, 0], C: [0, 6, 0] },
    answerWtl: { A: [0, 6, 0], B: [0, 6, 0], C: [0, 6, 0] },
    failures: { A: [4, 0], B: [4, 0], C: [4, 0] },
    unknown: { A: 5, B: 4, C: 4 },
    started: { B: 6, C: 6 },
  },
]

/** The question each logical question asks, in words, for the Technical tables. */
const QUESTION_WORDS: Readonly<Record<string, string>> = {
  L01: 'Ticket price of a game',
  L02: 'Platform version an incident was seen on',
  L03: 'When a campaign ends',
  L04: 'Is a game sold on digital channels',
  L05: 'Other markets with incidents on the same platform version',
  L06: 'Mechanics of the games an incident affected',
  L07: 'Platform version behind the incident of a support case',
  L08: 'Games affected by incidents on a platform version',
  L09: 'Games in other markets of the same kind of family, by id',
  L10: 'Incidents in other markets of the same kind',
  L11: 'Segments in other markets matching a segment',
  L12: 'Games in other markets with the same kind of main mechanic',
  L13: 'Games in a kind of family given by its local name',
  L14: 'Games using a kind of mechanic given by its local phrase',
  L15: 'What caused an incident (planted)',
  L16: 'Players sharing a device (planted)',
  L17: 'Accounts sharing a payment instrument (planted)',
  L18: 'Other markets on the same version, and the unaffected one (planted)',
  L19: 'Payment provider behind a support case, and its markets (planted)',
  L20: 'Games in other markets with the same mechanic affinity (planted)',
  L21: 'Best transfer target for a campaign (planted)',
  L22: 'Current price, and is the old rules document valid (planted)',
}

const APPROACHES: readonly PipelineId[] = ['A', 'B', 'C']

/** A no-break space, so the three figures of a cell stay on one line. */
const NBSP = '\u00a0'

/** Three figures for A, B and C, kept together. */
const three = (values: readonly (string | number)[], separator: string) =>
  values.join(separator.replaceAll(' ', NBSP))

/** "43%, 65%, 64%": a whole percentage for A, B and C. */
export const percents = (values: PerApproach<number>): string =>
  three(
    APPROACHES.map((id) => percent(values[id])),
    ', ',
  )

/**
 * A 0 to 1 mean with two decimals, rounded half up as percent() rounds, so
 * 0.7454 reads 0.75 here and 75% at Plain (toFixed would round the binary
 * float, and 0.745 would read 0.74).
 */
export const twoDecimals = (value: number): string =>
  (Math.round(value * 100) / 100).toFixed(2)

const decimals = (values: PerApproach<number> | null) =>
  values === null
    ? 'None'
    : three(
        APPROACHES.map((id) => twoDecimals(values[id])),
        ' / ',
      )

const tallies = (values: PerApproach<Tally> | null) =>
  values === null
    ? 'None'
    : APPROACHES.map((id) => `${id}${NBSP}${values[id].join('-')}`).join(', ')

/** The kinds of question at Plain: name, evidence found, answer score, the best, and what the test said. */
const KIND_ROWS: readonly [KindId, string, string, string][] = [
  [
    'H1',
    'Multi-hop questions, which need several linked records',
    'Graph and graph + ontology, about equal; both well above text search',
    'Graph against text search on evidence: passed, the one clear result. On answers it leaned the same way and did not pass. Graph + ontology against graph: no detectable difference.',
  ],
  [
    'H2',
    'Questions that match a kind of thing across markets, named by its code',
    'Graph + ontology',
    'Graph + ontology against graph: leaned its way on both measures, did not pass. Graph against text search: no detectable difference.',
  ],
  [
    'H2_name',
    'The same, with the thing named in a local language',
    'Graph + ontology',
    'Not tested',
  ],
  [
    'H3',
    'Single facts about one named record',
    'Text search, on answers',
    'No detectable difference',
  ],
  [
    'H5',
    'Planted patterns, the stories hidden in the data',
    'Text search, though most of its lead on answers is how the score reads text',
    'Graph against text search: leaned toward text search on both measures, did not pass. Graph + ontology against graph: no detectable difference.',
  ],
  ['overall', 'All questions', 'Graph + ontology', 'Not tested as a whole'],
]

export const KIND_TABLE: TableBlock = {
  kind: 'table',
  caption: 'Which approach did best, by kind of question',
  columns: [
    'Kind of question',
    'Times asked',
    'Evidence found (A, B, C)',
    'Answer score (A, B, C)',
    'Did best',
    'What the test said',
  ],
  rows: KIND_ROWS.map(([id, name, best, test]) => {
    const figures = KIND_FIGURES[id]
    const evidence =
      id === 'H3'
        ? `Not measured: ${figures.evidenceN} of ${figures.questions} had evidence to find`
        : percents(figures.evidence)
    return [
      name,
      String(figures.questions),
      evidence,
      percents(figures.answer),
      best,
      test,
    ]
  }),
}

export const QUESTION_TABLE: TableBlock = {
  kind: 'table',
  caption: 'Means for each question',
  columns: [
    'Question',
    'Asks',
    'Kind',
    'n (with evidence)',
    'Evidence recall A / B / C',
    'Answer score A / B / C',
    'Judge correctness, 0 to 2, A / B / C',
  ],
  rows: QUESTION_FIGURES.map((q) => [
    q.id,
    QUESTION_WORDS[q.id] ?? q.id,
    q.kind,
    `${q.n} (${q.evidenceN})`,
    decimals(q.evidence),
    decimals(q.answer),
    decimals(q.judge),
  ]),
}

export const OUTCOME_TABLE: TableBlock = {
  kind: 'table',
  caption: 'Wins, ties, losses and failures for each question',
  columns: [
    'Question',
    'Evidence recall, win-tie-loss',
    'Answer score, win-tie-loss',
    'Not retrieved, A / B / C',
    'Retrieved, answer wrong, A / B / C',
    'Verdict "unknown", A / B / C',
    'Started from the named record, B / C',
  ],
  rows: QUESTION_FIGURES.map((q) => [
    q.id,
    tallies(q.evidenceWtl),
    tallies(q.answerWtl),
    three(
      APPROACHES.map((id) => q.failures[id][0]),
      ' / ',
    ),
    three(
      APPROACHES.map((id) => q.failures[id][1]),
      ' / ',
    ),
    three(
      APPROACHES.map((id) => q.unknown[id]),
      ' / ',
    ),
    `${q.started.B} / ${q.started.C} of ${q.n}`,
  ]),
}

export const lessons: ChapterCopy = {
  plain: [
    'This chapter reads the official run, which started on 2026-10-29, to see when text search, a graph and an ontology help.',
    {
      kind: 'key',
      text: 'One difference passed its test: on multi-hop questions the graph found more of the needed evidence than text search.',
    },
    { kind: 'component', name: 'resultsByKind' },
    'The chart shows the newest official run (several linked records are the multi-hop questions; hidden patterns the planted patterns); the text is fixed to the 2026-10-29 run.',
    {
      kind: 'more',
      summary: 'The figures and what the test said',
      blocks: [KIND_TABLE],
    },
    { kind: 'heading', text: 'How to read this chapter' },
    [
      'A is text search, B the graph, and C the graph with the ontology (chapter 4); evidence found is the share of the needed facts that reached the answer model.',
      'Before the run, 14 comparisons were given a test, a check of whether a difference is bigger than chance. Only one passed.',
      'Everything else is a pattern seen in this run, on 6 to 72 cases at a time, and may be chance.',
      'The answer score, how much of the answer key an answer got right, sometimes gives credit a careful reader would not, or holds it back. Where that changes who did best, this chapter says so; it is a known limit in chapter 9.',
    ],
    {
      kind: 'more',
      summary: 'What a case is',
      blocks: [
        'A case is one question about one record in one world; each of the 22 questions was asked 6 or 18 times.',
      ],
    },
    { kind: 'heading', text: 'Where text search did best' },
    [
      'Single facts about one named record. Text search answered all 72 correctly, the graph 71 and the graph with the ontology 68, a difference the test did not detect.',
      'Planted patterns, each from a planted story (chapter 3): 49 percent of the needed evidence against 42 percent for each graph approach, and answer scores of 71 against 63 percent. No detectable difference.',
      'Two questions that look for games of the same kind of family or mechanic in other markets. All three did badly, but text search found the most: 28 percent against 19 percent on the family question, and 26 against 13 on the mechanic question.',
    ],
    {
      kind: 'more',
      summary: 'Why',
      blocks: [
        'Single facts: the answer is in the named record, so all three found it; the misses came from the answer model.',
        'Planted patterns: most of the evidence gap is one question, which payment provider was behind a support case. The graph walk, from the closest match to the support case, found none of the evidence.',
        'Text search found the review naming the provider in 5 of 6 worlds, yet the judge marked 5 of its 6 answers wrong.',
        'Most of text search\'s lead on those answers is how the answer score reads text. It credits naming the provider in an answer that says it does not know, and it accepts "United Kingdom" but not "UK", which cost the graph approaches half marks four times.',
        'Read with "UK" accepted, a check made after the run that leaves the published scores as they are, the gap on planted-pattern answers falls from 8.0 to 4.9 points. The judge\'s marks are close: 1.10, 1.04 and 1.00 out of 2.',
        'Same kind of family or mechanic: text search found most of its evidence in product documents. The graph approaches showed about half as many, because graph records took part of the space.',
        "Their graph records held neither the shared kind nor a game of another market, which is four links from the named game. This run does not show whether the walk's reach or the space limit is to blame.",
      ],
    },
    { kind: 'heading', text: 'Where the graph did best' },
    [
      'Multi-hop questions, which need several linked records, gave the one result that passed the test. The graph found 65 percent of the needed evidence and text search 43 percent: 22.1 points more. The likely range of that difference, a 95 percent interval, is 10.4 to 34.1 points.',
      'On answers it scored 60 percent against 48 percent, leaning the same way without passing.',
      'On incidents of the same kind in other markets it found 45 percent against 24, by way of the platform version; the ontology approach found 44.',
    ],
    {
      kind: 'more',
      summary: 'Why',
      blocks: [
        'All of the multi-hop difference came from two questions. From an incident, the graph followed its platform version to the other incidents on it (93 percent against 38 for text search), and followed the games it hit, whose records list their mechanics (54 against 21).',
        'On the other two multi-hop questions all three found everything on one and failed on the other.',
      ],
    },
    { kind: 'heading', text: 'Where the graph with the ontology did best' },
    [
      'Questions that match a kind of thing across markets: 38 percent of the evidence against 19 percent for the other two, and an answer score of 45 against 24 percent for the graph. The test leaned its way but did not pass.',
      'All of that came from one question, matching player segments across markets: 76 percent of the evidence and an answer score of 83 percent, where the other two found none.',
      'Questions that name a game family or mechanic in a local language: all the evidence in all 36 cases (100 percent), against 78 percent for text search and 62 percent for the graph. These questions were not tested.',
    ],
    {
      kind: 'more',
      summary: 'Why',
      blocks: [
        'Segments are not a starting point, so both graph approaches started from a player in the segment. Only the ontology links segments across markets, through their shared kind, and the ontology approach reached most of the matching segments.',
        'On local names it matched the name to the shared kind and followed it to every market; the graph matched only the local family or mechanic.',
        "Finding the evidence was not enough: on the family question the answer model named only one market's game, and the answer score was only 52 percent, against 90 percent on the mechanic question.",
      ],
    },
    { kind: 'heading', text: 'Where none did well' },
    [
      "From a support case to its incident's platform version: all three found about a tenth of the evidence or less. The graph cannot start from a support case.",
      'Two planted questions that need a conclusion from several signals: no approach found more than 13 percent of the evidence.',
      'In 24 answers from text search, 17 from the graph and 19 from the graph with the ontology, of 300 each, at least half of the needed evidence reached the answer model and the answer still scored under half.',
    ],
    {
      kind: 'more',
      summary: 'Why',
      blocks: [
        "When the graph's closest match happened to be the named support case, twice in 18, it found all the evidence.",
        'Most of those weak answers come from the local-name questions: 14 of the 24 for text search and 12 of the 19 for the ontology approach.',
      ],
    },
    { kind: 'heading', text: 'What to take home' },
    [
      'Text search is enough in this run when a question names a record or a document states the answer.',
      'A graph found more of the needed evidence on multi-hop questions, the one tested result; the gain was where the answer is a record or two away along a link, from a record the graph can start from.',
      'A shared vocabulary helps across markets and with local names: a pattern seen in this run, not confirmed by the test.',
      'Graph records take room from documents, and finding the evidence is not the same as answering well.',
    ],
    { kind: 'heading', text: 'When to use each' },
    "Advice from this run's patterns; only the multi-hop result was tested.",
    [
      'Text search alone: questions about one record, or answers written in documents.',
      'A graph: questions that follow links between records it can start from.',
      'An ontology on top: questions that compare markets by meaning, use local names, or ask for things "of the same kind", though not the family and mechanic questions named by code.',
      'All three: a mix of these, since no single approach was best on every kind of question. B and C also search documents, so the choice is how to share the space with graph records.',
    ],
    { kind: 'heading', text: 'What the two judges said' },
    [
      "The judges' mark (chapter 6) is how right two AI judges found each answer, tested as a group of its own. It put the three in the same order as the answer score: text search 50 percent, the graph 53 and the graph with the ontology 58.",
      'Of its 8 tests, none passed.',
      'The two judges gave the same mark to 814 of the 899 answers both of them marked (91 percent).',
    ],
    {
      kind: 'more',
      summary: 'Where they leaned and disagreed',
      blocks: [
        'Two tests leaned the same way as the answer score without passing: the graph above text search on multi-hop questions, by about 18 points, and the graph with the ontology above the graph across markets, by about 19.',
        "On 3 answers the judges gave opposite marks, one fully right and the other wrong. Each answer is on Results, under Judges' verdict.",
      ],
    },
    { kind: 'heading', text: 'Limits' },
    'The company is made up, its builders wrote the 22 questions, and one answer model answered each question once. No figure for a single question is tested.',
  ],
  plainHint:
    'The Technical level adds the figures for each of the 22 questions: wins, ties and losses, failure causes, the cases examined, and how the numbers were computed.',
  technical: [
    { kind: 'heading', text: 'Source' },
    'Run official-2026-10-29 (scorer 2.2.1, answer parser 2.1.1, commit 4c62325, clean tree): six unseen worlds 2029 to 2034, bank 2.0.0, 300 instances, one answer per approach, 900 answers, no failed answer or judge call, and no answer cut off at the output limit. The kind table is summary.json (metrics.<kind>.evidence_recall and .answer, the means of the report). The question tables were computed from results.json, read only, by a script kept outside the repository: for each instance it reads scores[p][0].evidence.recall, scores[p][0].answer, the judge correctness, the failure class, the verdict, resolved_ids against the anchor, the selected carriers against the claims and the path line of each graph block. Its per-kind means matched summary.json to the last digit, and a test checks that the per-question means here average to the kind figures. An independent review of 2026-11-02 recomputed every figure and found two table cells mis-rounded (now fixed: means are kept to four decimals and rounded half up, as Plain rounds them) and the scoring issues below.',
    { kind: 'heading', text: 'Definitions' },
    'A case at Plain is an instance. A mean is over the instances where the score exists; evidence recall exists only where a claim survives removing the anchor, so single facts have it on 3 of 72 instances (all L02) and L01, L03 and L04 have none. Win-tie-loss is per instance: a win is the highest value alone, a tie shares the highest (all three equal included), a loss is below it. "Unknown" is a verdict that opens with the word (is_abstention). Started from the named record counts instances whose anchor is in resolved_ids. Judge correctness is 0 to 2 and descriptive only. Failure causes follow classify_failure (threshold 0.5): "not retrieved" is evidence recall below 0.5, whatever the answer scored (36, 34 and 35 of those answers scored 0.5 or more); "retrieved, answer wrong" is an answer score below 0.5 with recall of 0.5 or more, or no recall; all claims were found in 4, 2 and 14 of them.',
    'Tests (summary.json, unchanged). Of the 14 in the family, one passed: H1 evidence recall B against A, +22.1 points (95 percent interval 10.4 to 34.1, 72 pairs in 24 groups, p 0.0022, Holm p 0.030). Five more have intervals that leave out zero and fail the test: H2 C against B evidence +18.9 (Holm 0.38) and answer +21.0 (Holm 0.28); H1 B against A answer +12.4 (Holm 0.17); H5 B against A evidence -6.9 (Holm 0.23) and answer -8.0 (Holm 1.0). The rest show no detectable difference. H2_name and every per-question figure are untested.',
    "Where each tested difference comes from, by simple means (equal to the report's comparison means, since every question in a kind has the same n): H1 B minus A evidence +22.1 = (L05 +55.1, L06 +33.2, L07 0, L08 0) / 4. H2 C minus B evidence +18.9 = (L09 0, L10 -0.2, L11 +75.9, L12 0) / 4; answer +21.0, of which L11 gives 20.8. H5 A minus B evidence +6.9, of which L19 gives 5.2 points (76 percent); answer +8.0, of which L19 gives 5.2 (65 percent), L18 2.1 and L17 1.8.",
    QUESTION_TABLE,
    OUTCOME_TABLE,
    'Instances examined, with what the record shows:',
    [
      'L05-2029-INC_017 and L05-2030-INC_017: B and C reached the other incidents by the path line "INC_017 -RELATED_TO_VERSION-> PLV_WEB_2 <-RELATED_TO_VERSION- INC_018"; A found none or one of them. Over L05, A found 12 of 38 claims, B and C 32 each. A named all three other markets in 14 of 18 verdicts (B 5, C 3); the set check gives partial credit to a list that holds the right market, so A\'s answer score (0.65) sits well above its judge mark (0.83 of 2).',
      'L06-2029-INC_011, L06-2030-INC_013: B and C selected the affected game record (GAME_AT_04, GAME_UK_06), which lists the mechanic; A selected the incident and said "unknown".',
      'L07: support cases are not starting ids (SEED_ID_PREFIXES at commit 4c62325 has no SUP_, by design), so B fell back to the best record hit, usually another support case (SUP_01937, SUP_00521, ...); it hit the named case twice (L07-2029-SUP_01417, L07-2030-SUP_01565) and found all the evidence both times. On all 18 L07 instances C resolved only CONCEPT_INCIDENT, and with something resolved it takes no fallback (docs/retrieval.md, "Seeds"); its one success (L07-2034-SUP_00899) came another way. A selected the named case in 18 of 18 and the incident behind it in 2 (2031-SUP_00678, 2032-SUP_01052).',
      'L19-SUP_02027: B and C started from another support case in 5 of 6 worlds (SUP_01277 and others). In 2029 both started from SUP_02027 and their path lines went to other payment cases of the market ("SUP_02027 -CATEGORISED_AS-> SUPC_UK_PAYMENT <-CATEGORISED_AS- SUP_00033", "-FROM_MARKET-> MKT_UK"), not to the provider; recall 0 in all six. A selected the planted review CHNK_0257_00 in 5 of 6 and mentioned the right provider in those 5; its verdict was "unknown" in four of them and named PP_AEGEAN_PAY in 2030, and the judge gave 0 in 5 of 6. The token check reads the whole answer, so the mention scores.',
      'Answers that say "unknown" earn credit in every approach: the token and set checks read the whole answer, so an "unknown" verdict that names expected items scores. Summed answer score on "unknown" verdicts, over all 300: 12.5 / 16.5 / 15.6 (4.2, 5.5 and 5.2 points of the overall answer score); over planted patterns 7.75 / 7.5 / 7.5. It lifts A on L19 (3.25 of A\'s 4.0 summed), and B and C on L20 (2.0 of 2.67; their 0.44 is above A\'s 0.38, while the judge gives 0.17 against 0.67) and on L09 (3.07 of 4.57, against A\'s 1.55 of 4.16).',
      'L09 and L12: B and C selected no CONCEPT_ record and no family or mechanic of another market; they selected the named game\'s own family (or another family of its market) in 9 of 18 L09 instances and its own mechanic in 4 of 18 L12 instances (paths "GAME -BELONGS_TO-> FAM", "-HAS_MECHANIC->"); their other graph records came through incidents and support cases ("GAME_AT_05 <-AFFECTS- INC_031 -AFFECTS-> GAME_AT_02"). B and C were identical. B and C found 9 of their 10 L09 claims and 7 of their 8 L12 claims through passages, and A 12 of 15 and 15 of 18; A showed 262 passages on L09 against 137 for B and for C. On the development world only (2026, data/evaluation/diagnostics/20261028T103824Z-selection/selection.md), B\'s graph found needed L09 games at graph rank 13 and C\'s at ranks 14 to 25, and the budget cut them; the official record keeps no such diagnostic, so it cannot say what the walk reached.',
      'L10-2029-INC_013: B and C reached INC_004 by "INC_013 -RELATED_TO_VERSION-> PLV_RETAIL_2 <-RELATED_TO_VERSION- INC_004", not by the incident type; the only concept C resolved was CONCEPT_INCIDENT.',
      "L11-2029-SEG_CZ_USPORNI: neither B nor C resolved the segment (SEG_ is not a starting prefix); both started from PLAYER_CZ_000428. C's path lines run PLAYER, BELONGS_TO, SEG_CZ_USPORNI, the ontology link, CONCEPT_BUDGET_VALUE, the ontology link, SEG_AT_SPARSAM. B reached the named segment and one other segment of the same market in all 18, and no segment of another market. C found 76 percent of the matching segments, not all (L11-2029-SEG_GR_KORYFAIOI: one of three).",
      'L13-2029, all three anchors: C resolved the concept and the family (CONCEPT_MULTINATIONAL_JACKPOT, FAM_AT_LAENDER_JACKPOT) and reached every market\'s family and games, evidence 1.00 on 18 of 18; B resolved the family only and walked to SUP_ and INC_ records. C\'s verdicts named one game (for example "Alpen Jackpot"), 6 of its 18 answers call the mapped families "distinct" (one: "distinct from Αριθμολαχείο"), and 11 of its 18 are classed "retrieved, answer wrong". A\'s verdicts named the same single game in most worlds; the judge gave A 1.00 and C 0.83.',
      'L03-2034-CMP_002: the campaign record, with "ends: 2025-10-15", was block 1 for B and C, and both answered that no end date was given. L04-2029, 2030 and 2033-GAME_AT_05: C answered "yes" for a retail-only game; CONCEPT_DIGITAL_CHANNEL was block 2 in all six GAME_AT_05 instances, the three correct ones included.',
      'L18: the checks read the answer text, not the role it gives a market. The set check\'s universe holds only the expected markets, so naming another market as affected is not marked down (B and C named the United Kingdom as affected in 2029, 2031 and 2032 and scored 1.0). The check for the unaffected market accepts "United Kingdom" but not "UK": B answered correctly with "UK" in 2030, 2033 and 2034 and C in 2030, and each scored 0.5, while the judge gave those answers its top correctness mark. Rescored with "UK" as an alias of MKT_UK (a reviewer\'s check with the run\'s own checks, which first reproduced all 900 stored scores; not part of the run, and the published scores stand), L18 answers read 0.92 / 1.00 / 0.92 (C also gains on 2034, whose verdict lists "UK" without its role), H5 answers 0.708 / 0.658 / 0.648, and the planted-pattern answer gap A minus B falls from 8.0 to 4.9 points. The alias also lowers A on L05 (0.65 to 0.63) and C (0.75 to 0.74), where "UK" was a wrong market in a list, so H1 answers read 0.472 / 0.602 / 0.617, and B and C on L19 (0.25 to 0.24).',
      'L21: every answer of all three says "unknown", and no approach selected a carrier of any claim (evidence recall 0 on all 18 answers).',
    ],
    'Room in the budget: over all 900 answers A showed 1,694 passages, B 800 and C 786; B and C filled the rest with graph records under the same 2,000-token budget the run recorded.',
    'Where a record states the link outright (L08 games hit by incidents on a platform version, L16 players sharing a device, L17 accounts sharing a payment instrument), the three found about the same evidence, often all of it; there the graph adds little.',
    { kind: 'heading', text: "The judges' mark" },
    "combined.json of the run (schema 1, second judge ollama/muse-glimmer:latest, reasoning off, temperature 0, reply limit 2,048, judge prompt 1.2.0, the first judge's): 900 answers, 899 marked by both judges, one second-judge failure (a reply with no completeness score, so A has 299). Overall judge_mark 0.503 / 0.530 / 0.578. Family of 8, none under Holm 0.05: H1 B against A +18.4 (95 percent interval 7.3 to 29.9, p 0.0071, Holm 0.057); H2 C against B +19.4 (7.3 to 33.0, p 0.014, Holm 0.10); H1 C against B +2.8, H2 B against A -1.4, H3 B against A -1.4, H3 C against B -4.2, H5 B against A -3.1, H5 C against B -2.1, all with Holm 0.5 or more. Same correctness level on 814 of 899 (answered: 87.8 percent, weighted kappa 0.82, n 637; abstained: 97.3 percent, kappa 0.75, n 262); a 2 against a 0 on 3 (L12-2030-GAME_CZ_02 A, L11-2031-SEG_CZ_OBCASNI B, L09-2034-GAME_UK_03 C, each first 2, second 0).",
    { kind: 'heading', text: 'What this does not show' },
    'The why is read from what each approach selected, its starting records, its path lines and its answer text. It does not show what the graph found and the budget then cut in the official worlds. Per-question figures rest on 18 instances in 6 groups (L01 to L14) or 6 instances in 6 groups (L15 to L22), and no test was run on them.',
  ],
  terms: [
    'Answer key',
    'Answer model',
    'Answer score',
    'Detectable difference',
    'Graph walk',
    'Judge',
    "Judges' mark",
    'Kind of question',
    'Market',
    'Multi-hop',
    'Official run',
    'Passage',
    'Planted story',
    'Starting point',
    'Test',
    'World',
  ],
}
