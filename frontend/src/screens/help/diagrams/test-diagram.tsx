/**
 * The test as one picture: the questions go to the three approaches, each
 * approach writes answers, and the answers are compared with the answer key
 * to give the scores.
 */

import { PIPELINES } from '../../../design/pipelines'
import { Box, Line, Picture } from './parts'
import { BOX_H, boxWidth, GAP, PAD, TONES } from './style'

const ROW_GAP = 12
const QUESTIONS_W = boxWidth('Questions')
const APPROACH_W = Math.max(...PIPELINES.map(({ label }) => boxWidth(label)))
const SIDE_W = boxWidth('Answer key')

const APPROACH_X = PAD + QUESTIONS_W + GAP
const ANSWERS_X = APPROACH_X + APPROACH_W + GAP
const SCORES_X = ANSWERS_X + SIDE_W + GAP
const WIDTH = SCORES_X + SIDE_W + PAD

const rowY = (row: number) => PAD + row * (BOX_H + ROW_GAP)
const centre = (row: number) => rowY(row) + BOX_H / 2
const MIDDLE = centre(1)
const KEY_Y = MIDDLE + BOX_H / 2 + GAP
const HEIGHT = KEY_Y + BOX_H + PAD

const LABEL = [
  'The test.',
  'A fixed set of questions goes to each of the three approaches: A Text search, B Graph, and C Graph + Ontology.',
  'Each approach writes its answers.',
  'The answers are compared with the answer key, the correct answer and its key facts, and that gives the scores.',
].join(' ')

export function TestDiagram() {
  const split = PAD + QUESTIONS_W + GAP / 2
  const merge = ANSWERS_X - GAP / 2
  return (
    <Picture label={LABEL} width={WIDTH} height={HEIGHT}>
      {(arrow) => (
        <>
          {PIPELINES.map(({ id }, row) => (
            <g key={id}>
              <Line
                d={`M${PAD + QUESTIONS_W} ${MIDDLE} H${split} V${centre(row)} H${APPROACH_X}`}
                arrow={arrow}
              />
              <Line
                d={`M${APPROACH_X + APPROACH_W} ${centre(row)} H${merge} V${MIDDLE} H${ANSWERS_X}`}
                arrow={arrow}
              />
            </g>
          ))}
          <Line
            d={`M${ANSWERS_X + SIDE_W} ${MIDDLE} H${SCORES_X}`}
            arrow={arrow}
          />
          <Line
            d={`M${SCORES_X + SIDE_W / 2} ${KEY_Y} V${MIDDLE + BOX_H / 2}`}
            arrow={arrow}
          />
          <Box
            x={PAD}
            y={MIDDLE - BOX_H / 2}
            w={QUESTIONS_W}
            lines={['Questions']}
          />
          {PIPELINES.map(({ id, label }, row) => (
            <Box
              key={id}
              x={APPROACH_X}
              y={rowY(row)}
              w={APPROACH_W}
              lines={[label]}
              tone={TONES[id]}
            />
          ))}
          <Box
            x={ANSWERS_X}
            y={MIDDLE - BOX_H / 2}
            w={SIDE_W}
            lines={['Answers']}
          />
          <Box
            x={SCORES_X}
            y={MIDDLE - BOX_H / 2}
            w={SIDE_W}
            lines={['Scores']}
          />
          <Box x={SCORES_X} y={KEY_Y} w={SIDE_W} lines={['Answer key']} />
        </>
      )}
    </Picture>
  )
}
