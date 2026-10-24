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
import { isFullOfficial, loadLatest } from '../overview/latest-run'

export type Question = Schemas['QuestionOut']
export type Scenario = Schemas['ScenarioOut']

export interface Bank {
  questions: Question[]
  scenarios: Scenario[]
  /** Whether the scores belong to a whole-bank official run. */
  scored: boolean
}

export async function loadBank(signal: AbortSignal): Promise<Bank> {
  const [questions, scenarios, latest] = await Promise.all([
    getBenchmarkQuestions(undefined, signal),
    getScenarios(signal),
    loadLatest(signal),
  ])
  return {
    questions,
    scenarios,
    scored:
      latest !== null &&
      isFullOfficial(latest) &&
      questions.some((question) => question.scores !== null),
  }
}

/** The kinds of question, in the words of the statistics page. */
export const STRATUM_NAMES: Record<string, string> = {
  H1: 'Multi-hop',
  H2: 'Ontology',
  H3: 'Single fact',
  H5: 'Planted pattern',
}
