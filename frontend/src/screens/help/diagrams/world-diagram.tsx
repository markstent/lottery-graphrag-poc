/**
 * What a world is, as one picture: a program takes a recipe (a number and
 * settings) and makes tables, documents and eight planted stories, which
 * together are one world; the same recipe always rebuilds the same world.
 */

import { Box, Line, Picture } from './parts'
import { BOX_H, BOX_H2, boxWidth, FONT, GAP, PAD, SHARED, SMALL } from './style'

const PARTS = ['Tables', 'Documents', 'Eight planted stories'] as const
const ROW_GAP = 12
/** Room above the parts for the frame's name. */
const FRAME_HEAD = 30
const INSET = 12

const RECIPE_W = boxWidth('a number and settings')
const PROGRAM_W = boxWidth('Program')
const PART_W = Math.max(...PARTS.map(boxWidth))
const PROGRAM_X = PAD + RECIPE_W + GAP
const FRAME_X = PROGRAM_X + PROGRAM_W + GAP
const FRAME_W = PART_W + 2 * INSET
const WIDTH = FRAME_X + FRAME_W + PAD

const partY = (row: number) => PAD + FRAME_HEAD + row * (BOX_H + ROW_GAP)
const FRAME_H = FRAME_HEAD + PARTS.length * (BOX_H + ROW_GAP) - ROW_GAP + INSET
const MIDDLE = (partY(0) + partY(PARTS.length - 1) + BOX_H) / 2
const NOTE_Y = PAD + FRAME_H + 24
const HEIGHT = NOTE_Y + 10 + PAD

const SAME = 'The same recipe always rebuilds the same world.'

const LABEL = [
  'What a world is.',
  'A program takes a recipe, a number and settings, and makes tables, documents and eight planted stories.',
  'Together they are one world.',
  SAME,
].join(' ')

export function WorldDiagram() {
  return (
    <Picture label={LABEL} width={WIDTH} height={HEIGHT}>
      {(arrow) => (
        <>
          <Line
            d={`M${PAD + RECIPE_W} ${MIDDLE} H${PROGRAM_X}`}
            arrow={arrow}
          />
          <Line
            d={`M${PROGRAM_X + PROGRAM_W} ${MIDDLE} H${FRAME_X}`}
            arrow={arrow}
          />
          <Box
            x={PAD}
            y={MIDDLE - BOX_H2 / 2}
            w={RECIPE_W}
            h={BOX_H2}
            lines={['Recipe', 'a number and settings']}
          />
          <Box
            x={PROGRAM_X}
            y={MIDDLE - BOX_H / 2}
            w={PROGRAM_W}
            lines={['Program']}
          />
          <rect
            x={FRAME_X}
            y={PAD}
            width={FRAME_W}
            height={FRAME_H}
            rx={8}
            fill="none"
            stroke={SHARED.stroke}
            strokeWidth={1.5}
            strokeDasharray="4 3"
          />
          <text
            x={FRAME_X + INSET}
            y={PAD + FRAME_HEAD / 2 + 1}
            dominantBaseline="central"
            fontSize={FONT}
            fontWeight={600}
            fill={SHARED.text}
          >
            One world
          </text>
          {PARTS.map((part, row) => (
            <Box
              key={part}
              x={FRAME_X + INSET}
              y={partY(row)}
              w={PART_W}
              lines={[part]}
            />
          ))}
          <text
            x={WIDTH / 2}
            y={NOTE_Y}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={SMALL}
            fill="var(--color-text-secondary)"
          >
            {SAME}
          </text>
        </>
      )}
    </Picture>
  )
}
