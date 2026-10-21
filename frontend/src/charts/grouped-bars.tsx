/**
 * Grouped columns, one group per question type or stratum and one column per
 * pipeline in the fixed order A, B, C, on one axis. Every number, interval and
 * delta is drawn as it was given: this chart computes nothing.
 */

import { PIPELINES, pipeline, type PipelineId } from '../design/pipelines'
import { TOKENS } from '../design/tokens'
import { ChartFigure, type ChartStateProps } from './chart-figure'
import { DataTable } from './data-table'
import { Legend } from './legend'
import {
  decimalsFor,
  formatNumber,
  formatTick,
  linearScale,
  niceTicks,
  wrapText,
  type Domain,
} from './scale'
import { useMarkTips, type TipContent, type TipRow } from './tooltip'

export interface BarGroup {
  key: string
  label: string
  /** A pipeline absent from every group is not a series; null is a gap. */
  values: Partial<Record<PipelineId, number | null>>
}

export interface GroupedBarsProps extends ChartStateProps {
  title: string
  description?: string
  groups: readonly BarGroup[]
  /** Given low and high per group key and pipeline. */
  intervals?: Record<
    string,
    Partial<Record<PipelineId, readonly [number, number]>>
  >
  /** "X vs Y" and, per group key, the delta as given (X minus Y); drawn between the X and Y columns. */
  delta?: {
    between: readonly [PipelineId, PipelineId]
    values: Record<string, number | null | undefined>
  }
  unit: string
  domain: Domain
  width?: number
  height?: number
  decimals?: number
}

const MARGIN = { top: 52, right: 16, left: 48 }
const FALLBACK_WIDTH = 720
const MAX_BAR = 24
const GAP = 2
const RADIUS = 4
const LABEL_LINE = 14
const LABEL_LINES = 3
const AXIS_BAND = 16
const CHAR_PX = 6.4
const TICK_COUNT = 5
const GROUP_FILL = 0.7

interface Bar {
  group: BarGroup
  series: PipelineId
  value: number | null
  index: number
}

export function GroupedBars({
  title,
  description,
  groups,
  intervals,
  delta,
  unit,
  domain,
  width: fixedWidth,
  height = 360,
  decimals,
  status,
  error,
  disabled = false,
}: GroupedBarsProps) {
  const places = decimals ?? decimalsFor(domain)
  const fmt = (v: number, signed = false) =>
    formatNumber(v, { decimals: places, signed })
  const series = PIPELINES.map((p) => p.id).filter((id) =>
    groups.some((g) => id in g.values),
  )
  const bars: Bar[] = groups.flatMap((group, g) =>
    series.map((id, s) => ({
      group,
      series: id,
      value: group.values[id] ?? null,
      index: g * series.length + s,
    })),
  )
  const {
    hostRef,
    width: measured,
    tooltip,
    markProps,
  } = useMarkTips(bars.length, disabled)
  const width = fixedWidth ?? measured ?? FALLBACK_WIDTH

  const lines = Math.max(
    1,
    ...groups.map(
      (g) =>
        wrapText(g.label, labelChars(width, groups.length), LABEL_LINES).length,
    ),
  )
  const bottom = AXIS_BAND + 12 + lines * LABEL_LINE
  const plot = {
    left: MARGIN.left,
    right: width - MARGIN.right,
    top: MARGIN.top,
    bottom: height - bottom,
  }
  const lo = Math.min(domain[0], 0)
  const hi = Math.max(domain[1], 0)
  const ticks = niceTicks([lo, hi], TICK_COUNT)
  const y = linearScale([lo, hi], [plot.bottom, plot.top])
  const base = y(0)
  const band = (plot.right - plot.left) / Math.max(groups.length, 1)
  const step = Math.min(
    MAX_BAR + GAP,
    (band * GROUP_FILL) / Math.max(series.length, 1),
  )
  const barX = (g: number, s: number) =>
    plot.left +
    g * band +
    (band - step * series.length) / 2 +
    s * step +
    GAP / 2
  const barW = step - GAP
  const showLetters = series.length <= 4

  function describe(bar: Bar): TipContent {
    const range = intervals?.[bar.group.key]?.[bar.series]
    const rows: TipRow[] = [
      {
        pipeline: bar.series,
        value: bar.value === null ? 'no value' : fmt(bar.value),
        label: pipeline(bar.series).label,
      },
    ]
    if (range)
      rows.push({
        value: `${fmt(range[0])} to ${fmt(range[1])}`,
        label: 'interval',
      })
    return { title: bar.group.label, rows }
  }

  const intervalSeries = series.filter((id) =>
    groups.some((g) => intervals?.[g.key]?.[id]),
  )
  const table = (
    <DataTable
      caption={`${title}, ${unit}`}
      rowHeader="Group"
      columns={[
        ...series.map((id) => pipeline(id).label),
        ...intervalSeries.map((id) => `${pipeline(id).label} interval`),
        ...(delta ? [`${delta.between[0]} vs ${delta.between[1]}`] : []),
      ]}
      rows={groups.map((g) => {
        const given = delta?.values[g.key]
        return {
          key: g.key,
          label: g.label,
          cells: [
            ...series.map((id) => cell(g.values[id], fmt)),
            ...intervalSeries.map((id) => {
              const r = intervals?.[g.key]?.[id]
              return r ? `${fmt(r[0])} to ${fmt(r[1])}` : 'no value'
            }),
            ...(delta
              ? [typeof given === 'number' ? fmt(given, true) : 'no value']
              : []),
          ],
        }
      })}
    />
  )

  return (
    <ChartFigure
      title={title}
      description={description}
      status={status}
      error={error}
      disabled={disabled}
      empty={groups.length === 0}
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
        <text x={0} y={12} fontSize={12} fill={TOKENS['color-text-muted']}>
          {unit}
        </text>
        {ticks.map((t) => (
          <g key={t}>
            <line
              data-grid={t}
              x1={plot.left}
              x2={plot.right}
              y1={y(t)}
              y2={y(t)}
              stroke={TOKENS['color-hairline']}
              strokeWidth={1}
            />
            <text
              x={plot.left - 8}
              y={y(t) + 4}
              textAnchor="end"
              fontSize={12}
              className="tabular"
              fill={TOKENS['color-text-muted']}
            >
              {formatTick(t)}
            </text>
          </g>
        ))}
        {bars.map((bar) => {
          const g = groups.indexOf(bar.group)
          const s = series.indexOf(bar.series)
          const x = barX(g, s)
          const end = bar.value === null ? base : y(bar.value)
          const top = Math.min(base, end)
          // Taller than the mark, but never over the letters under the baseline.
          const below = bar.value !== null && end > base
          const hitTop = bar.value === null ? base - 28 : below ? base : top - 8
          const hitHeight = bar.value === null ? 28 : Math.abs(end - base) + 8
          return (
            <rect
              key={`hit-${bar.group.key}-${bar.series}`}
              data-mark="hit"
              className="chart-hit"
              style={{ ['--chart-lift' as string]: pipeline(bar.series).tint }}
              x={x - GAP / 2}
              y={hitTop}
              width={step}
              height={hitHeight}
              {...markProps(
                bar.index,
                `${bar.group.label}, ${pipeline(bar.series).label}: ${bar.value === null ? 'no value' : fmt(bar.value)}`,
                describe(bar),
              )}
            />
          )
        })}
        {bars.map((bar) => {
          const g = groups.indexOf(bar.group)
          const s = series.indexOf(bar.series)
          const x = barX(g, s)
          const cx = x + barW / 2
          const range = intervals?.[bar.group.key]?.[bar.series]
          if (bar.value === null) {
            return (
              <text
                key={`gap-${bar.group.key}-${bar.series}`}
                transform={`rotate(-90 ${cx} ${base - 6})`}
                x={cx}
                y={base - 6 + 4}
                fontSize={11}
                fill={TOKENS['color-text-muted']}
                pointerEvents="none"
              >
                no value
              </text>
            )
          }
          const end = y(bar.value)
          return (
            <g key={`bar-${bar.group.key}-${bar.series}`} pointerEvents="none">
              <path
                data-mark="bar"
                data-group={bar.group.key}
                data-series={bar.series}
                data-x={x}
                data-width={barW}
                data-top={Math.min(base, end)}
                data-bottom={Math.max(base, end)}
                d={barPath(x, barW, base, end)}
                fill={pipeline(bar.series).hue}
              />
              {range ? (
                <Whisker
                  group={bar.group.key}
                  series={bar.series}
                  cx={cx}
                  low={y(range[0])}
                  high={y(range[1])}
                />
              ) : null}
            </g>
          )
        })}
        <line
          x1={plot.left}
          x2={plot.right}
          y1={base}
          y2={base}
          stroke={TOKENS['color-grey-400']}
          strokeWidth={1}
        />
        {delta
          ? groups.map((group, g) => {
              const given = delta.values[group.key]
              const [first, second] = delta.between
              const a = series.indexOf(first)
              const b = series.indexOf(second)
              if (typeof given !== 'number' || a < 0 || b < 0) return null
              if (group.values[first] == null || group.values[second] == null)
                return null
              const tops = bars
                .filter((bar) => bar.group === group && bar.value !== null)
                .map((bar) => {
                  const range = intervals?.[group.key]?.[bar.series]
                  return Math.min(
                    base,
                    y(bar.value as number),
                    range ? y(range[1]) : base,
                  )
                })
              const by = Math.min(...tops) - 14
              const x1 = barX(g, a) + barW / 2
              const x2 = barX(g, b) + barW / 2
              return (
                <g key={`delta-${group.key}`} pointerEvents="none">
                  <path
                    data-mark="delta"
                    data-group={group.key}
                    data-x1={x1}
                    data-x2={x2}
                    d={`M${x1} ${by + 6}V${by}H${x2}V${by + 6}`}
                    fill="none"
                    stroke={TOKENS['color-grey-700']}
                    strokeWidth={1.5}
                  />
                  <text
                    x={(x1 + x2) / 2}
                    y={by - 6}
                    textAnchor="middle"
                    fontSize={12}
                    fontWeight={600}
                    className="tabular"
                    fill={TOKENS['color-text-primary']}
                  >
                    {fmt(given, true)}
                  </text>
                </g>
              )
            })
          : null}
        {groups.map((group, g) => (
          <g key={`label-${group.key}`} pointerEvents="none">
            {showLetters
              ? series.map((id, s) => (
                  <text
                    key={id}
                    data-mark="letter"
                    x={barX(g, s) + barW / 2}
                    y={plot.bottom + 14}
                    textAnchor="middle"
                    fontSize={11}
                    fontWeight={600}
                    fill={TOKENS['color-text-secondary']}
                  >
                    {id}
                  </text>
                ))
              : null}
            {wrapText(
              group.label,
              labelChars(width, groups.length),
              LABEL_LINES,
            ).map((line, i) => (
              <text
                key={line}
                x={plot.left + g * band + band / 2}
                y={plot.bottom + AXIS_BAND + 14 + i * LABEL_LINE}
                textAnchor="middle"
                fontSize={12}
                fill={TOKENS['color-text-primary']}
              >
                {line}
              </text>
            ))}
          </g>
        ))}
      </svg>
    </ChartFigure>
  )
}

function Whisker({
  group,
  series,
  cx,
  low,
  high,
}: {
  group: string
  series: PipelineId
  cx: number
  low: number
  high: number
}) {
  const d = `M${cx} ${low}V${high}M${cx - 4} ${low}H${cx + 4}M${cx - 4} ${high}H${cx + 4}`
  return (
    <g
      data-mark="interval"
      data-group={group}
      data-series={series}
      data-y-low={low}
      data-y-high={high}
      fill="none"
    >
      <path d={d} stroke={TOKENS['color-surface']} strokeWidth={4} />
      <path d={d} stroke={TOKENS['color-text-primary']} strokeWidth={1.5} />
    </g>
  )
}

function labelChars(width: number, groups: number): number {
  return Math.max(
    6,
    Math.floor(
      ((width - MARGIN.left - MARGIN.right) / Math.max(groups, 1) - 8) /
        CHAR_PX,
    ),
  )
}

function cell(
  value: number | null | undefined,
  fmt: (v: number) => string,
): string {
  return typeof value === 'number' ? fmt(value) : 'no value'
}

/** A column from the baseline to `end`, rounded at the data end only. */
function barPath(x: number, w: number, base: number, end: number): string {
  const h = Math.abs(end - base)
  if (h === 0) return ''
  const r = Math.min(RADIUS, h, w / 2)
  const up = end < base
  return up
    ? `M${x} ${base}V${end + r}Q${x} ${end} ${x + r} ${end}H${x + w - r}Q${x + w} ${end} ${x + w} ${end + r}V${base}Z`
    : `M${x} ${base}V${end - r}Q${x} ${end} ${x + r} ${end}H${x + w - r}Q${x + w} ${end} ${x + w} ${end - r}V${base}Z`
}
