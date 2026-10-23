import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { EVIDENCE_STATES } from '../design/evidence-states'
import { GraphLegend } from './graph-legend'

describe('GraphLegend', () => {
  it('lists the seven states and the evidence path', () => {
    render(<GraphLegend pipeline="B" />)
    const items = within(screen.getByRole('list')).getAllByRole('listitem')
    expect(items.map((i) => i.textContent)).toEqual([
      ...Object.values(EVIDENCE_STATES).map((s) => s.label),
      'Evidence path',
    ])
  })

  it('adds "added by the ontology" for C when the canvas marks it, and only then', () => {
    const { rerender } = render(<GraphLegend pipeline="C" ontologyAdded />)
    expect(screen.getByText('Added by the ontology')).toBeVisible()
    expect(screen.getByText('+ ontology')).toBeVisible()
    rerender(<GraphLegend pipeline="C" />)
    expect(screen.queryByText('Added by the ontology')).toBeNull()
    rerender(<GraphLegend pipeline="B" ontologyAdded />)
    expect(screen.queryByText('Added by the ontology')).toBeNull()
  })

  it('keys what the ontology added by its badge and its dotted line, with no bare swatch', () => {
    render(<GraphLegend pipeline="C" ontologyAdded />)
    const item = screen.getByText('Added by the ontology').closest('li')!
    expect(item.querySelectorAll('svg')).toHaveLength(1)
    expect(item.querySelector('rect')).toBeNull()
  })

  it('uses none of the banned words', () => {
    const { container } = render(<GraphLegend pipeline="C" ontologyAdded />)
    expect(container.textContent).not.toMatch(
      /honest|never|real|fake|prototype|telemetry|seed|chunk|rerank|MAPS_TO/i,
    )
  })
})
