import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { FlowDiagram } from './flow-diagram'
import { LANES, STEP_LINES } from '../run/lanes'

const ORDER = {
  'A, B and C': ['Search passages', 'Re-order passages'],
  'B · Graph': [
    'Find starting points',
    'Follow relationships',
    'Rank by the graph',
  ],
  'C · Graph + Ontology': [
    'Find starting points',
    'Add ontology terms',
    'Follow relationships',
    'Add linked records',
    'Rank by the graph',
  ],
}

describe('FlowDiagram', () => {
  it('draws the steps of each lane in order, matching the retrieval pipelines', () => {
    const { container } = render(<FlowDiagram />)
    const drawn = Object.fromEntries(
      [...container.querySelectorAll('[data-lane]')].map((lane) => [
        lane.getAttribute('data-lane'),
        [...lane.querySelectorAll('[data-step]')].map(
          (step) => step.querySelector('text')?.textContent,
        ),
      ]),
    )
    expect(drawn).toEqual(ORDER)
    expect(Object.fromEntries(LANES.map((l) => [l.label, l.steps]))).toEqual(
      ORDER,
    )
  })

  it('says the same in words, in the same order, for screen readers', () => {
    render(<FlowDiagram />)
    const items = screen.getAllByRole('listitem').map((li) => li.textContent)
    expect(items).toEqual(STEP_LINES)
    expect(items.slice(1, 4)).toEqual([
      'A, B and C: Search passages, then Re-order passages.',
      'B · Graph: Find starting points, then Follow relationships, then Rank by the graph.',
      'C · Graph + Ontology: Find starting points, then Add ontology terms, then Follow relationships, then Add linked records, then Rank by the graph.',
    ])
    // Method v0.3: only passages are re-ordered, and B and C fill one budget by turns.
    expect(items.slice(-2)).toEqual([
      'All three then fill one budget, then answer with sources.',
      'B and C take turns: a passage, then a graph record.',
    ])
    expect(items.join(' ')).not.toMatch(/re-order and pick/i)
  })

  it('is one image with a title and a description', () => {
    render(<FlowDiagram />)
    const image = screen.getByRole('img', {
      name: 'How the three approaches differ',
    })
    expect(image).toHaveAccessibleDescription(STEP_LINES.join(' '))
    expect(within(image).getByText('Fill one budget')).toBeInTheDocument()
    // Under the picture too; the list says it again for screen readers.
    expect(
      screen.getByText('B and C take turns: a passage, then a graph record.', {
        selector: 'figcaption',
      }),
    ).toBeVisible()
  })
})
