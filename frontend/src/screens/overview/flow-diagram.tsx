/**
 * How the three approaches differ, as one picture: the steps all three share,
 * and where B and C branch off. Each lane draws in its pipeline's colours.
 * The same steps are given as an ordered list for screen readers.
 */

import { GLOSSARY } from '../../copy/glossary'
import { PIPELINES, type PipelineId } from '../../design/pipelines'

const LANES: Record<PipelineId, string[]> = {
  A: [`Search ${GLOSSARY.chunk}s`],
  B: [
    `Search ${GLOSSARY.chunk}s`,
    `Find ${GLOSSARY.seed}s`,
    'Follow relationships',
  ],
  C: [
    `Search ${GLOSSARY.chunk}s`,
    `Find ${GLOSSARY.seed}s`,
    'Follow relationships',
    'Use ontology concepts',
  ],
}

const SHARED_BEFORE = 'Question'
const SHARED_AFTER = ['Re-order and pick', 'Answer with sources']

const BOX_H = 40
const LANE_H = 72
const LABEL_H = 24
const STEP_W = 168
const STEP_GAP = 24
const SHARED_W = 152
const TOP = 8
const QUESTION_X = 8
const QUESTION_W = 104
const BUS_X = QUESTION_X + QUESTION_W + 24
const STEPS_X = BUS_X + 24
const STEPS_END = STEPS_X + 4 * STEP_W + 3 * STEP_GAP
const RIGHT_BUS_X = STEPS_END + 24
const AFTER_X = RIGHT_BUS_X + 24
const WIDTH = AFTER_X + 2 * SHARED_W + 24 + 8
const HEIGHT = TOP * 2 + LANE_H * 3

const STEP_LINES = [
  `Every approach starts with the ${SHARED_BEFORE.toLowerCase()} and searches ${GLOSSARY.chunk}s.`,
  `B adds ${GLOSSARY.seed}s and relationships from the graph.`,
  'C adds ontology concepts on top of B.',
  `All three then ${SHARED_AFTER[0].toLowerCase()} and ${SHARED_AFTER[1].toLowerCase()}.`,
]

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
    <figure>
      <svg
        role="img"
        aria-labelledby="flow-title"
        aria-describedby="flow-desc"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full"
      >
        <title id="flow-title">How the three approaches differ</title>
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
          {PIPELINES.map((pipeline, lane) => {
            const steps = LANES[pipeline.id]
            const y = centre(lane)
            const lastX =
              STEPS_X + (steps.length - 1) * (STEP_W + STEP_GAP) + STEP_W
            return (
              <g key={pipeline.id}>
                <text
                  x={STEPS_X}
                  y={y - BOX_H / 2 - 8}
                  fontSize={12}
                  fontWeight={600}
                  fill={pipeline.strong}
                >
                  {pipeline.label}
                </text>
                <Link
                  x1={BUS_X}
                  y1={y}
                  x2={STEPS_X}
                  y2={y}
                  stroke={pipeline.hue}
                />
                {steps.map((step, index) => {
                  const x = STEPS_X + index * (STEP_W + STEP_GAP)
                  return (
                    <g key={step}>
                      <Box
                        x={x}
                        y={y - BOX_H / 2}
                        w={STEP_W}
                        text={step}
                        fill={pipeline.tint}
                        stroke={pipeline.hue}
                        color={pipeline.strong}
                      />
                      {index > 0 && (
                        <Link
                          x1={x - STEP_GAP}
                          y1={y}
                          x2={x}
                          y2={y}
                          stroke={pipeline.hue}
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
                  stroke={pipeline.hue}
                />
              </g>
            )
          })}
          {SHARED_AFTER.map((text, index) => (
            <Box
              key={text}
              x={AFTER_X + index * (SHARED_W + 24)}
              y={MIDDLE - BOX_H / 2}
              w={SHARED_W}
              text={text}
              {...shared}
            />
          ))}
          <Link
            x1={AFTER_X + SHARED_W}
            y1={MIDDLE}
            x2={AFTER_X + SHARED_W + 24}
            y2={MIDDLE}
            stroke="var(--color-border)"
          />
        </g>
      </svg>
      <ol className="sr-only">
        {STEP_LINES.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ol>
    </figure>
  )
}
