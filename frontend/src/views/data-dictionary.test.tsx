import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { DataDictionary } from './data-dictionary'

describe('DataDictionary', () => {
  it('opens on the interactive Sample Database Rows tab with real warehouse records', () => {
    render(<DataDictionary />)

    expect(
      screen.getByRole('heading', {
        name: 'Inspect the synthetic enterprise data, graph and ontology',
      }),
    ).toBeVisible()
    expect(
      screen.getByRole('heading', {
        name: 'Real sample rows from the demo warehouse',
      }),
    ).toBeVisible()
    expect(
      screen.getByText('How one incident is represented across all 3 layers'),
    ).toBeVisible()
    expect(screen.getAllByText('INC_S007_GR').length).toBeGreaterThan(0)
    expect(screen.getAllByText('PLV_PAYMENTS_3').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: /games\.parquet/i }))
    expect(screen.getByText('Albion Millions')).toBeVisible()
    expect(screen.getByText('2.50')).toBeVisible()
  })

  it('switches cleanly across Warehouse, Graph and Ontology tabs without stacking everything on one scroll', () => {
    render(<DataDictionary />)

    fireEvent.click(screen.getByRole('tab', { name: /2 · Warehouse Schema/i }))
    expect(
      screen.getByRole('heading', { name: 'Warehouse tables & fields' }),
    ).toBeVisible()
    expect(screen.getByText('Reference and master data')).toBeVisible()

    fireEvent.click(screen.getByRole('tab', { name: /3 · Graph Overlay/i }))
    expect(
      screen.getByRole('heading', { name: 'The graph overlay' }),
    ).toBeVisible()
    expect(screen.getAllByText('AVAILABLE_IN').length).toBeGreaterThan(0)
    expect(screen.getAllByText('USES_PAYMENT').length).toBeGreaterThan(0)

    fireEvent.click(
      screen.getByRole('tab', { name: /4 · Enterprise Ontology/i }),
    )
    expect(screen.getByRole('heading', { name: 'The ontology' })).toBeVisible()
    expect(
      screen.getAllByText('CONCEPT_PLATFORM_INCIDENT').length,
    ).toBeGreaterThan(0)
    expect(
      screen.getByText(/Only INSTANCE_OF and MAPS_TO bindings exist/),
    ).toBeVisible()
  })
})
