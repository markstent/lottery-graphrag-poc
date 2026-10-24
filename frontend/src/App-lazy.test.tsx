/**
 * A destination is its own chunk, so the first visit shows the Panel loading
 * state. It is a file of its own: a destination loaded by an earlier test in
 * the same file would no longer suspend.
 */

import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import App from './App'
import { SHELL_API, stubApi } from './test/api-stub'

afterEach(() => vi.unstubAllGlobals())

describe('App routes', () => {
  it('show a loading panel while a destination loads, then the destination', async () => {
    window.history.replaceState(null, '', '/#/help')
    stubApi(SHELL_API)
    render(<App />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading This page')
    expect(
      await screen.findByRole('navigation', { name: 'Help sections' }),
    ).toBeVisible()
    expect(screen.queryByText('Loading This page')).toBeNull()
  })
})
