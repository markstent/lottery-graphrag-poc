/**
 * How evidence is chosen under method v0.3, as one picture: the passages and
 * record texts in the re-ordering model's order; in B and C also the graph's
 * records in the graph's own order; and the one token budget each approach
 * fills, A from its one list and B and C from the two lists in turn, a
 * passage first. The blocks drawn show the order of taking, not a count: no
 * item limit exists. The budget comes from the settings, as the prose's
 * numbers do; a value that is not known is said to be not available.
 */

import { useId } from 'react'

import {
  EVIDENCE_DIAGRAM_KEYS,
  rawSetting,
  showNumber,
  useSettingValues,
  type SettingValues,
} from '../settings'

const WIDTH = 360
const PAD = 8
const SLOTS_X = 76
const SLOTS_W = WIDTH - PAD - SLOTS_X
const SLOT_GAP = 4
/** Blocks drawn per budget: an illustration of the order of taking, not a count. */
const BLOCKS = 6
const SLOT_H = 28
const FONT = 14
const SMALL = 12
const BASE_PX = 14
const GRAPH = 'var(--color-graph)'
const DOCUMENT = {
  fill: 'var(--color-surface)',
  stroke: 'var(--color-border)',
}
const SHARED = {
  fill: 'var(--color-surface-raised)',
  stroke: 'var(--color-border)',
  text: 'var(--color-text-primary)',
}

/** A whole number from the settings now, else the newest official run's, else null (and null while loading). */
const wholeNumber = (
  key: string,
  { current, recorded, loading }: SettingValues,
): number | null => {
  if (loading) return null
  const value = rawSetting(key, current, recorded)
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : null
}

function Box({
  y,
  height,
  lines,
  stroke = SHARED.stroke,
}: {
  y: number
  height: number
  lines: readonly string[]
  stroke?: string
}) {
  const step = 19
  const first = y + height / 2 - ((lines.length - 1) * step) / 2
  return (
    <g>
      <rect
        x={PAD}
        y={y}
        width={WIDTH - 2 * PAD}
        height={height}
        rx={8}
        fill={SHARED.fill}
        stroke={stroke}
        strokeWidth={2}
      />
      {lines.map((line, index) => (
        <text
          key={line}
          x={WIDTH / 2}
          y={first + index * step}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={FONT}
          fontWeight={index === 0 && lines.length > 1 ? 600 : 400}
          fill={SHARED.text}
        >
          {line}
        </text>
      ))}
    </g>
  )
}

/** The kinds of the blocks one row takes, in the order it takes them. */
type Taken = readonly ('document' | 'graph')[]
const A_TAKES: Taken = Array.from({ length: BLOCKS }, () => 'document')
const BC_TAKES: Taken = Array.from({ length: BLOCKS }, (_, index) =>
  index % 2 === 0 ? 'document' : 'graph',
)

/** One budget, drawn as a dashed box, and the blocks taken into it in order. */
function Budget({ y, takes }: { y: number; takes: Taken }) {
  const inner = SLOTS_W - 2 * SLOT_GAP
  const width = (inner - SLOT_GAP * (takes.length - 1)) / takes.length
  return (
    <g>
      <rect
        x={SLOTS_X}
        y={y}
        width={SLOTS_W}
        height={SLOT_H + 2 * SLOT_GAP}
        rx={6}
        fill="none"
        stroke={SHARED.stroke}
        strokeDasharray="4 3"
      />
      {takes.map((kind, index) => (
        <rect
          key={index}
          x={SLOTS_X + SLOT_GAP + index * (width + SLOT_GAP)}
          y={y + SLOT_GAP}
          width={width}
          height={SLOT_H}
          rx={4}
          fill={kind === 'graph' ? GRAPH : DOCUMENT.fill}
          stroke={kind === 'graph' ? GRAPH : DOCUMENT.stroke}
          strokeWidth={1.5}
        />
      ))}
    </g>
  )
}

export function EvidenceDiagram() {
  const values = useSettingValues()
  const { loading } = values
  const budget = wholeNumber(EVIDENCE_DIAGRAM_KEYS[0], values)
  const unknown = loading ? 'loading' : 'not available'
  const marker = `${useId().replace(/[^\w-]/g, '')}-arrow`

  const BOX = 56
  const graphY = 2 * PAD + BOX
  const rowA = graphY + BOX + 44
  const rowBC = rowA + SLOT_H + 2 * SLOT_GAP + 36
  const budgetY = rowBC + SLOT_H + 2 * SLOT_GAP + 20
  const answerY = budgetY + 30
  const height = answerY + 40 + PAD
  const tokens = budget !== null ? `${showNumber(budget)} tokens` : null
  const description = loading
    ? 'How evidence is chosen. The settings it quotes are loading.'
    : [
        'How evidence is chosen.',
        "The passages and record texts are put in order by the re-ordering model. In B and C, the records the graph reached form a second list, in the graph's own order.",
        'A takes pieces from its one list in order until its budget is full.',
        'B and C take one piece from each list in turn, a passage first, until the budget is full.',
        tokens !== null
          ? `Each approach has one budget of ${tokens}, and no limit on the number of pieces.`
          : 'The token budget is not available.',
      ].join(' ')

  return (
    <figure className="text-sm">
      <div role="img" aria-label={description}>
        <svg
          aria-hidden
          viewBox={`0 0 ${WIDTH} ${height}`}
          style={{ width: `${WIDTH / BASE_PX}em`, maxWidth: '100%' }}
          className="h-auto"
        >
          <defs>
            <marker
              id={marker}
              viewBox="0 0 8 8"
              refX={7}
              refY={4}
              markerUnits="userSpaceOnUse"
              markerWidth={8}
              markerHeight={8}
              orient="auto"
            >
              <path d="M0 0 L8 4 L0 8 z" fill={SHARED.stroke} />
            </marker>
          </defs>
          <Box
            y={PAD}
            height={BOX}
            lines={[
              'Passages and record texts',
              "in the re-ordering model's order",
            ]}
          />
          <Box
            y={graphY}
            height={BOX}
            stroke={GRAPH}
            lines={['Graph records (B and C)', "in the graph's own order"]}
          />
          <g fontSize={FONT} fontWeight={600} fill={SHARED.text}>
            <text
              x={PAD}
              y={rowA + SLOT_GAP + SLOT_H / 2}
              dominantBaseline="central"
            >
              A
            </text>
            <text
              x={PAD}
              y={rowBC + SLOT_GAP + SLOT_H / 2}
              dominantBaseline="central"
            >
              B and C
            </text>
          </g>
          <g fontSize={SMALL} fill="var(--color-text-secondary)">
            <text x={SLOTS_X} y={rowA - 8}>
              Passages, in order, until full
            </text>
            <text x={SLOTS_X} y={rowBC - 8}>
              A passage, then a graph record, in turn
            </text>
          </g>
          <Budget y={rowA} takes={A_TAKES} />
          <Budget y={rowBC} takes={BC_TAKES} />
          <text
            x={SLOTS_X}
            y={budgetY}
            dominantBaseline="central"
            fontSize={SMALL}
            fill={SHARED.text}
          >
            {tokens !== null
              ? `Each dashed box: one budget of ${tokens}`
              : `Token budget ${unknown}`}
          </text>
          <path
            d={`M${WIDTH / 2} ${budgetY + 10} V${answerY}`}
            stroke={SHARED.stroke}
            strokeWidth={2}
            markerEnd={`url(#${marker})`}
          />
          <rect
            x={WIDTH / 2 - 80}
            y={answerY}
            width={160}
            height={40}
            rx={8}
            fill={SHARED.fill}
            stroke={SHARED.stroke}
            strokeWidth={2}
          />
          <text
            x={WIDTH / 2}
            y={answerY + 20}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={FONT}
            fill={SHARED.text}
          >
            Answer model
          </text>
        </svg>
      </div>
    </figure>
  )
}
