import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Blocks } from '../blocks'
import { DIAGRAM_NAMES, type DiagramName } from '../chapters'
import { HelpDataContext, type HelpData } from '../help-data'

afterEach(cleanup)

/** None of the six reads the settings, the bank or a run: everything is still loading. */
const LOADING = { status: 'loading', retry: () => undefined } as const
const HELP: HelpData = {
  level: 'plain',
  bank: LOADING,
  scores: 'none',
  story: null,
  settings: LOADING,
  recorded: LOADING,
}

/** What each new picture must say in words, both in its text alternative and in its drawn labels. */
const SAYS: Record<
  Exclude<DiagramName, 'approachA' | 'approachB' | 'approachC' | 'evidence'>,
  { label: readonly string[]; drawn: readonly string[] }
> = {
  test: {
    label: [
      'fixed set of questions',
      'three approaches',
      'A Text search',
      'B Graph',
      'C Graph + Ontology',
      'answers',
      'answer key',
      'scores',
    ],
    drawn: [
      'Questions',
      'A · Text search',
      'B · Graph',
      'C · Graph + Ontology',
      'Answers',
      'Answer key',
      'Scores',
    ],
  },
  world: {
    label: [
      'recipe',
      'a number and settings',
      'tables',
      'documents',
      'eight planted stories',
      'one world',
      'same recipe always rebuilds the same world',
    ],
    drawn: [
      'Recipe',
      'Program',
      'Tables',
      'Documents',
      'Eight planted stories',
      'One world',
      'same recipe always rebuilds the same world',
    ],
  },
  countries: {
    label: [
      'National Draw in the United Kingdom',
      'Αριθμολαχείο in Greece',
      'Zahlenziehung in Austria',
      'Číselná loterie in the Czech Republic',
      'one shared idea, National draw',
      'ontology',
    ],
    drawn: [
      'United Kingdom',
      'National Draw',
      'Greece',
      'Αριθμολαχείο',
      'Austria',
      'Zahlenziehung',
      'Czech Republic',
      'Číselná loterie',
      'National draw',
    ],
  },
  found: {
    label: [
      'facts a question needs',
      'what an approach brought',
      'Found: needed facts the evidence states',
      'Missed: needed facts it does not state',
      'Extra: records brought that state no needed fact',
    ],
    drawn: [
      'Facts the question needs',
      'What the approach brought',
      'Found',
      'Missed',
      'Extra',
    ],
  },
  marking: {
    label: [
      'answer and the answer key',
      'scoring program',
      'answer score',
      'two AI judges',
      'second opinion',
    ],
    drawn: [
      'Answer',
      'Answer key',
      'Scoring program',
      'Answer score',
      'Two AI judges',
      'Second opinion',
    ],
  },
  interval: {
    label: [
      'margin of error',
      'crosses zero',
      'too close to call',
      'clear of zero',
      'a clear difference',
    ],
    drawn: [
      'Too close to call',
      'A clear difference',
      'No difference',
      'Measured difference',
      'Margin of error',
    ],
  },
}

describe('the six Help diagrams', () => {
  it('are registered as diagram names', () => {
    expect(DIAGRAM_NAMES).toEqual(
      expect.arrayContaining(Object.keys(SAYS) as DiagramName[]),
    )
  })

  for (const [name, { label, drawn }] of Object.entries(SAYS)) {
    it(`${name}: one image that says its content in words`, () => {
      render(
        <HelpDataContext.Provider value={HELP}>
          <Blocks blocks={[{ kind: 'diagram', name: name as DiagramName }]} />
        </HelpDataContext.Provider>,
      )
      const picture = screen.getByRole('img')
      const alternative = picture.getAttribute('aria-label')!
      for (const phrase of label) expect(alternative).toContain(phrase)
      // Every part is named in text on the drawing too, so no part is told apart by colour alone.
      for (const phrase of drawn) expect(picture).toHaveTextContent(phrase)
      // The drawing itself is hidden from assistive technology: the text alternative speaks for it.
      expect(picture.querySelector('svg')).toHaveAttribute('aria-hidden')
    })
  }
})
