/**
 * What the outcome views draw, from the counts the API serves for a run.
 * Evidence bars come from the per-question share found, the figure published
 * everywhere else; the pooled counts are for the table and the text only.
 */

import type { Schemas } from '../api/client'
import { PIPELINES, type PipelineId } from '../design/pipelines'

export type Outcomes = Schemas['RunOutcomesOut']

export interface EvidenceRow {
  id: PipelineId
  /** Average share of the needed facts (claims) found, over questions; null where nothing was scored. */
  found: number | null
  missed: number | null
  foundFacts: number
  missedFacts: number
  /** Average extra records per question, rounded, or null. */
  extra: number | null
}

export type BandKind = 'right' | 'partly' | 'wrong'

export interface Band {
  kind: BandKind
  count: number
  declined: number
  /** Share of all scored answers. */
  share: number
  /** The declined part's share of all scored answers; never above `share`. */
  declinedShare: number
}

export interface AnswerRow {
  id: PipelineId
  scored: number
  notScored: number
  /** The mean answer score per scored answer, (right + partly_score_sum) / scored; null when none was scored. */
  score: number | null
  bands: Band[]
}

export const BAND_NAMES: Record<BandKind, string> = {
  right: 'Right',
  partly: 'Partly right',
  wrong: 'Wrong',
}

export const percent = (share: number): string =>
  `${Math.round(share * 100)} percent`

export function evidenceRows({ evidence }: Outcomes): EvidenceRow[] {
  return PIPELINES.flatMap(({ id }) => {
    const cell = evidence[id]
    if (!cell) return []
    const share = cell.found_share
    return [
      {
        id,
        found: share,
        missed: share === null ? null : 1 - share,
        foundFacts: cell.found,
        missedFacts: cell.missed,
        extra:
          cell.extra_per_question === null
            ? null
            : Math.round(cell.extra_per_question),
      },
    ]
  })
}

export function answerRows({ answers }: Outcomes): AnswerRow[] {
  return PIPELINES.flatMap(({ id }) => {
    const cell = answers[id]
    if (!cell) return []
    const of = (count: number) => (cell.scored > 0 ? count / cell.scored : 0)
    const band = (kind: BandKind, count: number, declined: number): Band => ({
      kind,
      count,
      declined,
      share: of(count),
      declinedShare: of(declined),
    })
    return [
      {
        id,
        scored: cell.scored,
        notScored: cell.not_scored,
        score:
          cell.scored > 0
            ? (cell.right + cell.partly_score_sum) / cell.scored
            : null,
        bands: [
          band('right', cell.right, cell.right_declined),
          band('partly', cell.partly, cell.partly_declined),
          band('wrong', cell.wrong, cell.wrong_declined),
        ],
      },
    ]
  })
}
