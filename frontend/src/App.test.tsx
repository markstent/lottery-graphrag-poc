import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import App from './App'
import { ResultsDashboard } from './views/results-dashboard'

describe('App', () => {
  it('renders the application shell with primary navigation', () => {
    render(<App />)

    expect(screen.getByText('Semantic Context Lab')).toBeVisible()
    const nav = screen.getByRole('navigation', { name: 'Primary' })
    expect(nav).toBeVisible()
    expect(screen.getByRole('link', { name: 'Live Lab' })).toHaveAttribute(
      'href',
      '#/lab',
    )
    expect(
      screen.getByRole('link', { name: 'Semantic Layer' }),
    ).toHaveAttribute('href', '#/semantic')
  })

  it('lands on Live Lab by default', () => {
    render(<App />)

    expect(
      screen.getByRole('region', { name: 'Question composer' }),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Run' })).toBeVisible()
  })

  it('links to the in-app Help screen', () => {
    render(<App />)

    expect(screen.getByRole('link', { name: 'Help' })).toHaveAttribute(
      'href',
      '#/help',
    )
  })

  it('opens the inline Evidence Inspector drawer when a citation is clicked in Live Lab', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    fireEvent.click(screen.getByLabelText('Reduce motion'))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    const citationButton = screen.getByRole('button', {
      name: /Inspect citation Incident Report: INC_S007_GR/,
    })
    fireEvent.click(citationButton)

    expect(
      screen.getByRole('dialog', { name: 'Evidence inspection drawer' }),
    ).toBeVisible()
    expect(screen.getByText('Open full page ↗')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(
      screen.queryByRole('dialog', { name: 'Evidence inspection drawer' }),
    ).toBeNull()
  })

  it('embeds the benchmark question status log disclosure on Results Dashboard', () => {
    render(<ResultsDashboard />)

    expect(
      screen.getByText('Benchmark execution & question status log'),
    ).toBeVisible()
    expect(screen.getByText('Q-001')).toBeInTheDocument()
  })
})
