import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Help } from './help'

describe('Help', () => {
  it('renders eight sections behind a numbered reading path', () => {
    render(<Help />)

    const nav = screen.getByRole('navigation', { name: 'Help sections' })
    expect(within(nav).getAllByRole('link')).toHaveLength(8)

    for (const heading of [
      'The big picture',
      'A five-minute tour',
      'Saved demo questions',
      'Reading the numbers',
      'Data and provenance',
      'Running the backend',
      'Troubleshooting',
      'Glossary and accessibility',
    ]) {
      expect(screen.getByRole('heading', { name: heading })).toBeVisible()
    }
  })

  it('compares the three pipelines as cards under a shared head', () => {
    render(<Help />)

    expect(screen.getByText('A · Conventional RAG')).toBeVisible()
    expect(screen.getByText('B · + Graph')).toBeVisible()
    expect(screen.getByText('C · + Ontology')).toBeVisible()
    expect(screen.getByText('Embed the question')).toBeVisible()
    expect(screen.getByText('Built-in guardrails')).toBeVisible()
  })

  it('keeps the grounded facts and the audience paths', () => {
    render(<Help />)

    expect(screen.getByText('Presenting?')).toBeVisible()
    expect(screen.getByText('Evaluating?')).toBeVisible()
    expect(screen.getByText('Operating?')).toBeVisible()
    expect(screen.getByText('DEMO-01')).toBeVisible()
    expect(screen.getByText('DEMO-04')).toBeVisible()
    // Committed validation numbers, quoted not invented.
    expect(screen.getByText(/A 0\.02 vs B\/C 0\.62/)).toBeVisible()
  })
})
