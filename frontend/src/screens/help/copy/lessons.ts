/**
 * Chapter 13, what the results teach: which kinds of question each approach
 * did best at in the official run v0.3.0 (official-2026-10-29), why, as read
 * from the run's record, and what that suggests about text search, a graph and
 * an ontology. Every figure is a fact about that one run, so it is typed here
 * with its source, as chapter 8 types the run's headline figures; a newer run
 * needs this chapter rewritten, not refilled.
 *
 * KIND_FIGURES are the means of `metrics` in the run's summary.json, to four
 * decimals. QUESTION_FIGURES were computed from the run's results.json, read
 * only, by a script outside the repository (the technical text says how); a
 * test checks that the two agree and that the tables show these numbers.
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
  /** Means to three decimals; evidence is null when no instance keeps a claim. */
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
    evidence: { A: 0.333, B: 0.333, C: 0.667 },
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
    answer: { A: 1.0, B: 0.944, C: 0.944 },
    judge: { A: 2.0, B: 1.889, C: 1.889 },
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
    answer: { A: 1.0, B: 1.0, C: 0.833 },
    judge: { A: 2.0, B: 2.0, C: 1.667 },
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
    evidence: { A: 0.38, B: 0.931, C: 0.931 },
    answer: { A: 0.649, B: 0.722, C: 0.75 },
    judge: { A: 0.833, B: 1.5, C: 1.611 },
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
    evidence: { A: 0.212, B: 0.544, C: 0.569 },
    answer: { A: 0.1, B: 0.531, C: 0.678 },
    judge: { A: 0.167, B: 1.0, C: 1.222 },
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
    evidence: { A: 0.111, B: 0.111, C: 0.056 },
    answer: { A: 0.167, B: 0.167, C: 0.056 },
    judge: { A: 0.222, B: 0.222, C: 0.111 },
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
    answer: { A: 0.996, B: 0.989, C: 1.0 },
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
    evidence: { A: 0.278, B: 0.185, C: 0.185 },
    answer: { A: 0.231, B: 0.254, C: 0.254 },
    judge: { A: 0.278, B: 0.111, C: 0.278 },
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
    evidence: { A: 0.237, B: 0.446, C: 0.444 },
    answer: { A: 0.162, B: 0.482, C: 0.491 },
    judge: { A: 0.389, B: 0.889, C: 0.833 },
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
    evidence: { A: 0.0, B: 0.0, C: 0.759 },
    answer: { A: 0.028, B: 0.0, C: 0.833 },
    judge: { A: 0.0, B: 0.111, C: 1.5 },
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
    evidence: { A: 0.259, B: 0.13, C: 0.13 },
    answer: { A: 0.348, B: 0.224, C: 0.224 },
    judge: { A: 0.722, B: 0.111, C: 0.111 },
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
    evidence: { A: 0.745, B: 0.537, C: 1.0 },
    answer: { A: 0.433, B: 0.399, C: 0.519 },
    judge: { A: 1.0, B: 0.944, C: 0.833 },
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
    evidence: { A: 0.819, B: 0.694, C: 1.0 },
    answer: { A: 0.679, B: 0.737, C: 0.903 },
    judge: { A: 0.944, B: 0.944, C: 1.278 },
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
    evidence: { A: 0.833, B: 0.8, C: 0.8 },
    answer: { A: 0.86, B: 0.892, C: 0.892 },
    judge: { A: 1.833, B: 1.833, C: 1.833 },
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
    answer: { A: 1.0, B: 0.854, C: 0.854 },
    judge: { A: 2.0, B: 1.833, C: 1.833 },
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
    evidence: { A: 0.667, B: 0.633, C: 0.633 },
    answer: { A: 0.917, B: 0.75, C: 0.75 },
    judge: { A: 1.333, B: 1.5, C: 1.167 },
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
    evidence: { A: 0.417, B: 0.0, C: 0.0 },
    answer: { A: 0.667, B: 0.25, C: 0.25 },
    judge: { A: 0.167, B: 0.0, C: 0.0 },
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
    evidence: { A: 0.133, B: 0.067, C: 0.067 },
    answer: { A: 0.383, B: 0.444, C: 0.444 },
    judge: { A: 0.667, B: 0.167, C: 0.167 },
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
    evidence: { A: 0.333, B: 0.333, C: 0.333 },
    answer: { A: 0.833, B: 0.833, C: 0.833 },
    judge: { A: 0.833, B: 1.0, C: 1.0 },
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

const decimals = (values: PerApproach<number> | null, places: number) =>
  values === null
    ? 'None'
    : three(
        APPROACHES.map((id) => values[id].toFixed(places)),
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
    'Graph on evidence; graph + ontology on answers, 2 points above the graph',
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
    'Text search',
    'Graph against text search: leaned toward text search on both measures, did not pass. Graph + ontology against graph: no detectable difference.',
  ],
  ['overall', 'All questions', 'Graph + ontology', 'Not tested as a whole'],
]

export const KIND_TABLE: TableBlock = {
  kind: 'table',
  caption: 'Which approach did best, by kind of question',
  columns: [
    'Kind of question',
    'Questions',
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
    decimals(q.evidence, 2),
    decimals(q.answer, 2),
    decimals(q.judge, 2),
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
    'This chapter explains the official run v0.3.0, which started on 2026-10-29. It says which kinds of question each approach did best at, why, and what that suggests about when you would want text search, a graph, an ontology, or all three. Every figure here comes from that run and is fixed to it.',
    'Text search is approach A, the graph is B, and the graph with the ontology is C (chapter 4). Two measures are used. "Evidence found" is the share of the facts a correct answer needs that reached the answer model. The answer score is how much of the answer key an answer got right.',
    'Read the figures with care. Before the run, 14 comparisons were chosen and given a test, a check that a difference is too large to be chance. Only one passed: on multi-hop questions, the graph found more of the needed evidence than text search. Everything else here is a pattern seen in this run, on 6 to 72 questions at a time. A pattern may be chance, and it is called a pattern.',
    KIND_TABLE,
    { kind: 'heading', text: 'Where text search did best' },
    "Single facts about one named record. Text search answered all 72 correctly, the graph 71 and the graph with the ontology 68. The question names one record, such as a game or a campaign, and the answer is written in that record, so all three found it. The misses came from the answer model. Once, B and C both had a campaign record with its end date as their first piece of evidence, and both said the date was not there. Three times C said that a game sold only in shops was sold online. Its evidence held the ontology's description of digital sales, but so did its evidence on the three times it answered correctly, so that alone does not explain the error.",
    'Planted patterns. Each comes from a planted story, hidden in the data on purpose (chapter 3). Text search found 49 percent of the needed evidence and the graph approaches 42 percent each; answer scores were 71 percent against 63 percent. The test found no detectable difference. Most of the gap is one question: which payment provider was behind a given support case. The graph cannot use a support case as its starting point, because support cases are not among the kinds of record it can start from. So it started from the closest match text search found, which was a different support case in 5 of the 6 worlds, and it found none of the evidence. Text search found the incident review that names the provider in 5 of 6. Even so, its answers mentioned the provider without saying it was the answer, and the judge marked 5 of the 6 wrong.',
    'Questions where a record states the link outright, such as players who share a device or a payment card, or the games hit by incidents on one platform version. All three found about the same evidence, often all of it. When a record or a document says the answer in plain words, text search finds it and the graph adds little.',
    'Two questions that cross markets by kind, such as "which games in other markets belong to the same kind of game family as this one". All three did badly, and text search least badly: 28 percent of the evidence against 19 percent on the family question, and 26 against 13 on the mechanic question. Text search found most of what it found in product documents, which name a game\'s family and mechanic in words. The graph approaches showed about half as many documents, because their graph records take part of the same space. Their graph walk from the game went through its incidents, not its family. To reach a game in another market through its kind of family takes four links, more than the walk reaches.',
    { kind: 'heading', text: 'Where the graph did best' },
    'Multi-hop questions, which need several linked records. This is the one result that passed the test. The graph found 65 percent of the needed evidence and text search 43 percent: 22.1 points more, with a margin of error from 10.4 to 34.1 points. On answers the graph scored 60 percent against 48 percent, a difference that leaned the same way but did not pass the test.',
    'All of that difference came from two of the four multi-hop questions. One asks which other markets had incidents on the same platform version as a given incident. The graph follows the incident to its platform version, then back to the other incidents on that version, and found 93 percent of the evidence against 38 percent for text search. Text search found incident reports, but mostly not the ones on that version. The other asks which game mechanics the games hit by an incident use. The graph follows the incident to the games it affected, whose records list their mechanics: 54 percent against 21 percent. Text search found the incident but not the games, and its answer said "unknown" in 16 of 18 cases.',
    'On the other two multi-hop questions the graph made no difference. On one, all three found all the evidence. On the other, all three failed (see "Where none did well").',
    'The graph also helped on one question that asks for incidents of the same kind in other markets: 45 percent of the evidence against 24 percent. It found them by another route than the question implies, through incidents on the same platform version. The ontology approach took the same route and did no better (44 percent).',
    { kind: 'heading', text: 'Where the graph with the ontology did best' },
    'Questions that match a kind of thing across markets. The ontology is a shared list of business terms. It says, for example, that a Czech player segment and a British one are the same kind of segment, "low value". On these questions the graph with the ontology found 38 percent of the evidence, against 19 percent for the other two, and its answer score was 45 percent, against 24 percent for the graph. The test leaned its way on both measures but did not pass, so this is a pattern, not a finding.',
    'All of that came from one question: which player segments in other markets match a given segment. The ontology approach found 76 percent of the evidence and its answer score was 83 percent. The other two found none, and every one of their answers said "unknown". Neither graph approach could start from the segment, because segments are not among the kinds of record the graph can start from either. Both started from a player in that segment. From there the graph only reached other players. The ontology approach went from the player to the segment, from the segment to its shared kind, and from that kind to the matching segments in the other three markets.',
    "Questions that name a game family or mechanic in a local language, such as German or Greek. The ontology approach found all the needed evidence on all 36 of them (100 percent), against 78 percent for text search and 62 percent for the graph. It matched the local name to the shared kind and followed it to the same kind of family or mechanic in every market. The graph matched only the local family, then wandered into that game's support cases and incidents. These questions were not tested.",
    'Finding the evidence was not enough. On the family question the ontology approach had every needed game in front of the answer model, and the answer score was still only 52 percent. The answer model read "the kind of family called X" as that one local family, named only that market\'s game, and sometimes called the others "distinct". On the mechanic question it did better, 90 percent.',
    { kind: 'heading', text: 'Where none did well' },
    'Which platform version is behind the incident linked to a support case. All three found about a tenth of the evidence or less, and said "unknown" in 16 or 17 of 18 answers. The graph could not start from the support case. Text search found the support case but not the incident record behind it.',
    'Two planted questions need a conclusion drawn from several signals: the best game in another market to move a campaign to, and the games in other markets whose players favour the same mechanic. On the first, no approach found any of the needed evidence, and every answer said "unknown". On the second, none found more than 13 percent.',
    'The answer model sometimes did not use the evidence it had. In 24 answers from text search, 17 from the graph and 19 from the graph with the ontology, of 300 each, the needed evidence was there and the answer was still wrong. Twelve of those 19 were the local-name questions above.',
    { kind: 'heading', text: 'What to take home' },
    [
      'Text search is enough when the question names a record, or a document states the answer. All three answered single facts almost perfectly, and text search did best on them.',
      'Following links helps when the answer is two steps away along a link the data holds, such as an incident, its platform version and the other incidents on it. This is the one tested result: 22.1 more points of evidence found on multi-hop questions.',
      'A shared vocabulary helps when a question crosses markets by meaning or names something in a local language. It took matching segments from 0 to 76 percent of the evidence, and local names to 100 percent. This is a pattern seen in this run; the test did not confirm it.',
      'A graph helps only from where it can start and as far as it can walk. Questions that start from a support case or a segment, or need more than two links, gained little or lost.',
      'Graph records take room that documents would otherwise use. Over the whole run the graph approaches showed less than half as many document passages as text search, and where documents held the answer, text search did better.',
      'Finding the evidence is not the same as answering well. The answer model sometimes passed over evidence it had, or named the right thing without saying it was the answer.',
    ],
    {
      kind: 'heading',
      text: 'When you would want text, a graph, an ontology, or all three',
    },
    [
      'Text search alone: questions about one record, and answers written in documents such as reports, product specifications and rules.',
      'A graph: questions that follow links between records, such as from an incident to the games it hit, or from a support case to its incident and platform version. It must be able to start from every kind of record the questions name.',
      'An ontology on top of the graph: questions that compare markets by meaning, use local names, or ask for things "of the same kind". The shared kinds must be within reach of the walk.',
      'All three: a mix of these questions. In this run no single approach was best on every kind of question. Text search did best on single facts and planted patterns, the graph on multi-hop questions, and the graph with the ontology on questions across markets. B and C also search documents, so the choice is how to share the space between documents and graph records, not which one to keep.',
    ],
    'Limits. The company is made up, and its 22 questions were written by the people who built the system. One answer model answered each question once. The method of this run was changed after an earlier run was seen (chapter 9). Each figure for a single question rests on 6 or 18 questions, and none of those is tested.',
  ],
  plainHint:
    'The Technical level adds the figures for each of the 22 questions: wins, ties and losses, failure causes, the cases examined, and how the numbers were computed.',
  technical: [
    'Source. Run official-2026-10-29 (method 0.3.0, scorer 2.2.1, answer parser 2.1.1, commit 4c62325, clean tree): six unseen worlds 2029 to 2034, bank 2.0.0, 300 instances, one answer per approach, 900 answers, no failed answer or judge call, and no answer cut off at the output limit. The kind table is summary.json (metrics.<kind>.evidence_recall and .answer, the means of the report). The question tables were computed from results.json, read only, by a script kept outside the repository: for each instance it reads scores[p][0].evidence.recall, scores[p][0].answer, the judge correctness, the failure class, the verdict, resolved_ids against the anchor, the selected carriers against the claims and the path line of each graph block. Its per-kind means matched summary.json to the last digit, and a test checks that the per-question means here average to the kind figures.',
    'Definitions. A mean is over the instances where the score exists; evidence recall exists only where a claim survives removing the anchor, so single facts have it on 3 of 72 instances (all L02) and L01, L03 and L04 have none. Win-tie-loss is per instance: a win is the highest value alone, a tie shares the highest (all three equal included), a loss is below it. "Unknown" is a verdict that opens with the word (is_abstention). Started from the named record counts instances whose anchor is in resolved_ids. Judge correctness is 0 to 2 and descriptive only.',
    'Tests (summary.json, unchanged). Of the 14 in the family, one passed: H1 evidence recall B against A, +22.1 points (95 percent interval 10.4 to 34.1, 72 pairs in 24 groups, p 0.0022, Holm p 0.030). Five more have intervals that leave out zero and fail the test: H2 C against B evidence +18.9 (Holm 0.38) and answer +21.0 (Holm 0.28); H1 B against A answer +12.4 (Holm 0.17); H5 B against A evidence -6.9 (Holm 0.23) and answer -8.0 (Holm 1.0). The rest show no detectable difference. H2_name and every per-question figure are untested.',
    "Where each tested difference comes from, by simple means (equal to the report's comparison means, since every question in a kind has the same n): H1 B minus A evidence +22.1 = (L05 +55.1, L06 +33.2, L07 0, L08 0) / 4. H2 C minus B evidence +18.9 = (L09 0, L10 -0.2, L11 +75.9, L12 0) / 4. H5 A minus B evidence +6.9, of which L19 gives 5.2 points (76 percent); answer +8.0, of which L19 gives 5.2 (65 percent).",
    QUESTION_TABLE,
    OUTCOME_TABLE,
    'Instances examined, with what the record shows:',
    [
      'L05-2029-INC_017 and L05-2030-INC_017: B and C reached the other incidents by the path line "INC_017 -RELATED_TO_VERSION-> PLV_WEB_2 <-RELATED_TO_VERSION- INC_018"; A found none or one of them and listed every market. Over L05, A found 12 of 38 claims, B and C 32 each. The set check gives partial credit to a list that holds the right market, so A\'s answer score (0.65) sits well above its judge mark (0.83 of 2).',
      'L06-2029-INC_011, L06-2030-INC_013: B and C selected the affected game record (GAME_AT_04, GAME_UK_06), which lists the mechanic; A selected the incident and said "unknown".',
      'L07-2029-SUP_01940, SUP_02015, SUP_01417 and L19-2029/2030-SUP_02027: support cases are not starting ids (SEED_ID_PREFIXES at commit 4c62325 has no SUP_, by design), so B fell back to the best record hit, another support case (SUP_01937, SUP_00521, SUP_01277); on all 18 L07 instances C resolved only CONCEPT_INCIDENT, and with something resolved it takes no fallback (docs/retrieval.md, "Seeds"). B started from the named case in 2 of 18 (L07) and 1 of 6 (L19), C in 0 of 18 and 1 of 6. On L19, A selected the planted incident document CHNK_0257_00 in 5 of 6 and named the provider in its answer, with the verdict "unknown" in 5 of 6 and judge correctness 0 in 5 of 6; the token check reads the whole answer, so the mention scores.',
      'L09-2029-GAME_AT_05 and L12: B and C selected no FAM_, MECH_ or CONCEPT_ record; their path lines run through incidents ("GAME_AT_05 <-AFFECTS- INC_031 -AFFECTS-> GAME_AT_02"), and B and C were identical. A found 12 of its 15 L09 claims and 15 of its 18 L12 claims through passages; A showed 262 passages on L09 against 137 for B and for C. On the development world only (2026, data/evaluation/diagnostics/20261028T103824Z-selection/selection.md), C\'s graph reached needed L09 games at graph ranks 14 to 25 and the budget cut them; the official record keeps no such diagnostic.',
      'L10-2029-INC_013: B and C reached INC_004 by "INC_013 -RELATED_TO_VERSION-> PLV_RETAIL_2 <-RELATED_TO_VERSION- INC_004", not by the incident type; the only concept C resolved was CONCEPT_INCIDENT.',
      "L11-2029-SEG_CZ_USPORNI: neither B nor C resolved the segment (SEG_ is not a starting prefix); both started from PLAYER_CZ_000428. C's path lines run PLAYER, BELONGS_TO, SEG_CZ_USPORNI, the ontology link, CONCEPT_BUDGET_VALUE, the ontology link, SEG_AT_SPARSAM; B's reached only other players.",
      'L13-2029, all three anchors: C resolved the concept and the family (CONCEPT_MULTINATIONAL_JACKPOT, FAM_AT_LAENDER_JACKPOT) and reached every market\'s family and games, evidence 1.00 on 18 of 18; B resolved the family only and walked to SUP_ and INC_ records. C\'s verdicts named one game (for example "Alpen Jackpot"), and one answer called the mapped families "distinct from Αριθμολαχείο": 11 of C\'s 18 L13 answers are classed "retrieved, answer wrong".',
      'L03-2034-CMP_002: the campaign record, with "ends: 2025-10-15", was block 1 for B and C, and both answered that no end date was given. L04-2029, 2030 and 2033-GAME_AT_05: C answered "yes" for a retail-only game; CONCEPT_DIGITAL_CHANNEL was block 2 in all six GAME_AT_05 instances, the three correct ones included.',
      "L18-2029-INC_042: the set check's universe holds only the expected markets, so naming another market is not marked down; B and C named the United Kingdom as affected and still scored 1.0 on that check.",
      'L21: every answer of all three says "unknown", and no approach selected a carrier of any claim (evidence recall 0 on all 18 answers).',
    ],
    'Room in the budget: over all 900 answers A showed 1,694 passages, B 800 and C 786; B and C filled the rest with graph records under the same 2,000-token budget the run recorded.',
    'What this does not show. The why is read from what each approach selected, its starting records, its path lines and its answer text. It does not show what the graph found and the budget then cut in the official worlds. Per-question figures rest on 18 instances in 6 groups (L01 to L14) or 6 instances in 6 groups (L15 to L22), and no test was run on them.',
  ],
  terms: [
    'Answer key',
    'Answer model',
    'Answer score',
    'Detectable difference',
    'Graph walk',
    'Judge',
    'Kind of question',
    'Official run',
    'Passage',
    'Planted story',
    'Starting point',
    'Test',
    'World',
  ],
}
