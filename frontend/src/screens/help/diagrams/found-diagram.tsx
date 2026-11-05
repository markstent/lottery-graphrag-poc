/**
 * Evidence found, as one picture: two overlapping circles, the facts a
 * question needs (solid) and what an approach brought (dashed). Where they
 * overlap is found, the needed facts the evidence states; the rest of the
 * first is missed and the rest of the second is extra, records that state no
 * needed fact. Each part is named on the drawing and in a key below it.
 */

import { useId } from 'react'

import { Picture } from './parts'
import { FONT, PAD, SHARED } from './style'

const WIDTH = 520
const R = 100
const NEEDED_X = 200
const BROUGHT_X = 320
const TITLE_Y = 18
const CY = TITLE_Y + 18 + R
const KEY_Y = CY + R + 30
const KEY_STEP = 22

const KEY = [
  ['Found', 'needed facts the evidence states'],
  ['Missed', 'needed facts it does not state'],
  ['Extra', 'records brought that state no needed fact'],
] as const
const HEIGHT = KEY_Y + (KEY.length - 1) * KEY_STEP + 10 + PAD

const LABEL = [
  'Evidence found.',
  'The facts a question needs are compared with what an approach brought.',
  ...KEY.map(([part, meaning]) => `${part}: ${meaning}.`),
].join(' ')

/** Each region's name, at the middle of the part it names. */
const REGIONS = [
  { text: 'Missed', x: (NEEDED_X - R + BROUGHT_X - R) / 2 },
  { text: 'Found', x: (BROUGHT_X - R + NEEDED_X + R) / 2 },
  { text: 'Extra', x: (NEEDED_X + R + BROUGHT_X + R) / 2 },
] as const

export function FoundDiagram() {
  const needed = `${useId().replace(/[^\w-]/g, '')}-needed`
  return (
    <Picture label={LABEL} width={WIDTH} height={HEIGHT}>
      {() => (
        <>
          <g fontSize={FONT} fontWeight={600} fill={SHARED.text}>
            <text x={PAD} y={TITLE_Y} dominantBaseline="central">
              Facts the question needs
            </text>
            <text
              x={WIDTH - PAD}
              y={TITLE_Y}
              textAnchor="end"
              dominantBaseline="central"
            >
              What the approach brought
            </text>
          </g>
          <circle cx={NEEDED_X} cy={CY} r={R} fill={SHARED.fill} />
          <clipPath id={needed}>
            <circle cx={NEEDED_X} cy={CY} r={R} />
          </clipPath>
          <circle cx={BROUGHT_X} cy={CY} r={R} fill={SHARED.fill} />
          {/* The overlap, found, is the one darker part. */}
          <circle
            cx={BROUGHT_X}
            cy={CY}
            r={R}
            fill="var(--color-grey-300)"
            clipPath={`url(#${needed})`}
          />
          <circle
            cx={BROUGHT_X}
            cy={CY}
            r={R}
            fill="none"
            stroke="var(--color-text-secondary)"
            strokeWidth={2}
            strokeDasharray="6 4"
          />
          <circle
            cx={NEEDED_X}
            cy={CY}
            r={R}
            fill="none"
            stroke="var(--color-text-secondary)"
            strokeWidth={2}
          />
          <g
            fontSize={FONT}
            fontWeight={600}
            fill={SHARED.text}
            textAnchor="middle"
          >
            {REGIONS.map(({ text, x }) => (
              <text key={text} x={x} y={CY} dominantBaseline="central">
                {text}
              </text>
            ))}
          </g>
          <g fontSize={FONT} fill={SHARED.text}>
            {KEY.map(([part, meaning], index) => (
              <text
                key={part}
                x={NEEDED_X - R}
                y={KEY_Y + index * KEY_STEP}
                dominantBaseline="central"
              >
                <tspan fontWeight={600}>{part}</tspan>: {meaning}
              </text>
            ))}
          </g>
        </>
      )}
    </Picture>
  )
}
