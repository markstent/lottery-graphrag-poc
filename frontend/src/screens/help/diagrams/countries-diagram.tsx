/**
 * One idea, four names, as one picture: each country's own name for its
 * national draw, in that country's colour and with the country named, one
 * above the other, joined to the one shared idea in the ontology on the
 * right. The column keeps the picture narrow enough to read beside the sidebar.
 */

import { Box, Line, Picture } from './parts'
import { BOX_H2, boxWidth, PAD, type Tone } from './style'

const COUNTRIES = [
  {
    country: 'United Kingdom',
    name: 'National Draw',
    market: 'var(--color-market-uk)',
  },
  { country: 'Greece', name: 'Αριθμολαχείο', market: 'var(--color-market-gr)' },
  {
    country: 'Austria',
    name: 'Zahlenziehung',
    market: 'var(--color-market-at)',
  },
  {
    country: 'Czech Republic',
    name: 'Číselná loterie',
    market: 'var(--color-market-cz)',
  },
] as const

/** The space between two countries, one above the other. */
const ROW_GAP = 12
/** The run from the countries to the shared idea, with the joining lines halfway. */
const RUN = 64
const COUNTRY_W = Math.max(
  ...COUNTRIES.flatMap(({ country, name }) => [
    boxWidth(country),
    boxWidth(name),
  ]),
)
const IDEA_LINES = ['National draw', 'one shared idea in the ontology'] as const
const IDEA_W = boxWidth(IDEA_LINES[1])
const IDEA_X = PAD + COUNTRY_W + RUN
const WIDTH = IDEA_X + IDEA_W + PAD
const HEIGHT =
  2 * PAD + COUNTRIES.length * BOX_H2 + (COUNTRIES.length - 1) * ROW_GAP
const IDEA_Y = (HEIGHT - BOX_H2) / 2
const countryY = (index: number) => PAD + index * (BOX_H2 + ROW_GAP)

/** Each colour is written out whole, so the style sheet keeps it. */
const countryTone = (market: string): Tone => ({
  fill: 'var(--color-surface)',
  stroke: market,
  text: 'var(--color-text-primary)',
})
const IDEA: Tone = {
  fill: 'var(--color-state-concept-fill)',
  stroke: 'var(--color-state-concept-stroke)',
  text: 'var(--color-ontology)',
}

const LABEL = [
  'One idea, four names.',
  'Each country calls its national draw by its own name: National Draw in the United Kingdom, Αριθμολαχείο in Greece, Zahlenziehung in Austria and Číselná loterie in the Czech Republic.',
  'The ontology joins all four to one shared idea, National draw.',
].join(' ')

export function CountriesDiagram() {
  return (
    <Picture label={LABEL} width={WIDTH} height={HEIGHT}>
      {(arrow) => (
        <>
          {COUNTRIES.map(({ country }, index) => {
            const from = countryY(index) + BOX_H2 / 2
            const to = IDEA_Y + ((index + 0.5) * BOX_H2) / COUNTRIES.length
            const turn = PAD + COUNTRY_W + RUN / 2
            return (
              <Line
                key={country}
                d={`M${PAD + COUNTRY_W} ${from} H${turn} V${to} H${IDEA_X}`}
                arrow={arrow}
              />
            )
          })}
          {COUNTRIES.map(({ country, name, market }, index) => (
            <Box
              key={country}
              x={PAD}
              y={countryY(index)}
              w={COUNTRY_W}
              h={BOX_H2}
              lines={[country, name]}
              tone={countryTone(market)}
            />
          ))}
          <Box
            x={IDEA_X}
            y={IDEA_Y}
            w={IDEA_W}
            h={BOX_H2}
            lines={IDEA_LINES}
            tone={IDEA}
          />
        </>
      )}
    </Picture>
  )
}
