/**
 * The official run's outcomes per approach, as two figures: the needed facts
 * found and missed, with the extra records brought beside each bar, and the answers
 * in three bands by score with a hatched part for the answers that said the sources could not answer.
 * Every count is in the "Show as table" twin and in each bar's text.
 */

import { ChartFigure } from '../charts/chart-figure'
import { DataTable } from '../charts/data-table'
import { pipeline } from '../design/pipelines'
import {
  answerRows,
  BAND_NAMES,
  evidenceRows,
  percent,
  type AnswerRow,
  type BandKind,
  type EvidenceRow,
  type Outcomes,
} from '../results/outcomes'

const FILL = {
  found: 'var(--color-success)',
  missed: 'var(--color-grey-300)',
  right: 'var(--color-success)',
  partly: 'var(--color-warning)',
  wrong: 'var(--color-error)',
} as const

/** Diagonal white stripes over a band: the non-colour cue for answers that said the sources could not answer. */
const HATCH =
  'repeating-linear-gradient(135deg, var(--color-surface) 0 2px, transparent 2px 6px)'

const BAR = 'flex h-5 w-full overflow-hidden rounded-chip border border-border'
const ROW =
  'grid grid-cols-1 items-center gap-x-4 gap-y-1 md:grid-cols-[11rem_minmax(0,1fr)_17rem]'

/** What an answer that abstained is called, in full and in the tight side labels and table columns. */
const CANNOT_ANSWER = 'said the sources could not answer'
const CANNOT_ANSWER_SHORT = 'could not answer'

const plural = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? '' : 's'}`

function Swatch({
  fill,
  hatched = false,
}: {
  fill: string
  hatched?: boolean
}) {
  return (
    <i
      aria-hidden
      className="inline-block h-3 w-3 rounded-[2px] border border-border"
      style={{
        backgroundColor: fill,
        backgroundImage: hatched ? HATCH : undefined,
      }}
    />
  )
}

function Key({ items }: { items: readonly [string, string, boolean?][] }) {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-text-primary">
      {items.map(([name, fill, hatched]) => (
        <li key={name} className="flex items-center gap-2">
          <Swatch fill={fill} hatched={hatched} />
          {name}
        </li>
      ))}
    </ul>
  )
}

function evidenceText(row: EvidenceRow): string {
  const { name } = pipeline(row.id)
  if (row.found === null || row.missed === null)
    return `${name}: no needed facts were scored.`
  const needed = row.foundFacts + row.missedFacts
  return `${name}: ${percent(row.found)} of the needed facts found, ${percent(row.missed)} missed. ${row.foundFacts} of ${needed} needed facts found (added up over all questions).`
}

function EvidenceFigure({ rows }: { rows: EvidenceRow[] }) {
  const table = (
    <DataTable
      caption="Evidence found and missed, per approach"
      rowHeader="Approach"
      columns={[
        'Share found',
        'Facts found',
        'Facts missed',
        'Extra records per question',
      ]}
      rows={rows.map((row) => ({
        key: row.id,
        label: pipeline(row.id).label,
        cells: [
          row.found === null ? 'No value' : percent(row.found),
          String(row.foundFacts),
          String(row.missedFacts),
          row.extra === null ? 'No value' : String(row.extra),
        ],
      }))}
    />
  )
  return (
    <ChartFigure
      title="Evidence found"
      description="Of the facts each question needed, the share each approach found and missed, averaged over questions. A fact counts as found when any chosen record or passage states it. Facts found and missed in the table are added up across all questions, so they can differ a little from the shares. Extra records state no needed fact."
      empty={rows.length === 0}
      legend={
        <Key
          items={[
            ['Found', FILL.found],
            ['Missed', FILL.missed],
          ]}
        />
      }
      plotRef={null}
      overlay={null}
      table={table}
    >
      <div className="flex flex-col gap-3">
        {rows.map((row) => (
          <div key={row.id} className={ROW}>
            <span className="text-sm font-semibold text-text-primary">
              {pipeline(row.id).label}
            </span>
            <div role="img" aria-label={evidenceText(row)}>
              <div className={BAR} data-bar>
                {row.found !== null && row.missed !== null && (
                  <>
                    <span
                      data-found
                      style={{
                        width: `${row.found * 100}%`,
                        backgroundColor: FILL.found,
                      }}
                    />
                    <span
                      style={{
                        width: `${row.missed * 100}%`,
                        backgroundColor: FILL.missed,
                      }}
                    />
                  </>
                )}
              </div>
            </div>
            <span className="tabular text-sm text-text-secondary">
              {row.found === null ? '' : `${percent(row.found)} found`}
              {row.extra !== null &&
                `, about ${plural(row.extra, 'extra record')} per question`}
            </span>
          </div>
        ))}
      </div>
    </ChartFigure>
  )
}

function answerText(row: AnswerRow): string {
  const parts = row.bands.map(
    (band) =>
      `${BAND_NAMES[band.kind].toLowerCase()} ${band.count} of ${row.scored} (${band.declined} of them ${CANNOT_ANSWER})`,
  )
  return `${pipeline(row.id).name}: ${parts.join(', ')}.`
}

function AnswerFigure({ rows }: { rows: AnswerRow[] }) {
  const notScored = rows.filter((row) => row.notScored > 0)
  const table = (
    <DataTable
      caption="Answers by score, per approach"
      rowHeader="Approach"
      columns={[
        'Scored answers',
        'Right',
        `Right, ${CANNOT_ANSWER_SHORT}`,
        'Partly right',
        `Partly right, ${CANNOT_ANSWER_SHORT}`,
        'Wrong',
        `Wrong, ${CANNOT_ANSWER_SHORT}`,
      ]}
      rows={rows.map((row) => ({
        key: row.id,
        label: pipeline(row.id).label,
        cells: [
          String(row.scored),
          ...row.bands.flatMap((band) => [
            String(band.count),
            String(band.declined),
          ]),
        ],
      }))}
    />
  )
  return (
    <ChartFigure
      title="Answers by score"
      description="Each answer is right (score 1), partly right (above 0, below 1) or wrong (0). An answer can say the sources could not answer and still score, because it named part of the answer key on the way. The hatched part of a band counts those answers."
      empty={rows.length === 0}
      legend={
        <Key
          items={[
            ['Right', FILL.right],
            ['Partly right', FILL.partly],
            ['Wrong', FILL.wrong],
            [`Hatched: ${CANNOT_ANSWER}`, FILL.wrong, true],
          ]}
        />
      }
      plotRef={null}
      overlay={null}
      table={table}
    >
      <div className="flex flex-col gap-4">
        {rows.map((row) => (
          <div key={row.id} className={ROW}>
            <span className="text-sm font-semibold text-text-primary">
              {pipeline(row.id).label}
            </span>
            <div role="img" aria-label={answerText(row)}>
              <div className={BAR} data-bar>
                {row.bands.map((band) => (
                  <span
                    key={band.kind}
                    data-band={band.kind}
                    className="relative block h-full"
                    style={{
                      width: `${band.share * 100}%`,
                      backgroundColor: FILL[band.kind as BandKind],
                    }}
                  >
                    {band.declined > 0 && (
                      <span
                        data-declined
                        className="absolute inset-y-0 right-0 border-l border-surface"
                        style={{
                          width: `${(band.declined / band.count) * 100}%`,
                          backgroundImage: HATCH,
                        }}
                      />
                    )}
                  </span>
                ))}
              </div>
            </div>
            <span className="tabular flex flex-col text-sm text-text-secondary">
              {row.bands.map((band) => (
                <span key={band.kind}>
                  {BAND_NAMES[band.kind]} {band.count}, {band.declined}{' '}
                  {CANNOT_ANSWER_SHORT}
                </span>
              ))}
            </span>
          </div>
        ))}
        {notScored.length > 0 && (
          <p className="text-sm text-text-secondary">
            {notScored
              .map(
                (row) =>
                  `${pipeline(row.id).name}: ${plural(row.notScored, 'answer')} ${row.notScored === 1 ? 'was' : 'were'} not scored and ${row.notScored === 1 ? 'is' : 'are'} outside the bands.`,
              )
              .join(' ')}
          </p>
        )}
      </div>
    </ChartFigure>
  )
}

export function OutcomeBars({ outcomes }: { outcomes: Outcomes }) {
  if (!outcomes.recorded)
    return <p className="text-text-secondary">Not recorded for this run.</p>
  return (
    <div className="flex flex-col gap-10">
      <EvidenceFigure rows={evidenceRows(outcomes)} />
      <AnswerFigure rows={answerRows(outcomes)} />
    </div>
  )
}
