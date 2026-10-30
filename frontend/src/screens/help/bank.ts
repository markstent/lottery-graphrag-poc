/**
 * What Help reads from the API beyond its own words: the question bank, the
 * scenario titles and the newest run, which says whether the scores may be
 * shown. The backend scores the bank from the newest whole-bank official run;
 * a scored question is shown only when the newest run is that kind of run too.
 */

import {
  getBenchmarkQuestions,
  getScenarios,
  type Schemas,
} from '../../api/client'
import type { Load } from '../../app/use-load'
import { isFullOfficial } from '../../app/latest-run'

export type Question = Schemas['QuestionOut']
export type Scenario = Schemas['ScenarioOut']

export interface Bank {
  questions: Question[]
  scenarios: Scenario[]
}

export async function loadBank(signal: AbortSignal): Promise<Bank> {
  const [questions, scenarios] = await Promise.all([
    getBenchmarkQuestions(undefined, signal),
    getScenarios(signal),
  ])
  return { questions, scenarios }
}

/**
 * Whether the questions' scores may be shown: only when the newest run is a
 * whole-bank official run and scored some question. `elsewhere` is such a
 * run that scored none of these questions, as one on other worlds does.
 * `unreadable` is a newest run that could not be read, which hides scores
 * but not the questions.
 */
export type ScoreState =
  'shown' | 'none' | 'elsewhere' | 'unreadable' | 'loading'

export function scoreState(
  latest: Load<Schemas['BenchmarkSummary'] | null>,
  bank: Load<Bank>,
): ScoreState {
  if (latest.status === 'error') return 'unreadable'
  if (latest.status === 'loading') return 'loading'
  if (bank.status !== 'ready') return 'none'
  if (latest.data === null || !isFullOfficial(latest.data)) return 'none'
  return bank.data.questions.some((question) => question.scores !== null)
    ? 'shown'
    : 'elsewhere'
}

/** The kinds of question, in the words of the statistics page. */
export const STRATUM_NAMES: Record<string, string> = {
  H1: 'Multi-hop',
  H2: 'Ontology-dependent',
  H3: 'Single fact',
  H5: 'Planted pattern',
}
