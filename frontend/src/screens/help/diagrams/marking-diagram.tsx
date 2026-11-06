/**
 * How an answer is marked, as one picture: the answer and the answer key go
 * together to the scoring program, which gives the answer score, and to two
 * AI judges, who give a second opinion.
 */

import { Box, Line, Picture } from './parts'
import { BOX_H, boxWidth, GAP, PAD } from './style'

const ROW_GAP = 24
const INPUT_W = boxWidth('Answer key')
const MARKER_W = Math.max(
  boxWidth('Scoring program'),
  boxWidth('Two AI judges'),
)
const RESULT_W = Math.max(boxWidth('Answer score'), boxWidth('Second opinion'))
const MARKER_X = PAD + INPUT_W + GAP
const RESULT_X = MARKER_X + MARKER_W + GAP
const WIDTH = RESULT_X + RESULT_W + PAD

const ROWS = [
  { input: 'Answer', marker: 'Scoring program', result: 'Answer score' },
  { input: 'Answer key', marker: 'Two AI judges', result: 'Second opinion' },
] as const
const rowY = (row: number) => PAD + row * (BOX_H + ROW_GAP)
const centre = (row: number) => rowY(row) + BOX_H / 2
const HEIGHT = rowY(ROWS.length - 1) + BOX_H + PAD

const LABEL = [
  'How an answer is marked.',
  'The answer and the answer key go together to a scoring program, which gives the answer score.',
  'They also go to two AI judges, who give a second opinion.',
].join(' ')

export function MarkingDiagram() {
  const join = PAD + INPUT_W + GAP / 2
  return (
    <Picture label={LABEL} width={WIDTH} height={HEIGHT}>
      {(arrow) => (
        <>
          {/* Both inputs meet on one line, which feeds both markers. */}
          <Line d={`M${join} ${centre(0)} V${centre(1)}`} />
          {ROWS.map(({ input }, row) => (
            <g key={input}>
              <Line d={`M${PAD + INPUT_W} ${centre(row)} H${join}`} />
              <Line d={`M${join} ${centre(row)} H${MARKER_X}`} arrow={arrow} />
              <Line
                d={`M${MARKER_X + MARKER_W} ${centre(row)} H${RESULT_X}`}
                arrow={arrow}
              />
            </g>
          ))}
          {ROWS.map(({ input, marker, result }, row) => (
            <g key={input}>
              <Box x={PAD} y={rowY(row)} w={INPUT_W} lines={[input]} />
              <Box x={MARKER_X} y={rowY(row)} w={MARKER_W} lines={[marker]} />
              <Box x={RESULT_X} y={rowY(row)} w={RESULT_W} lines={[result]} />
            </g>
          ))}
        </>
      )}
    </Picture>
  )
}
