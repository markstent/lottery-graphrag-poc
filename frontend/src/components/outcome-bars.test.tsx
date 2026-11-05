import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import type { Outcomes } from '../results/outcomes'
import { OutcomeBars } from './outcome-bars'

const cell = (
  r: number,
  p: number,
  w: number,
  d: [number, number, number],
  partlySum: number,
) => ({
  scored: r + p + w,
  right: r,
  partly: p,
  wrong: w,
  right_declined: d[0],
  partly_declined: d[1],
  wrong_declined: d[2],
  not_scored: 0,
  partly_score_sum: partlySum,
})

const OUTCOMES: Outcomes = {
  recorded: true,
  evidence: {
    A: {
      repeats: 300,
      found: 321,
      missed: 421,
      found_share: 0.4201,
      extra_per_question: 16.2,
    },
    B: {
      repeats: 300,
      found: 330,
      missed: 412,
      found_share: 0.4476,
      extra_per_question: 15.8,
    },
    C: {
      repeats: 300,
      found: 410,
      missed: 332,
      found_share: 0.5685,
      extra_per_question: 16.4,
    },
  },
  answers: {
    // Partly right sums that give the published answer scores, 0.58, 0.61 and 0.67.
    A: cell(117, 103, 80, [5, 15, 71], 57),
    B: cell(131, 101, 68, [6, 25, 64], 52),
    C: cell(149, 98, 53, [5, 25, 47], 52),
  },
}

afterEach(cleanup)

const figure = (name: string) =>
  screen.getByText(name).closest('figure') as HTMLElement

describe('OutcomeBars', () => {
  it('says the run is not recorded and draws no bar', () => {
    render(
      <OutcomeBars outcomes={{ recorded: false, evidence: {}, answers: {} }} />,
    )
    expect(screen.getByText('Not recorded for this run.')).toBeInTheDocument()
    expect(screen.queryByRole('figure')).toBeNull()
  })

  it('shows the evidence found per approach from the per-question share, with extra records beside', () => {
    render(<OutcomeBars outcomes={OUTCOMES} />)
    const evidence = within(figure('Evidence found'))
    expect(
      evidence.getByRole('img', {
        name: /Text search: 42 percent .* 58 percent/,
      }),
    ).toBeInTheDocument()
    expect(
      evidence.getByRole('img', { name: /Graph: 45 percent/ }),
    ).toBeInTheDocument()
    expect(
      evidence.getByRole('img', { name: /Graph \+ Ontology: 57 percent/ }),
    ).toBeInTheDocument()
    expect(
      evidence.getAllByText(/about 16 extra records per question/),
    ).toHaveLength(3)
  })

  it('shows three answer bands whose hatched declined parts sit inside them', () => {
    render(<OutcomeBars outcomes={OUTCOMES} />)
    const answers = within(figure('Answers by score'))
    const label = answers.getByRole('img', {
      name: /Text search: answer score 58 percent; right 117/,
    })
    expect(label).toHaveAccessibleName(
      /5 of them said the sources could not answer/,
    )
    expect(label).toHaveAccessibleName(
      /partly right 103.*15 of them said the sources could not answer/,
    )
    expect(label).toHaveAccessibleName(
      /wrong 80.*71 of them said the sources could not answer/,
    )
    const bar = label.querySelector('[data-bar]')!
    const widths = [...bar.querySelectorAll('[data-band]')].map((band) =>
      parseFloat((band as HTMLElement).style.width),
    )
    expect(widths.reduce((a, b) => a + b, 0)).toBeCloseTo(100)
    const hatch = bar.querySelector(
      '[data-band="right"] [data-declined]',
    ) as HTMLElement
    expect(parseFloat(hatch.style.width)).toBeCloseTo((5 / 117) * 100)
    expect(
      answers.getByText(/can say the sources could not answer and still score/),
    ).toBeInTheDocument()
  })

  it('shows the answer score beside each answer bar, from the bands', () => {
    render(<OutcomeBars outcomes={OUTCOMES} />)
    const answers = within(figure('Answers by score'))
    for (const [name, score] of [
      ['Text search', 58],
      ['Graph', 61],
      ['Graph \\+ Ontology', 67],
    ] as const) {
      expect(
        answers.getByRole('img', {
          name: new RegExp(`^${name}: answer score ${score} percent;`),
        }),
      ).toBeInTheDocument()
    }
    expect(
      answers.getAllByText(/^Answer score (58|61|67) percent$/),
    ).toHaveLength(3)
  })

  it('says beside each bar how many in each band could not answer', () => {
    render(<OutcomeBars outcomes={OUTCOMES} />)
    const answers = within(figure('Answers by score'))
    expect(
      answers.getByText('Right 117 (5 of them could not answer)'),
    ).toBeInTheDocument()
    expect(
      answers.getByText('Wrong 80 (71 of them could not answer)'),
    ).toBeInTheDocument()
  })

  it('keys the hatching on a neutral swatch, not on a band colour', () => {
    render(<OutcomeBars outcomes={OUTCOMES} />)
    const key = within(figure('Answers by score'))
      .getByText(/^Hatched:/)
      .querySelector('i') as HTMLElement
    expect(key.style.backgroundColor).toBe('var(--color-grey-500)')
    expect(key.style.backgroundImage).toContain('repeating-linear-gradient')
  })

  it('titles the evidence figure as the caller names it', () => {
    render(
      <OutcomeBars
        outcomes={OUTCOMES}
        evidenceTitle="Evidence found (evidence recall, as in the Verdict)"
      />,
    )
    expect(
      screen.getByText('Evidence found (evidence recall, as in the Verdict)'),
    ).toBeInTheDocument()
  })

  it('names the answers not scored only when there are some', () => {
    const { rerender } = render(<OutcomeBars outcomes={OUTCOMES} />)
    expect(screen.queryByText(/not scored/i)).toBeNull()
    rerender(
      <OutcomeBars
        outcomes={{
          ...OUTCOMES,
          answers: { A: { ...OUTCOMES.answers.A, not_scored: 4 } },
        }}
      />,
    )
    expect(screen.getByText(/4 answers were not scored/)).toBeInTheDocument()
  })

  it('lists every count in the table twins', async () => {
    const user = userEvent.setup()
    render(<OutcomeBars outcomes={OUTCOMES} />)
    await user.click(
      within(figure('Evidence found')).getByRole('button', {
        name: 'Show as table',
      }),
    )
    const evidence = within(figure('Evidence found')).getByRole('table')
    for (const text of ['321', '421', '42 percent', '16']) {
      expect(within(evidence).getAllByText(text).length).toBeGreaterThan(0)
    }
    await user.click(
      within(figure('Answers by score')).getByRole('button', {
        name: 'Show as table',
      }),
    )
    const answers = within(figure('Answers by score')).getByRole('table')
    for (const text of ['117', '103', '80', '5', '15', '71', '300']) {
      expect(within(answers).getAllByText(text).length).toBeGreaterThan(0)
    }
  })
})
