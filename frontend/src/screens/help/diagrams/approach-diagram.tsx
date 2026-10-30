/**
 * One approach as a picture: the steps it takes from the question to the
 * answer, in its pipeline's colours, with the step names Live Lab uses. The
 * same steps are drawn twice: as a row for a wide column and as a column for
 * a narrow one, and the width of the container picks one. The picture is one
 * image whose text alternative says what it shows.
 */

import { useId } from 'react'

import { pipeline, type PipelineId } from '../../../design/pipelines'
import { STAGE_LABELS, STEP } from '../../../run/lanes'

interface Lane {
  label: string
  steps: readonly string[]
}

interface Approach {
  lanes: readonly Lane[]
  /** The text alternative: what the picture shows, in order. */
  description: string
  /** Container classes that show the row on a wide column and the column on a narrow one (literal, for Tailwind). */
  row: string
  column: string
}

const PASSAGES = 'Passages and record texts'

const APPROACHES: Record<PipelineId, Approach> = {
  A: {
    lanes: [
      { label: PASSAGES, steps: [STEP.searchPassages, STEP.reorderPassages] },
    ],
    description:
      'The question goes to one search over passages and record texts. A re-ordering model puts what the search found in order, the pieces are taken in that order until one budget is full, and the answer model writes the answer from them.',
    row: 'hidden @2xl:block',
    column: '@2xl:hidden',
  },
  B: {
    lanes: [
      {
        label: 'Graph',
        steps: [
          STEP.findStartingPoints,
          STEP.followRelationships,
          STEP.rankByGraph,
        ],
      },
      { label: PASSAGES, steps: [STEP.searchPassages, STEP.reorderPassages] },
    ],
    description:
      "Two searches start from the question. The graph search finds starting points named in the question, follows relationships to linked records and puts them in the graph's own order. The passage search is the same as in A. The two lists take turns filling one budget, a passage first, and the answer model writes the answer from them.",
    row: 'hidden @4xl:block',
    column: '@4xl:hidden',
  },
  C: {
    lanes: [
      {
        label: 'Graph and ontology',
        steps: [
          STEP.findStartingPoints,
          STEP.addOntologyTerms,
          STEP.followRelationships,
          STEP.addLinkedRecords,
          STEP.rankByGraph,
        ],
      },
      {
        label: PASSAGES,
        steps: ['Search with added terms', STEP.reorderPassages],
      },
    ],
    description:
      "As in B, two searches start from the question, and the ontology adds three things. Starting points are also found from local names in four languages. The ontology terms are added to the passage search. Records linked through a concept are added to the graph search. As in B, the graph's list and the passages take turns filling one budget, and the answer model writes the answer from them.",
    row: 'hidden @6xl:block',
    column: '@6xl:hidden',
  },
}

const QUESTION = 'Question'
const TAIL = ['Fill one budget', STAGE_LABELS.generation] as const

const BOX_H = 40
const GAP = 28
const LABEL_H = 22
const PAD = 8
const FONT = 14
const LABEL_FONT = 12
/** The size of a pixel of text on the page: the picture is sized in em, so it grows with the screen's text. */
const BASE_PX = 14

/** A box wide enough for its text at 14 px. */
const boxWidth = (text: string) =>
  Math.max(112, Math.ceil(text.length * 7.6) + 28)
const labelWidth = (text: string) => Math.ceil(text.length * 6.8)

interface Box {
  x: number
  y: number
  w: number
  text: string
  own: boolean
}
interface Label {
  x: number
  y: number
  text: string
  anchor: 'start' | 'middle'
}
interface Layout {
  width: number
  height: number
  boxes: Box[]
  labels: Label[]
  /** Connectors; `arrow` marks the ones that end on a box. */
  paths: { d: string; arrow: boolean }[]
}

/** The steps as a row: the question on the left, one lane per row, the shared steps on the right. */
function rowLayout(lanes: readonly Lane[]): Layout {
  const boxes: Box[] = []
  const labels: Label[] = []
  const paths: Layout['paths'] = []
  const questionW = boxWidth(QUESTION)
  const laneTop = (lane: number) => PAD + lane * (LABEL_H + BOX_H + GAP / 2)
  const centre = (lane: number) => laneTop(lane) + LABEL_H + BOX_H / 2
  const middle = (centre(0) + centre(lanes.length - 1)) / 2
  const busX = PAD + questionW + GAP / 2
  const stepsX = PAD + questionW + GAP
  boxes.push({
    x: PAD,
    y: middle - BOX_H / 2,
    w: questionW,
    text: QUESTION,
    own: false,
  })
  const ends = lanes.map(({ label, steps }, lane) => {
    const y = centre(lane)
    labels.push({
      x: stepsX,
      y: laneTop(lane) + 15,
      text: label,
      anchor: 'start',
    })
    paths.push({
      d: `M${PAD + questionW} ${middle} H${busX} V${y} H${stepsX}`,
      arrow: true,
    })
    let x = stepsX
    steps.forEach((text, index) => {
      const w = boxWidth(text)
      if (index > 0) paths.push({ d: `M${x - GAP} ${y} H${x}`, arrow: true })
      boxes.push({ x, y: y - BOX_H / 2, w, text, own: true })
      x += w + GAP
    })
    return x - GAP
  })
  const lanesEnd = Math.max(...ends)
  const mergeX = lanesEnd + GAP / 2
  let x = lanesEnd + GAP
  ends.forEach((end, lane) =>
    paths.push({
      d: `M${end} ${centre(lane)} H${mergeX} V${middle} H${x}`,
      arrow: true,
    }),
  )
  TAIL.forEach((text, index) => {
    const w = boxWidth(text)
    if (index > 0) paths.push({ d: `M${x - GAP} ${middle} H${x}`, arrow: true })
    boxes.push({ x, y: middle - BOX_H / 2, w, text, own: false })
    x += w + GAP
  })
  return {
    width: x - GAP + PAD,
    height: laneTop(lanes.length - 1) + LABEL_H + BOX_H + PAD,
    boxes,
    labels,
    paths,
  }
}

/**
 * The same steps as one column, for a narrow container: the question on top,
 * then the steps. With two lanes they sit one under the other: a line on the
 * left feeds each lane and a line on the right gathers them into the shared
 * steps. A single lane is a straight line, with no label.
 */
function columnLayout(lanes: readonly Lane[]): Layout {
  const boxes: Box[] = []
  const labels: Label[] = []
  const paths: Layout['paths'] = []
  const forks = lanes.length > 1
  const BUS = forks ? 20 : 0
  const inner = Math.max(
    ...lanes.flatMap(({ label, steps }) => [
      forks ? labelWidth(label) : 0,
      ...steps.map(boxWidth),
    ]),
    boxWidth(QUESTION),
    ...TAIL.map((text) => boxWidth(text)),
  )
  const left = PAD + BUS
  const cx = left + inner / 2
  const leftBus = PAD + BUS / 2
  const rightBus = left + inner + BUS / 2
  const questionW = boxWidth(QUESTION)
  boxes.push({
    x: cx - questionW / 2,
    y: PAD,
    w: questionW,
    text: QUESTION,
    own: false,
  })
  let y = PAD + BOX_H + (forks ? GAP / 2 : GAP)
  const feeds: number[] = []
  const ends: { x: number; y: number }[] = []
  for (const { label, steps } of lanes) {
    if (forks) {
      labels.push({ x: left, y: y + 15, text: label, anchor: 'start' })
      y += LABEL_H
    }
    steps.forEach((text, index) => {
      const w = boxWidth(text)
      const middle = y + BOX_H / 2
      if (index > 0 || !forks)
        paths.push({ d: `M${cx} ${y - GAP} V${y}`, arrow: true })
      else {
        feeds.push(middle)
        paths.push({ d: `M${leftBus} ${middle} H${cx - w / 2}`, arrow: true })
      }
      boxes.push({ x: cx - w / 2, y, w, text, own: true })
      if (index === steps.length - 1) ends.push({ x: cx + w / 2, y: middle })
      y += BOX_H + GAP
    })
  }
  if (forks) {
    const gather = y - GAP / 2
    paths.push({
      d: `M${cx} ${PAD + BOX_H} V${PAD + BOX_H + GAP / 4} H${leftBus} V${Math.max(...feeds)}`,
      arrow: false,
    })
    for (const end of ends)
      paths.push({
        d: `M${end.x} ${end.y} H${rightBus} V${gather}`,
        arrow: false,
      })
    paths.push({ d: `M${rightBus} ${gather} H${cx} V${y}`, arrow: true })
  } else paths.push({ d: `M${cx} ${y - GAP} V${y}`, arrow: true })
  TAIL.forEach((text, index) => {
    const w = boxWidth(text)
    if (index > 0) paths.push({ d: `M${cx} ${y - GAP} V${y}`, arrow: true })
    boxes.push({ x: cx - w / 2, y, w, text, own: false })
    y += BOX_H + GAP
  })
  return {
    width: forks ? rightBus + BUS / 2 + PAD : inner + 2 * PAD,
    height: y - GAP + PAD,
    boxes,
    labels,
    paths,
  }
}

interface Tone {
  fill: string
  stroke: string
  text: string
}

/** Each approach's own steps in its colours; the question and the shared steps in neutral ones. */
const TONES: Record<PipelineId, Tone> = {
  A: {
    fill: 'var(--color-pipeline-a-tint)',
    stroke: 'var(--color-pipeline-a)',
    text: 'var(--color-pipeline-a-strong)',
  },
  B: {
    fill: 'var(--color-pipeline-b-tint)',
    stroke: 'var(--color-pipeline-b)',
    text: 'var(--color-pipeline-b-strong)',
  },
  C: {
    fill: 'var(--color-pipeline-c-tint)',
    stroke: 'var(--color-pipeline-c)',
    text: 'var(--color-pipeline-c-strong)',
  },
}
const SHARED: Tone = {
  fill: 'var(--color-surface-raised)',
  stroke: 'var(--color-border)',
  text: 'var(--color-text-primary)',
}

function Drawing({
  layout,
  own,
  className,
}: {
  layout: Layout
  own: Tone
  className: string
}) {
  const marker = `${useId().replace(/[^\w-]/g, '')}-arrow`
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      style={{ width: `${layout.width / BASE_PX}em`, maxWidth: '100%' }}
      className={`h-auto ${className}`}
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
          <path d="M0 0 L8 4 L0 8 z" fill={own.stroke} />
        </marker>
      </defs>
      {layout.paths.map(({ d, arrow }) => (
        <path
          key={d}
          d={d}
          fill="none"
          stroke={own.stroke}
          strokeWidth={2}
          markerEnd={arrow ? `url(#${marker})` : undefined}
        />
      ))}
      {layout.labels.map(({ x, y, text, anchor }) => (
        <text
          key={`${x}-${text}`}
          x={x}
          y={y}
          textAnchor={anchor}
          fontSize={LABEL_FONT}
          fontWeight={600}
          fill={own.text}
        >
          {text}
        </text>
      ))}
      {layout.boxes.map(({ x, y, w, text, own: isOwn }) => {
        const tone = isOwn ? own : SHARED
        return (
          <g key={`${x}-${y}`}>
            <rect
              x={x}
              y={y}
              width={w}
              height={BOX_H}
              rx={8}
              fill={tone.fill}
              stroke={tone.stroke}
              strokeWidth={2}
            />
            <text
              x={x + w / 2}
              y={y + BOX_H / 2}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={FONT}
              fill={tone.text}
            >
              {text}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/** Approach A, B or C: its name as the caption and its steps as one image. */
export function ApproachDiagram({ id }: { id: PipelineId }) {
  const approach = APPROACHES[id]
  const { label } = pipeline(id)
  return (
    <figure className="@container space-y-2 text-sm">
      <figcaption
        className="text-base font-semibold"
        style={{ color: TONES[id].text }}
      >
        {label}
      </figcaption>
      <div role="img" aria-label={`${label}. ${approach.description}`}>
        <Drawing
          layout={rowLayout(approach.lanes)}
          own={TONES[id]}
          className={approach.row}
        />
        <Drawing
          layout={columnLayout(approach.lanes)}
          own={TONES[id]}
          className={approach.column}
        />
      </div>
    </figure>
  )
}
