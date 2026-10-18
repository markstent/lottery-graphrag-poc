import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Help } from './help'

describe('Help', () => {
  it('renders four focused tabs instead of a single bloated scroll', () => {
    render(<Help />)

    const tablist = screen.getByRole('tablist', { name: 'Help sections' })
    expect(within(tablist).getAllByRole('tab')).toHaveLength(4)

    expect(
      screen.getByRole('heading', {
        name: 'Three retrieval pipelines, one controlled experiment',
      }),
    ).toBeVisible()
    expect(screen.getByText('A · Conventional RAG')).toBeVisible()
    expect(screen.getByText('B · + Graph')).toBeVisible()
    expect(screen.getByText('C · + Graph & Ontology')).toBeVisible()
  })

  it('shows a concrete side-by-side data example on the second tab', () => {
    render(<Help />)

    fireEvent.click(
      screen.getByRole('tab', { name: '2 · Concrete Data Example' }),
    )
    expect(
      screen.getByRole('heading', {
        name: 'Concrete example: why Conventional RAG misses what the Graph finds',
      }),
    ).toBeVisible()
    expect(screen.getByText('DEMO-01 (Q30)')).toBeVisible()
    expect(screen.getByText('DEMO-04')).toBeVisible()
  })

  it('preserves committed benchmark numbers and operator commands in their tabs', () => {
    render(<Help />)

    fireEvent.click(
      screen.getByRole('tab', { name: '3 · Scores & Honesty Rule' }),
    )
    expect(screen.getByText(/A 0\.02 vs B\/C 0\.62/)).toBeVisible()

    fireEvent.click(screen.getByRole('tab', { name: '4 · Backend & Glossary' }))
    expect(
      screen.getByRole('heading', {
        name: 'Running the backend & troubleshooting',
      }),
    ).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Glossary' })).toBeVisible()
  })
})
