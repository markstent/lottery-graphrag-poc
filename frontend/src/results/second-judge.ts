/**
 * The rows of the Second judge panel (D-100): a second model's judgement of
 * the same stored answers, a recorded second opinion beside the first judge.
 * Descriptive; it is no part of the tested result.
 */

import type { Schemas } from '../api/client'
import type { DataTableRow } from '../charts/data-table'
import { agreementCells } from './strata'

type SecondJudge = Schemas['SecondJudgeOut']
type Split = Schemas['AgreementSplitOut']

export const SECOND_JUDGE = {
  title: 'Second judge',
  first: 'First judge',
  note: 'Descriptive, not part of the test. Added after the result (owner, 2026-11-02).',
  answerScore: 'With the answer score',
  eachOther: 'With each other',
  labels: 'With the hand labels',
} as const

const SPLITS = ['answered', 'abstained'] as const

/** The label measures shown, in order: the first judge as recorded and with its rule, then the second. */
const LABEL_MEASURES = [
  'judge_recorded',
  'judge_abstention_rule',
  'second_judge',
] as const

const capitalised = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1)

const cellsOf = (cell: Schemas['AgreementOut']) =>
  agreementCells({ ...cell, kappa: cell.weighted_kappa })

/** Each judge's agreement with the answer score, over all approaches, answered then abstained. */
export function answerScoreRows(data: SecondJudge): DataTableRow[] {
  const { first, second } = data.run.agreement_with_answer_level
  const judges: [string, Split][] = [
    [SECOND_JUDGE.first, first.overall],
    [SECOND_JUDGE.title, second.overall],
  ]
  return judges.flatMap(([judge, split]) =>
    SPLITS.map((answers) => ({
      key: `${judge}-${answers}`,
      label: `${judge}, ${answers}`,
      cells: cellsOf(split[answers]),
    })),
  )
}

/** How often the two judges give the same correctness level, answered then abstained. */
export function eachOtherRows(data: SecondJudge): DataTableRow[] {
  const between = data.run.agreement_between_judges
  return SPLITS.map((answers) => ({
    key: answers,
    label: capitalised(answers),
    cells: cellsOf(between[answers]),
  }))
}

/**
 * Each judge's agreement with the hand labels, named as the label check names
 * its measures; null when the second judge has no label check.
 */
export function labelRows(data: SecondJudge): DataTableRow[] | null {
  if (!data.labels) return null
  const { measures, overall } = data.labels.agreement_with_labels
  return LABEL_MEASURES.flatMap((measure) => {
    const found = overall[measure]
    if (!found) return []
    return [
      {
        key: measure,
        label: capitalised(measures[measure] ?? measure),
        cells: cellsOf(found),
      },
    ]
  })
}

/** The two judge models, first then second. */
export function judgeModels(data: SecondJudge): [string, string][] {
  return [
    [SECOND_JUDGE.first, data.run.first_judge.model ?? '-'],
    [SECOND_JUDGE.title, data.run.second_judge.model],
  ]
}
