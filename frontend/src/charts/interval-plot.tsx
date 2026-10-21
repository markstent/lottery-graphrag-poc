/**
 * One row per comparison: the given mean as a dot and the given interval as a
 * line, against a vertical zero line. Rows say how many pairs in how many
 * groups stand behind them. The chart draws what it is given and computes no
 * statistic.
 */

import { pipeline, type PipelineId } from '../design/pipelines'
import { TOKENS } from '../design/tokens'
import { ChartFigure, type ChartStateProps } from './chart-figure'
import { DataTable } from './data-table'
import { Legend } from './legend'
import {
  extent,
  formatNumber,
  formatTick,
  linearScale,
  niceTicks,
  pairsInGroups,
  wrapText,
  type Domain,
} from './scale'
import { useMarkTips, type TipContent } from './tooltip'

export interface IntervalRow {
  key: string
  label: string
  /** Any of mean, low and high may be null: null is a gap, never zero. */
  mean: number | null
  low: number | null
  high: number | null
  n: number
  groups: number
  inFamily: boolean
  /** Why a row is outside the tested family, in the words the summary gives. */
  note?: string
  /** The pipeline the row is about, for its colour and letter. */
  pipeline?: PipelineId
}

export interface IntervalPlotProps extends ChartStateProps {
  title: string
  description?: string
  rows: readonly IntervalRow[]
  unit: string
  zero: boolean
  /** Defaults to the span of the drawn values, widened to include zero. */
  domain?: Domain
  width?: number
  decimals?: number
}

const FALLBACK_WIDTH = 880
const ROW = 56
const TOP = 16
const AXIS = 48
const CHAR_PX = 6.4
const LABEL_MAX = 220
const GUTTER = 16
const DOT = 5
const TICK_COUNT = 6
const FALLBACK_DOMAIN: Domain = [-1, 1]

export function IntervalPlot({
  title,
  description,
  rows,
  unit,
  zero,
  domain,
  width: fixedWidth,
  decimals = 1,
  status,
  error,
  disabled = false,
}: IntervalPlotProps) {
  const {
    hostRef,
    width: measured,
    tooltip,
    markProps,
  } = useMarkTips(rows.length, disabled)
  const width = fixedWidth ?? measured ?? FALLBACK_WIDTH
  const fmt = (v: number) => formatNumber(v, { decimals, signed: true })
  const drawnInterval = (r: IntervalRow) => r.low !== null && r.high !== null
  const drawn = rows.flatMap((r) => [
    r.mean,
    drawnInterval(r) ? r.low : null,
    drawnInterval(r) ? r.high : null,
  ])
  const found = extent(zero ? [...drawn, 0] : drawn)
  const span = found && found[0] !== found[1] ? found : FALLBACK_DOMAIN
  const [lo, hi] = domain ?? span
  const ticks = niceTicks([lo, hi], TICK_COUNT)
  const bounds: Domain = [
    Math.min(lo, ticks[0] ?? lo),
    Math.max(hi, ticks[ticks.length - 1] ?? hi),
  ]
  const labelW = Math.min(
    LABEL_MAX,
    Math.max(...rows.map((r) => r.label.length), 8) * CHAR_PX + 8,
  )
  const countW =
    Math.max(...rows.map((r) => pairsInGroups(r.n, r.groups).length), 8) *
      CHAR_PX +
    8
  const plot = {
    left: labelW + GUTTER,
    right: width - countW - GUTTER,
    top: TOP,
    bottom: TOP + rows.length * ROW,
  }
  const x = linearScale(bounds, [plot.left, plot.right])
  const height = plot.bottom + AXIS
  const series = (['A', 'B', 'C'] as const).filter((id) =>
    rows.some((r) => r.pipeline === id),
  )

  function describe(row: IntervalRow): TipContent {
    const none = row.mean === null && !drawnInterval(row)
    return {
      title: row.label,
      rows: [
        {
          pipeline: row.pipeline,
          value: row.mean === null ? 'no value' : fmt(row.mean),
          label: 'mean',
        },
        ...(drawnInterval(row)
          ? [
              {
                value: `${fmt(row.low as number)} to ${fmt(row.high as number)}`,
                label: 'interval',
              },
            ]
          : none
            ? []
            : [{ value: 'no value', label: 'interval' }]),
        {
          value: pairsInGroups(row.n, row.groups),
          label: row.inFamily ? 'tested' : (row.note ?? 'not tested'),
        },
      ],
    }
  }

  const given = (v: number | null) => (v === null ? 'no value' : fmt(v))
  const table = (
    <DataTable
      caption={`${title}, ${unit}`}
      rowHeader="Comparison"
      columns={['Mean', 'Low', 'High', 'Pairs', 'Status']}
      rows={rows.map((r) => ({
        key: r.key,
        label: r.label,
        cells: [
          given(r.mean),
          given(r.low),
          given(r.high),
          pairsInGroups(r.n, r.groups),
          r.inFamily ? 'tested' : (r.note ?? 'not tested'),
        ],
      }))}
    />
  )

  return (
    <ChartFigure
      title={title}
      description={description}
      status={status}
      error={error}
      disabled={disabled}
      empty={rows.length === 0}
      legend={<Legend series={series} />}
      plotRef={hostRef}
      overlay={tooltip}
      table={table}
    >
      <svg
        role="img"
        aria-label={title}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ maxWidth: '100%', height: 'auto' }}
        fontFamily={TOKENS['font-sans']}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              data-grid={t}
              x1={x(t)}
              x2={x(t)}
              y1={plot.top}
              y2={plot.bottom}
              stroke={TOKENS['color-hairline']}
              strokeWidth={1}
            />
            <text
              x={x(t)}
              y={plot.bottom + 16}
              textAnchor="middle"
              fontSize={12}
              className="tabular"
              fill={TOKENS['color-text-muted']}
            >
              {formatTick(t)}
            </text>
          </g>
        ))}
        <text
          x={(plot.left + plot.right) / 2}
          y={plot.bottom + 36}
          textAnchor="middle"
          fontSize={12}
          fill={TOKENS['color-text-muted']}
        >
          {unit}
        </text>
        {zero ? (
          <line
            data-mark="zero"
            x1={x(0)}
            x2={x(0)}
            y1={plot.top}
            y2={plot.bottom}
            stroke={TOKENS['color-grey-500']}
            strokeWidth={1}
          />
        ) : null}
        {rows.map((row, i) => (
          <rect
            key={`hit-${row.key}`}
            data-mark="hit"
            className="chart-hit"
            style={
              row.pipeline
                ? { ['--chart-lift' as string]: pipeline(row.pipeline).tint }
                : undefined
            }
            x={0}
            y={plot.top + i * ROW}
            width={width}
            height={ROW}
            {...markProps(
              i,
              `${row.label}: ${row.mean === null ? 'no value' : fmt(row.mean)}`,
              describe(row),
            )}
          />
        ))}
        {rows.map((row, i) => {
          const cy = plot.top + i * ROW + ROW / 2
          const colour = !row.inFamily
            ? TOKENS['color-grey-500']
            : row.pipeline
              ? pipeline(row.pipeline).hue
              : TOKENS['color-grey-800']
          const hasInterval = drawnInterval(row)
          const nothing = row.mean === null && !hasInterval
          const left = hasInterval
            ? x(row.low as number)
            : row.mean === null
              ? 0
              : x(row.mean)
          return (
            <g key={row.key} pointerEvents="none">
              {wrapText(row.label, Math.floor(labelW / CHAR_PX), 2).map(
                (line, l, all) => (
                  <text
                    key={line}
                    x={0}
                    y={cy + 4 + (l - (all.length - 1) / 2) * 15}
                    fontSize={13}
                    fill={TOKENS['color-text-primary']}
                  >
                    {line}
                  </text>
                ),
              )}
              {[
                pairsInGroups(row.n, row.groups),
                ...(row.inFamily || !row.note
                  ? []
                  : wrapText(row.note, Math.floor(countW / CHAR_PX), 2)),
              ].map((line, l, all) => (
                <text
                  key={line}
                  x={plot.right + GUTTER}
                  y={cy + 4 + (l - (all.length - 1) / 2) * 15}
                  fontSize={12}
                  className={l === 0 ? 'tabular' : undefined}
                  fill={TOKENS['color-text-muted']}
                >
                  {line}
                </text>
              ))}
              {nothing ? (
                <text
                  x={x(0) + 8}
                  y={cy + 4}
                  textAnchor="start"
                  fontSize={12}
                  fill={TOKENS['color-text-muted']}
                >
                  no value
                </text>
              ) : (
                <g
                  data-mark="interval"
                  data-row={row.key}
                  data-x-low={hasInterval ? x(row.low as number) : undefined}
                  data-x-high={hasInterval ? x(row.high as number) : undefined}
                  data-x-mean={row.mean === null ? undefined : x(row.mean)}
                >
                  {hasInterval ? (
                    <line
                      x1={x(row.low as number)}
                      x2={x(row.high as number)}
                      y1={cy}
                      y2={cy}
                      stroke={colour}
                      strokeWidth={2}
                      strokeLinecap="round"
                    />
                  ) : null}
                  {row.mean === null ? null : (
                    <circle
                      data-mark="mean"
                      data-row={row.key}
                      data-tested={row.inFamily}
                      cx={x(row.mean)}
                      cy={cy}
                      r={DOT}
                      fill={row.inFamily ? colour : TOKENS['color-surface']}
                      stroke={row.inFamily ? TOKENS['color-surface'] : colour}
                      strokeWidth={2}
                    />
                  )}
                  {row.pipeline ? (
                    <text
                      x={left - 10}
                      y={cy + 4}
                      textAnchor="end"
                      fontSize={11}
                      fontWeight={600}
                      fill={TOKENS['color-text-secondary']}
                      stroke={TOKENS['color-surface']}
                      strokeWidth={3}
                      paintOrder="stroke"
                    >
                      {row.pipeline}
                    </text>
                  ) : null}
                </g>
              )}
            </g>
          )
        })}
      </svg>
    </ChartFigure>
  )
}
