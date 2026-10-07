import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import App from './App'

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
})
