/**
 * One idea, four names, as one picture: each country's own name for its
 * national draw, in that country's colour and with the country named, and
 * the one shared idea in the ontology that joins them.
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

const COLUMN_GAP = 16
/** The drop from the countries to the shared idea, with the joining lines halfway. */
const DROP = 48
const COUNTRY_W = Math.max(
  ...COUNTRIES.flatMap(({ country, name }) => [
    boxWidth(country),
    boxWidth(name),
  ]),
)
const WIDTH = 2 * PAD + 4 * COUNTRY_W + 3 * COLUMN_GAP
const IDEA_LINES = ['National draw', 'one shared idea in the ontology'] as const
const IDEA_W = boxWidth(IDEA_LINES[1])
const IDEA_X = (WIDTH - IDEA_W) / 2
const IDEA_Y = PAD + BOX_H2 + DROP
const HEIGHT = IDEA_Y + BOX_H2 + PAD

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
            const from = PAD + index * (COUNTRY_W + COLUMN_GAP) + COUNTRY_W / 2
            const to = IDEA_X + ((index + 0.5) * IDEA_W) / COUNTRIES.length
            return (
              <Line
                key={country}
                d={`M${from} ${PAD + BOX_H2} V${PAD + BOX_H2 + DROP / 2} H${to} V${IDEA_Y}`}
                arrow={arrow}
              />
            )
          })}
          {COUNTRIES.map(({ country, name, market }, index) => (
            <Box
              key={country}
              x={PAD + index * (COUNTRY_W + COLUMN_GAP)}
              y={PAD}
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
