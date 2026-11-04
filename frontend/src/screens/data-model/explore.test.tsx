import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { ClickHint, ExploreSteps, Trail } from './explore'
import { STEPS } from './explore-steps'
import { GraphWhy } from './why'

describe('the Data Model way-finding', () => {
  it('numbers three steps for every tab', () => {
    for (const steps of Object.values(STEPS)) {
      const { unmount } = render(<ExploreSteps steps={steps} />)
      const list = screen.getByRole('region', { name: 'How to explore' })
      expect(list.querySelectorAll('li')).toHaveLength(3)
      unmount()
    }
  })

  it('links each step back and marks where the reader is', () => {
    render(
      <Trail
        steps={[
          { label: 'All tables', href: '#/data-model?tab=warehouse' },
          { label: 'incidents' },
        ]}
        hint="Click a row to open that record."
      />,
    )
    const trail = screen.getByRole('navigation', { name: 'You are here' })
    expect(trail).toContainElement(
      screen.getByRole('link', { name: 'All tables' }),
    )
    expect(screen.getByText('incidents')).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByText('Click a row to open that record.')).toBeVisible()
  })

  it('shows a cue that something opens when chosen', () => {
    render(<ClickHint>Click a table to open its rows.</ClickHint>)
    expect(screen.getByText('Click a table to open its rows.')).toBeVisible()
  })

  it('folds an explanation away and keeps it folded for the reader', async () => {
    window.localStorage.clear()
    const caps = { max_depth: 2, max_total_nodes: 200 }
    const { unmount } = render(<GraphWhy caps={caps} />)
    const where = screen.getByRole('region', {
      name: 'Where the links come from',
    })
    expect(where).toBeVisible()
    await userEvent.click(screen.getByText('Hide'))
    expect(screen.getByText('Show')).toBeVisible()
    unmount()
    render(<GraphWhy caps={caps} />)
    expect(screen.getByText('Show')).toBeVisible()
    window.localStorage.clear()
  })
})
