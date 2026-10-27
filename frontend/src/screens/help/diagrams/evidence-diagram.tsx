/**
 * How evidence is chosen, as one picture: the pieces found, the one
 * re-ordering model, the places in the prompt (all for passages and record
 * texts in A; a share kept for graph records in B and C) and the one token
 * budget. Every number comes from the settings, as the prose's do, so the
 * picture cannot drift from the code; a number that is not known is said to
 * be not available and is not drawn.
 */

import { useId } from 'react'

import { useHelpData } from '../help-data'
import { rawSetting, showNumber } from '../settings'

const WIDTH = 360
const PAD = 8
const SLOTS_X = 76
const SLOTS_W = WIDTH - PAD - SLOTS_X
const SLOT_GAP = 4
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

/** A whole number from the settings now, else the newest official run's, else null. */
function useNumber(key: string): number | null {
  const { settings, recorded } = useHelpData()
  const current = settings.status === 'ready' ? settings.data.values : null
  const record = recorded.status === 'ready' ? recorded.data : null
  const value = rawSetting(key, current, record)
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : null
}

function Box({
  y,
  height,
  lines,
}: {
  y: number
  height: number
  lines: readonly string[]
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
        stroke={SHARED.stroke}
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

/** One row of places: the first `graph` drawn as graph places, the rest as places for passages and record texts. */
function Places({
  y,
  slots,
  graph,
}: {
  y: number
  slots: number
  graph: number
}) {
  const width = (SLOTS_W - SLOT_GAP * (slots - 1)) / slots
  return Array.from({ length: slots }, (_, index) => (
    <rect
      key={index}
      x={SLOTS_X + index * (width + SLOT_GAP)}
      y={y}
      width={width}
      height={SLOT_H}
      rx={4}
      fill={index < graph ? GRAPH : DOCUMENT.fill}
      stroke={index < graph ? GRAPH : DOCUMENT.stroke}
      strokeWidth={1.5}
    />
  ))
}

function Note({ y, text }: { y: number; text: string }) {
  return (
    <text
      x={SLOTS_X}
      y={y + SLOT_H / 2}
      dominantBaseline="central"
      fontSize={FONT}
      fill="var(--color-text-secondary)"
    >
      {text}
    </text>
  )
}

export function EvidenceDiagram() {
  const slots = useNumber('context.evidence_slots')
  const graph = useNumber('context.graph_slots')
  const budget = useNumber('context_budget_tokens')
  const known = slots !== null && slots > 0
  const share = known && graph !== null && graph <= slots ? graph : null
  const marker = `${useId().replace(/[^\w-]/g, '')}-arrow`

  const BOX = 74
  const rowA = 2 * BOX + 3 * PAD + 50
  const rowBC = rowA + SLOT_H + 44
  const budgetY = rowBC + SLOT_H + 14
  const answerY = budgetY + SLOT_H + 24
  const height = answerY + 40 + PAD
  const arrow = (from: number, to: number) => (
    <path
      d={`M${WIDTH / 2} ${from} V${to}`}
      stroke={SHARED.stroke}
      strokeWidth={2}
      markerEnd={`url(#${marker})`}
    />
  )
  const places = known ? `${slots}` : 'not available'
  const description = [
    'How evidence is chosen.',
    'The pieces found are passages and record texts, and in B and C also the records the graph reached.',
    'One re-ordering model scores every piece against the question.',
    known
      ? `The answer model sees at most ${slots} pieces. In A all ${slots} places go to passages and record texts.`
      : 'The number of places is not available.',
    share !== null && known
      ? `In B and C, ${share} places are kept for graph records and ${slots - share} go to passages and record texts.`
      : 'The number of places kept for graph records is not available.',
    budget !== null
      ? `All the pieces picked share one budget of ${showNumber(budget)} tokens.`
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
              'Pieces found',
              'Passages and record texts,',
              'and in B and C, graph records',
            ]}
          />
          {arrow(PAD + BOX, 2 * PAD + BOX + 14)}
          <Box
            y={2 * PAD + BOX + 14}
            height={BOX}
            lines={[
              'Re-ordering model',
              'Scores every piece against',
              'the question, in one list',
            ]}
          />
          {arrow(2 * PAD + 2 * BOX + 14, rowA - 22)}
          <g fontSize={FONT} fontWeight={600} fill={SHARED.text}>
            <text x={PAD} y={rowA + SLOT_H / 2} dominantBaseline="central">
              A
            </text>
            <text x={PAD} y={rowBC + SLOT_H / 2} dominantBaseline="central">
              B and C
            </text>
          </g>
          <g fontSize={SMALL} fill="var(--color-text-secondary)">
            <text x={SLOTS_X} y={rowA - 8}>
              {`${places} places for passages and record texts`}
            </text>
            {share !== null && known && (
              <>
                <text x={SLOTS_X} y={rowBC - 24} fill={GRAPH} fontWeight={600}>
                  {`${share} for graph records`}
                </text>
                <text x={SLOTS_X} y={rowBC - 8}>
                  {`${slots - share} for passages and record texts`}
                </text>
              </>
            )}
          </g>
          {known ? (
            <Places y={rowA} slots={slots} graph={0} />
          ) : (
            <Note y={rowA} text="Places not available" />
          )}
          {known && share !== null ? (
            <Places y={rowBC} slots={slots} graph={share} />
          ) : (
            <Note y={rowBC} text="Places not available" />
          )}
          <rect
            x={SLOTS_X}
            y={budgetY}
            width={SLOTS_W}
            height={SLOT_H}
            rx={4}
            fill={SHARED.fill}
            stroke={SHARED.stroke}
            strokeDasharray="4 3"
          />
          <text
            x={SLOTS_X + SLOTS_W / 2}
            y={budgetY + SLOT_H / 2}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={SMALL}
            fill={SHARED.text}
          >
            {budget !== null
              ? `All picked pieces share ${showNumber(budget)} tokens`
              : 'Token budget not available'}
          </text>
          {arrow(budgetY + SLOT_H, answerY)}
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
