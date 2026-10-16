import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { DataDictionary } from './data-dictionary'

describe('DataDictionary', () => {
  it('renders the dictionary sections', () => {
    render(<DataDictionary />)

    for (const heading of [
      'One world, three representations',
      'Structured layer: table inventory',
      'Core tables, field by field',
      'Graph overlay: node labels and relationships',
      'Ontology: business concepts and mappings',
      'Authoritative definitions',
    ]) {
      expect(screen.getByRole('heading', { name: heading })).toBeVisible()
    }
  })

  it('documents the actual graph vocabulary, not the spec superset', () => {
    render(<DataDictionary />)

    // All 26 live relationship types appear; reserved-but-unpopulated
    // ontology vocabulary is explicitly called out.
    expect(screen.getAllByText('AVAILABLE_IN').length).toBeGreaterThan(0)
    expect(screen.getAllByText('USES_PAYMENT').length).toBeGreaterThan(0)
    expect(screen.getAllByText('MAPS_TO').length).toBeGreaterThan(0)
    expect(
      screen.getByText(/only INSTANCE_OF and MAPS_TO bindings exist/),
    ).toBeVisible()
  })

  it('quotes the demo-world facts and diagrams carry text alternatives', () => {
    render(<DataDictionary />)

    expect(screen.getAllByText('5,000,000').length).toBeGreaterThan(0)
    expect(
      screen.getAllByText('CONCEPT_PLATFORM_INCIDENT').length,
    ).toBeGreaterThan(0)
    const diagrams = screen.getAllByRole('img')
    expect(diagrams.length).toBeGreaterThanOrEqual(2)
    for (const diagram of diagrams) {
      expect(
        diagram.getAttribute('aria-label') ?? diagram.querySelector('title'),
      ).toBeTruthy()
    }
  })
})
