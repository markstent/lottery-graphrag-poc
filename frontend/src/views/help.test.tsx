import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Help } from './help'

describe('Help', () => {
  it('renders all documented sections with a section navigation', () => {
    render(<Help />)

    const nav = screen.getByRole('navigation', { name: 'Help sections' })
    expect(within(nav).getAllByRole('link')).toHaveLength(11)

    for (const heading of [
      'What this application is',
      'Quick start',
      'Screen-by-screen guide',
      'What happens during a run',
      'Saved demo questions',
      'Metrics and how to read them',
      'Data, scenarios and provenance',
      'Running the backend',
      'Troubleshooting',
      'Glossary',
      'Accessibility',
    ]) {
      expect(screen.getByRole('heading', { name: heading })).toBeVisible()
    }
  })

  it('documents the three pipelines and the saved demo questions', () => {
    render(<Help />)

    expect(screen.getByText('A · Current Approach')).toBeVisible()
    expect(screen.getByText('B · + Graph')).toBeVisible()
    expect(screen.getByText('C · + Graph & Ontology')).toBeVisible()
    expect(screen.getByText('DEMO-01')).toBeVisible()
    expect(screen.getByText('DEMO-04')).toBeVisible()
    // Committed validation numbers, quoted not invented.
    expect(screen.getByText(/A 0\.02 vs B\/C 0\.62/)).toBeVisible()
  })
})
