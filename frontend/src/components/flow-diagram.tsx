/**
 * How the three approaches differ, as one picture: the steps all three share,
 * and where B and C branch off. Each lane draws in its pipeline's colours.
 * The same steps are given as an ordered list for screen readers.
 */

import { PIPELINES } from '../design/pipelines'
import {
  LANES,
  SHARED_AFTER,
  SHARED_BEFORE,
  STEP_LINES,
  TURNS_LINE,
} from '../run/lanes'

/** The picture's name, and the heading of the panel that holds it. */
export const FLOW_TITLE = 'How the three approaches differ'

const BOX_H = 40
const LANE_H = 72
const LABEL_H = 24
const STEP_W = 152
const STEP_GAP = 20
const TOP = 8
const QUESTION_X = 8
const QUESTION_W = 88
const BUS_X = QUESTION_X + QUESTION_W + 16
const STEPS_X = BUS_X + 24
const MOST_STEPS = Math.max(...LANES.map((lane) => lane.steps.length))
const STEPS_END = STEPS_X + MOST_STEPS * STEP_W + (MOST_STEPS - 1) * STEP_GAP
const RIGHT_BUS_X = STEPS_END + 20
const AFTER_X = RIGHT_BUS_X + 20
const AFTER_W = [136, 156]
const AFTER_GAP = 18
const WIDTH = AFTER_X + AFTER_W[0] + AFTER_GAP + AFTER_W[1] + 8
const HEIGHT = TOP * 2 + LANE_H * 3
/** The size of a pixel of text on the page: the figure is sized in em, so it grows with the screen's text. */
const BASE_PX = 14

const centre = (lane: number) => TOP + lane * LANE_H + LABEL_H + BOX_H / 2
const MIDDLE = centre(1)

function Box({
  x,
  y,
  w,
  text,
  fill,
  stroke,
  color,
}: {
  x: number
  y: number
  w: number
  text: string
  fill: string
  stroke: string
  color: string
}) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={BOX_H}
        rx={8}
        fill={fill}
        stroke={stroke}
        strokeWidth={2}
      />
      <text
        x={x + w / 2}
        y={y + BOX_H / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={14}
        fill={color}
      >
        {text}
      </text>
    </g>
  )
}

/** A line from (x1, y1) to (x2, y2), bent at `bendX`, ending in an arrow. */
function Link({
  x1,
  y1,
  x2,
  y2,
  bendX,
  stroke,
}: {
  x1: number
  y1: number
  x2: number
  y2: number
  bendX?: number
  stroke: string
}) {
  const bend = bendX ?? x2
  return (
    <path
      d={`M${x1} ${y1} H${bend} V${y2} H${x2}`}
      fill="none"
      stroke={stroke}
      strokeWidth={2}
      markerEnd="url(#flow-arrow)"
    />
  )
}

export function FlowDiagram() {
  const shared = {
    fill: 'var(--color-surface-raised)',
    stroke: 'var(--color-border)',
    color: 'var(--color-text-primary)',
  }
  return (
    <figure className="text-sm">
      <svg
        role="img"
        aria-labelledby="flow-title"
        aria-describedby="flow-desc"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        style={{ width: `${WIDTH / BASE_PX}em`, maxWidth: '100%' }}
        className="h-auto"
      >
        <title id="flow-title">{FLOW_TITLE}</title>
        <desc id="flow-desc">{STEP_LINES.join(' ')}</desc>
        <defs>
          <marker
            id="flow-arrow"
            viewBox="0 0 8 8"
            refX={7}
            refY={4}
            markerUnits="userSpaceOnUse"
            markerWidth={8}
            markerHeight={8}
            orient="auto"
          >
            <path d="M0 0 L8 4 L0 8 z" fill="context-stroke" />
          </marker>
        </defs>
        <g aria-hidden>
          <Box
            x={QUESTION_X}
            y={MIDDLE - BOX_H / 2}
            w={QUESTION_W}
            text={SHARED_BEFORE}
            {...shared}
          />
          <path
            d={`M${QUESTION_X + QUESTION_W} ${MIDDLE} H${BUS_X} M${BUS_X} ${centre(0)} V${centre(2)}`}
            fill="none"
            stroke="var(--color-border)"
            strokeWidth={2}
          />
          {LANES.map(({ label, steps, pipeline: id }, lane) => {
            const colours = id ? PIPELINES.find((p) => p.id === id)! : null
            const stroke = colours?.hue ?? shared.stroke
            const y = centre(lane)
            const lastX =
              STEPS_X + (steps.length - 1) * (STEP_W + STEP_GAP) + STEP_W
            return (
              <g key={label} data-lane={label}>
                <text
                  x={STEPS_X}
                  y={y - BOX_H / 2 - 8}
                  fontSize={12}
                  fontWeight={600}
                  fill={colours?.strong ?? shared.color}
                >
                  {label}
                </text>
                <Link x1={BUS_X} y1={y} x2={STEPS_X} y2={y} stroke={stroke} />
                {steps.map((step, index) => {
                  const x = STEPS_X + index * (STEP_W + STEP_GAP)
                  return (
                    <g key={step} data-step>
                      <Box
                        x={x}
                        y={y - BOX_H / 2}
                        w={STEP_W}
                        text={step}
                        fill={colours?.tint ?? shared.fill}
                        stroke={stroke}
                        color={colours?.strong ?? shared.color}
                      />
                      {index > 0 && (
                        <Link
                          x1={x - STEP_GAP}
                          y1={y}
                          x2={x}
                          y2={y}
                          stroke={stroke}
                        />
                      )}
                    </g>
                  )
                })}
                <Link
                  x1={lastX}
                  y1={y}
                  x2={AFTER_X}
                  y2={MIDDLE}
                  bendX={RIGHT_BUS_X}
                  stroke={stroke}
                />
              </g>
            )
          })}
          {SHARED_AFTER.map((text, index) => (
            <Box
              key={text}
              x={AFTER_X + (index === 0 ? 0 : AFTER_W[0] + AFTER_GAP)}
              y={MIDDLE - BOX_H / 2}
              w={AFTER_W[index]}
              text={text}
              {...shared}
            />
          ))}
          <Link
            x1={AFTER_X + AFTER_W[0]}
            y1={MIDDLE}
            x2={AFTER_X + AFTER_W[0] + AFTER_GAP}
            y2={MIDDLE}
            stroke={shared.stroke}
          />
        </g>
      </svg>
      <figcaption aria-hidden className="mt-2 text-text-secondary">
        {TURNS_LINE}
      </figcaption>
      <ol className="sr-only">
        {STEP_LINES.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ol>
    </figure>
  )
}
