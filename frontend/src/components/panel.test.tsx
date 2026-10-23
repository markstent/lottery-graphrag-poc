import { readFileSync } from 'node:fs'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ApiError } from '../api/http'
import { Panel } from './panel'

describe('Panel', () => {
  it('shows its title, purpose and content when ready', () => {
    render(
      <Panel state="ready" title="Scores" purpose="How each approach did">
        <p>content</p>
      </Panel>,
    )
    expect(screen.getByRole('region', { name: 'Scores' })).toBeVisible()
    expect(screen.getByText('How each approach did')).toBeVisible()
    expect(screen.getByText('content')).toBeVisible()
  })

  it('shows a skeleton of the content shape while loading, and no content', () => {
    render(
      <Panel
        state="loading"
        title="Scores"
        skeleton={<div data-testid="shape" />}
      >
        <p>content</p>
      </Panel>,
    )
    expect(screen.getByRole('status')).toHaveTextContent('Loading Scores')
    expect(screen.getByTestId('shape')).toBeInTheDocument()
    expect(screen.queryByText('content')).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Scores' })).toHaveAttribute(
      'aria-busy',
      'true',
    )
  })

  it('says why it is empty', () => {
    render(
      <Panel state="empty" title="Scores" message="No official run yet." />,
    )
    expect(screen.getByText('No official run yet.')).toBeVisible()
  })

  it('says why it is disabled and hides the content', () => {
    render(
      <Panel state="disabled" title="Scores" message="Needs a running model.">
        <p>content</p>
      </Panel>,
    )
    expect(screen.getByText('Needs a running model.')).toBeVisible()
    expect(screen.queryByText('content')).not.toBeInTheDocument()
  })

  it('shows the error message, with Retry when the error is retryable', () => {
    const onRetry = vi.fn()
    render(
      <Panel
        state="error"
        title="Scores"
        error={new ApiError('RUN_ERROR', 'The server did not answer.', true, 0)}
        onRetry={onRetry}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The server did not answer.',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('offers no Retry when the error is not retryable', () => {
    render(
      <Panel
        state="error"
        title="Scores"
        error={new ApiError('NOT_FOUND', 'No such record.', false, 404)}
        onRetry={() => undefined}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('No such record.')
    expect(
      screen.queryByRole('button', { name: 'Retry' }),
    ).not.toBeInTheDocument()
  })
})

describe('reduced-motion stylesheet', () => {
  it('stops the skeleton pulse and collapses transitions under the root class', () => {
    const css = readFileSync('src/index.css', 'utf8').replace(/\s+/g, ' ')
    expect(css).toContain('.reduced-motion .skeleton-bar { animation: none; }')
    expect(css).toContain('.reduced-motion *, .reduced-motion *::before')
  })
})
