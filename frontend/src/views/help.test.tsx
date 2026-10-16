import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Help } from './help'

describe('Help', () => {
  it('renders all documented sections with a numbered reading path', () => {
    render(<Help />)

    const nav = screen.getByRole('navigation', { name: 'Help sections' })
    expect(within(nav).getAllByRole('link')).toHaveLength(11)

    for (const heading of [
      'The big picture',
      'Your path through the app',
      'Quick start',
      'What happens during a run',
      'Saved demo questions',
      'Reading the numbers',
      'Data, scenarios and provenance',
      'Running the backend',
      'Troubleshooting',
      'Glossary',
      'Accessibility',
    ]) {
      expect(screen.getByRole('heading', { name: heading })).toBeVisible()
    }
  })

  it('explains the three pipelines with a diagram and audience paths', () => {
    render(<Help />)

    // The pipeline comparison is a diagram with a text alternative.
    expect(
      screen.getByRole('img', { name: 'How the three pipelines differ' }),
    ).toBeVisible()
    expect(screen.getByText('Why this is a fair comparison')).toBeVisible()
    // Audience cards on the hero.
    expect(screen.getByText("I'm presenting the demo")).toBeVisible()
    expect(
      screen.getByText('I want to understand the experiment'),
    ).toBeVisible()
    expect(screen.getByText('I run the backend')).toBeVisible()
  })

  it('keeps the grounded facts: saved questions, metrics and provenance', () => {
    render(<Help />)

    expect(screen.getByText('DEMO-01')).toBeVisible()
    expect(screen.getByText('DEMO-04')).toBeVisible()
    // Committed validation numbers, quoted not invented.
    expect(screen.getByText(/A 0\.02 vs B\/C 0\.62/)).toBeVisible()
    // Diagrams carry text alternatives.
    for (const name of [
      'Suggested path through the seven screens',
      'Life of a run',
      "Where the score strip's numbers come from",
      'Every claim traces back to a source record',
    ]) {
      expect(screen.getByRole('img', { name })).toBeVisible()
    }
  })
})
