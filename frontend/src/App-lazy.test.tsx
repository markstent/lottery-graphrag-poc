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
  it(
    'show a loading panel while a destination loads, then the destination',
    { timeout: 20_000 },
    async () => {
      window.history.replaceState(null, '', '/#/help')
      stubApi(SHELL_API)
      render(<App />)
      expect(screen.getByRole('status')).toHaveTextContent('Loading This page')
      // The chunk is transformed cold here on purpose (that is the loading
      // state under test), and a cold transform under a loaded machine can take
      // several seconds, so this one wait allows for it.
      expect(
        await screen.findByRole(
          'navigation',
          { name: 'Help sections' },
          { timeout: 15_000 },
        ),
      ).toBeVisible()
      expect(screen.queryByText('Loading This page')).toBeNull()
    },
  )
})
