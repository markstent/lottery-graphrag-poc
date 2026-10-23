import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { lazy, Suspense } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ErrorBoundary } from './error-boundary'

afterEach(() => vi.restoreAllMocks())

describe('ErrorBoundary', () => {
  it('shows its children when nothing fails', () => {
    render(
      <ErrorBoundary title="This page">
        <p>fine</p>
      </ErrorBoundary>,
    )
    expect(screen.getByText('fine')).toBeVisible()
  })

  it('shows the error panel with Reload page when a lazy import rejects, and logs the error', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    const Broken = lazy(() => Promise.reject(new Error('chunk 404')))
    render(
      <>
        <nav>shell</nav>
        <ErrorBoundary title="This page">
          <Suspense fallback={null}>
            <Broken />
          </Suspense>
        </ErrorBoundary>
      </>,
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This page could not be loaded.',
    )
    expect(screen.getByText('shell')).toBeVisible()
    expect(logged).toHaveBeenCalledWith(
      'A screen failed to render',
      expect.objectContaining({ message: 'chunk 404' }),
      expect.any(String),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Reload page' }))
    expect(reload).toHaveBeenCalledOnce()
    vi.unstubAllGlobals()
  })
})
