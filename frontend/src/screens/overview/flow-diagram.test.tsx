import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { FlowDiagram } from './flow-diagram'
import { LANES, STEP_LINES } from './lanes'

const ORDER = {
  'A, B and C': ['Search passages'],
  'B · Graph': ['Find starting points', 'Follow relationships'],
  'C · Graph + Ontology': [
    'Add ontology terms',
    'Find starting points',
    'Follow relationships',
    'Add linked records',
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
      'A, B and C: Search passages.',
      'B · Graph: Find starting points, then Follow relationships.',
      'C · Graph + Ontology: Add ontology terms, then Find starting points, then Follow relationships, then Add linked records.',
    ])
    expect(items.at(-1)).toBe(
      'All three then re-order and pick, then answer with sources.',
    )
  })

  it('is one image with a title and a description', () => {
    render(<FlowDiagram />)
    const image = screen.getByRole('img', {
      name: 'How the three approaches differ',
    })
    expect(image).toHaveAccessibleDescription(STEP_LINES.join(' '))
    expect(within(image).getByText('Re-order and pick')).toBeInTheDocument()
  })
})
