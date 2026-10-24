/**
 * The verdict across the top when a run completes: for each pipeline, whether
 * it answered correctly, how much of the needed evidence it found, which
 * markets it reached, how long it took and how much context it used, with the
 * change against A and, for a bank question, the one-line reason. Every value
 * comes from the run's stored results (score.ts). A question with no answer
 * key shows the measurable items only.
 */

import type { ReactNode } from 'react'

import type { Schemas } from '../../api/client'
import { answerWords, evidenceScore } from '../../app/score-words'
import { PIPELINES, type PipelineId } from '../../design/pipelines'
import { MARKETS } from '../../run/coverage'
import { formatWorkTime } from './format'
import {
  delta,
  deltaWords,
  scorecard,
  type DeltaKind,
  type ScoreColumn,
} from './score'

const MISSING = 'Missing'
const percent = (value: number | null) =>
  value === null ? MISSING : `${Math.round(value * 100)}%`
const yesNo = (value: number | null) =>
  value === null
    ? MISSING
    : value >= 1
      ? 'Yes'
      : value <= 0
        ? 'No'
        : percent(value)
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

interface Row {
  name: string
  /** A column that needs room for a sentence. */
  wide?: boolean
  /** Columns of the score itself are left out of an unscored card. */
  scoreOnly: boolean
  show: (column: ScoreColumn) => string
  /** The number the delta against A is taken from, with how to say it. */
  measure?: { kind: DeltaKind; value: (column: ScoreColumn) => number | null }
}

const ROWS: Row[] = [
  {
    name: 'Answer',
    scoreOnly: true,
    show: (c) => answerWords(c.answer),
  },
  {
    name: 'Evidence score',
    scoreOnly: true,
    show: (c) => evidenceScore(c.evidenceF1),
    measure: { kind: 'score', value: (c) => c.evidenceF1 },
  },
  {
    name: 'Starting record',
    scoreOnly: true,
    show: (c) => yesNo(c.anchorResolution),
  },
  {
    name: 'Markets reached',
    scoreOnly: false,
    show: (c) => `${c.markets} of ${MARKETS.length}`,
    measure: { kind: 'markets', value: (c) => c.markets },
  },
  {
    // The model's time to write the answer, not the pipeline's wall-clock time.
    name: 'Answer writing time',
    scoreOnly: false,
    show: (c) => formatWorkTime(c.latencyMs),
    measure: { kind: 'time', value: (c) => c.latencyMs },
  },
  {
    name: 'Context size',
    scoreOnly: false,
    show: (c) => `${c.contextTokens.toLocaleString('en-GB')} tokens`,
    measure: { kind: 'tokens', value: (c) => c.contextTokens },
  },
  {
    name: 'Reason',
    wide: true,
    scoreOnly: true,
    show: (c) =>
      c.failure === null ? 'No failure recorded' : sentence(c.failure),
  },
]

function Cell({
  row,
  id,
  column,
  base,
}: {
  row: Row
  id: PipelineId
  column: ScoreColumn | null
  base: ScoreColumn | null
}) {
  if (column === null)
    return (
      <td className="px-3 py-1">
        <span className="text-text-muted">No result</span>
      </td>
    )
  const change =
    id === 'A' || !row.measure || base === null
      ? null
      : deltaWords(
          row.measure.kind,
          delta(row.measure.value(column), row.measure.value(base)),
        )
  const missing = row.show(column) === MISSING
  return (
    <td className="px-3 py-1 align-top leading-tight">
      <span
        className={`tabular ${missing ? 'text-text-muted' : 'font-medium text-text-primary'}`}
      >
        {row.show(column)}
      </span>
      {change !== null && (
        <span className="block text-sm whitespace-nowrap text-text-secondary">
          {change}
        </span>
      )}
    </td>
  )
}

function Note({ children }: { children: ReactNode }) {
  return <p className="px-4 py-2 text-sm text-text-secondary">{children}</p>
}

export function Scorecard({ results }: { results: Schemas['QueryResults'] }) {
  const card = scorecard(results)
  const rows = ROWS.filter((row) => card.scored || !row.scoreOnly)
  return (
    <section
      aria-label="Scorecard"
      className="overflow-hidden rounded-card border border-hairline bg-surface"
    >
      <table className="w-full table-fixed text-left text-sm">
        <thead>
          <tr>
            <td className="w-72 px-3 py-1 text-sm font-medium leading-tight text-text-primary">
              {card.scored ? card.label : null}
            </td>
            {rows.map((row) => (
              <th
                key={row.name}
                scope="col"
                className={`px-3 py-1 font-medium leading-tight text-text-secondary ${row.wide ? 'w-[26%]' : ''}`}
              >
                {row.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline">
          {PIPELINES.map(({ id, label, tint, strong }) => (
            <tr key={id}>
              <th
                scope="row"
                className="px-3 py-1 align-top text-base font-semibold leading-tight"
                style={{ backgroundColor: tint, color: strong }}
              >
                {label}
              </th>
              {rows.map((row) => (
                <Cell
                  key={row.name}
                  row={row}
                  id={id}
                  column={card.columns[id]}
                  base={card.columns.A}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!card.scored && <Note>{unscoredNote(results)}</Note>}
    </section>
  )
}

function unscoredNote({
  answer_key,
  score_status,
}: Schemas['QueryResults']): string {
  if (answer_key === 'none') return 'No answer key exists for this question.'
  return score_status === 'failed'
    ? 'Scoring failed for this run.'
    : 'Scoring has not finished.'
}
