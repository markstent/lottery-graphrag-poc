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
  note: 'Descriptive, not tested. Added after the result (owner, 2026-11-02).',
  answerScore: 'With the answer score',
  eachOther: 'With each other',
  labels: 'With the hand labels, on a sample of answers',
} as const

const SPLITS = ['answered', 'abstained'] as const

/**
 * The label measure shown: the second judge's. The label check also scores
 * the judge that first marked the sample, which is not the first judge of a
 * run the site shows, so it is left out (D-104).
 */
const LABEL_MEASURES = ['second_judge'] as const

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
 * The second judge's agreement with the hand labels, named as the label check
 * names it; null when the second judge has no label check.
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

/**
 * The two judge models, first then second; the second names its reply limit
 * when it differs from the first judge's, the one setting that may (D-100).
 */
export function judgeModels(data: SecondJudge): [string, string][] {
  const { first_judge: first, second_judge: second } = data.run
  const limit =
    second.max_tokens === first.max_tokens
      ? ''
      : `, reply limit ${second.max_tokens.toLocaleString('en-GB')} tokens`
  return [
    [SECOND_JUDGE.first, first.model ?? '-'],
    [SECOND_JUDGE.title, second.model + limit],
  ]
}
