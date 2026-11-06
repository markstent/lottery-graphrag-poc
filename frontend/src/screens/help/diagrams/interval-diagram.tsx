/**
 * How to read a margin of error, as one picture: two differences, each a dot
 * with its margin of error as a bar around it, against a dashed line at zero
 * (no difference). The first bar crosses zero, too close to call; the second
 * is clear of zero, which counts only if its test also passes (chapter 8).
 * The positions are an illustration, not results.
 */

import { Picture } from './parts'
import { FONT, PAD, SHARED, SMALL } from './style'

const ZERO_X = 150
const AXIS_START = 40
const AXIS_END = 340
const LABEL_X = 364
const WIDTH = 620
const CAP = 7
const DOT_R = 6

const ROWS = [
  {
    name: 'Too close to call',
    detail: 'the bar crosses zero',
    from: 100,
    dot: 190,
    to: 280,
    y: 56,
  },
  {
    name: 'Clear of zero',
    detail: 'counts only if its test also passes',
    from: 200,
    dot: 260,
    to: 320,
    y: 116,
  },
] as const
const ZERO_LABEL_Y = PAD + 8
const AXIS_Y = 156
const AXIS_LABEL_Y = AXIS_Y + 20
const KEY_Y = AXIS_LABEL_Y + 32
const HEIGHT = KEY_Y + 10 + PAD

const SECONDARY = 'var(--color-text-secondary)'

const LABEL = [
  'How to read a margin of error.',
  'Each line is a difference between two approaches: the dot is the difference measured, and the bar around it is its margin of error.',
  'In the first line the bar crosses zero, so no difference at all is still possible: too close to call.',
  'In the second line the whole bar is clear of zero, which counts only if its test also passes.',
].join(' ')

/** A margin of error: a bar with an end cap at each side and, when given, the measured difference as a dot. */
function Interval({
  from,
  dot,
  to,
  y,
}: {
  from: number
  dot?: number
  to: number
  y: number
}) {
  return (
    <g stroke={SHARED.text} strokeWidth={2}>
      <path
        d={`M${from} ${y - CAP} V${y + CAP} M${from} ${y} H${to} M${to} ${y - CAP} V${y + CAP}`}
        fill="none"
      />
      {dot !== undefined && (
        <circle cx={dot} cy={y} r={DOT_R} fill={SHARED.text} />
      )}
    </g>
  )
}

export function IntervalDiagram() {
  return (
    <Picture label={LABEL} width={WIDTH} height={HEIGHT}>
      {() => (
        <>
          <path
            d={`M${AXIS_START} ${AXIS_Y} H${AXIS_END}`}
            stroke={SHARED.stroke}
            strokeWidth={2}
          />
          <path
            d={`M${ZERO_X} ${ZERO_LABEL_Y + 12} V${AXIS_Y + CAP}`}
            stroke={SHARED.stroke}
            strokeWidth={1.5}
            strokeDasharray="4 3"
          />
          <g fontSize={SMALL} fill={SECONDARY}>
            <text
              x={ZERO_X}
              y={ZERO_LABEL_Y}
              textAnchor="middle"
              dominantBaseline="central"
            >
              No difference (zero)
            </text>
            <text
              x={AXIS_END}
              y={AXIS_LABEL_Y}
              textAnchor="end"
              dominantBaseline="central"
            >
              Difference between two approaches
            </text>
          </g>
          {ROWS.map(({ name, detail, from, dot, to, y }) => (
            <g key={name}>
              <Interval from={from} dot={dot} to={to} y={y} />
              <text
                x={LABEL_X}
                y={y - 9}
                dominantBaseline="central"
                fontSize={FONT}
                fontWeight={600}
                fill={SHARED.text}
              >
                {name}
              </text>
              <text
                x={LABEL_X}
                y={y + 11}
                dominantBaseline="central"
                fontSize={SMALL}
                fill={SECONDARY}
              >
                {detail}
              </text>
            </g>
          ))}
          <g fontSize={SMALL} fill={SHARED.text}>
            <circle cx={AXIS_START + DOT_R} cy={KEY_Y} r={DOT_R} />
            <text
              x={AXIS_START + 2 * DOT_R + 8}
              y={KEY_Y}
              dominantBaseline="central"
            >
              Measured difference
            </text>
            <Interval from={AXIS_START + 190} to={AXIS_START + 230} y={KEY_Y} />
            <text x={AXIS_START + 240} y={KEY_Y} dominantBaseline="central">
              Margin of error
            </text>
          </g>
        </>
      )}
    </Picture>
  )
}
