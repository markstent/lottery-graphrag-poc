import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { DataDictionary } from './data-dictionary'

describe('DataDictionary', () => {
  it('renders the dictionary sections', () => {
    render(<DataDictionary />)

    for (const heading of [
      'One world, three stores',
      'How the data connects',
      'Warehouse tables by domain',
      'Core tables, field by field',
      'The graph overlay',
      'The ontology',
      'Authoritative definitions',
    ]) {
      expect(screen.getByRole('heading', { name: heading })).toBeVisible()
    }
  })

  it('documents the actual graph vocabulary, not the spec superset', () => {
    render(<DataDictionary />)

    expect(screen.getAllByText('AVAILABLE_IN').length).toBeGreaterThan(0)
    expect(screen.getAllByText('USES_PAYMENT').length).toBeGreaterThan(0)
    expect(screen.getAllByText('MAPS_TO').length).toBeGreaterThan(0)
    expect(
      screen.getByText(/Only INSTANCE_OF and MAPS_TO bindings exist/),
    ).toBeVisible()
  })

  it('quotes demo-world facts across stores, chains and clusters', () => {
    render(<DataDictionary />)

    expect(screen.getAllByText('5,000,000').length).toBeGreaterThan(0)
    expect(
      screen.getAllByText('CONCEPT_PLATFORM_INCIDENT').length,
    ).toBeGreaterThan(0)
    // The six clusters are card titles.
    expect(screen.getByText('Knowledge')).toBeVisible()
    expect(screen.getByText('Commercial & ops')).toBeVisible()
    // Chain rails render the incident→platform→versions chain.
    expect(screen.getByText('Platforms fail')).toBeVisible()
  })

  it('opens with a how-to-read orientation', () => {
    render(<DataDictionary />)

    expect(screen.getByText('How to read this page')).toBeVisible()
    expect(screen.getByText('One world, three stores')).toBeVisible()
  })
})
