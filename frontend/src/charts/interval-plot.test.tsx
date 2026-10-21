import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { IntervalPlot, type IntervalPlotProps } from './interval-plot'

const props: IntervalPlotProps = {
  title: 'What each layer adds',
  unit: 'evidence points (second minus first)',
  zero: true,
  rows: [
    {
      key: 'ba',
      label: 'B vs A, single record',
      mean: 12,
      low: 6,
      high: 19,
      n: 36,
      groups: 12,
      inFamily: true,
      pipeline: 'B',
    },
    {
      key: 'cb',
      label: 'C vs B, single record',
      mean: -3,
      low: -9,
      high: 2,
      n: 36,
      groups: 12,
      inFamily: true,
      pipeline: 'C',
    },
    {
      key: 'cb2',
      label: 'C vs B, name-anchored',
      mean: 1,
      low: -4,
      high: 7,
      n: 8,
      groups: 2,
      inFamily: false,
      note: 'not tested: too few pairs or groups',
      pipeline: 'C',
    },
  ],
}

const hits = (c: HTMLElement) =>
  Array.from(c.querySelectorAll<SVGElement>('[data-mark="hit"]'))

describe('IntervalPlot', () => {
  it('labels each row with its pairs and groups', () => {
    render(<IntervalPlot {...props} />)
    expect(screen.getAllByText('36 pairs in 12 groups')).toHaveLength(2)
    expect(screen.getByText('8 pairs in 2 groups')).toBeInTheDocument()
  })

  it('formats a large n with separators and a single pair in the singular', () => {
    render(
      <IntervalPlot
        {...props}
        rows={[
          { ...props.rows[0], n: 12840, groups: 1204 },
          { ...props.rows[1], n: 1, groups: 1 },
        ]}
      />,
    )
    expect(screen.getByText('12,840 pairs in 1,204 groups')).toBeInTheDocument()
    expect(screen.getByText('1 pair in 1 group')).toBeInTheDocument()
  })

  it('draws a vertical zero line on the zero tick', () => {
    const { container } = render(<IntervalPlot {...props} />)
    const zero = container.querySelector('[data-mark="zero"]')!
    const tick = container.querySelector('[data-grid="0"]')!
    expect(zero.getAttribute('x1')).toBe(tick.getAttribute('x1'))
    expect(zero.getAttribute('y1')).not.toBe(zero.getAttribute('y2'))
  })

  it('omits the zero line when asked', () => {
    const { container } = render(<IntervalPlot {...props} zero={false} />)
    expect(container.querySelector('[data-mark="zero"]')).toBeNull()
  })

  it('maps interval endpoints and the mean through one scale', () => {
    const { container } = render(<IntervalPlot {...props} domain={[-20, 20]} />)
    const row = container.querySelector(
      '[data-mark="interval"][data-row="ba"]',
    )!
    const x = (v: number) =>
      container.querySelector(`[data-grid="${v}"]`)!.getAttribute('x1')
    expect(row.getAttribute('data-x-low')).not.toBeNull()
    // 0 sits at the middle of [-20, 20]; 10 is halfway between 0 and 20.
    const x0 = Number(x(0))
    const x20 = Number(x(20))
    const xOf = (v: number) => x0 + ((x20 - x0) * v) / 20
    expect(Number(row.getAttribute('data-x-low'))).toBeCloseTo(xOf(6))
    expect(Number(row.getAttribute('data-x-high'))).toBeCloseTo(xOf(19))
    expect(Number(row.getAttribute('data-x-mean'))).toBeCloseTo(xOf(12))
  })

  it('draws the given numbers without checking they agree', () => {
    const { container } = render(
      <IntervalPlot
        {...props}
        domain={[-20, 20]}
        rows={[{ ...props.rows[0], mean: 18, low: 6, high: 8 }]}
      />,
    )
    // The mean lies outside its interval; both are drawn where they were given.
    const row = container.querySelector('[data-mark="interval"]')!
    expect(Number(row.getAttribute('data-x-mean'))).toBeGreaterThan(
      Number(row.getAttribute('data-x-high')),
    )
  })

  it('draws a row without an interval as a labelled gap, not a zero', () => {
    const { container } = render(
      <IntervalPlot
        {...props}
        rows={[{ ...props.rows[0], mean: null, low: null, high: null }]}
      />,
    )
    expect(container.querySelector('[data-mark="interval"]')).toBeNull()
    expect(screen.getByText('no value')).toBeInTheDocument()
  })

  it('gives a plot with nothing drawn a readable axis around zero', () => {
    const { container } = render(
      <IntervalPlot
        {...props}
        rows={[{ ...props.rows[0], mean: null, low: null, high: null }]}
      />,
    )
    const ticks = Array.from(container.querySelectorAll('[data-grid]')).map(
      (g) => Number(g.getAttribute('data-grid')),
    )
    expect(ticks).toEqual([-1, -0.5, 0, 0.5, 1])
  })

  it('keeps a gap out of the domain', () => {
    const { container } = render(
      <IntervalPlot
        {...props}
        rows={[
          { ...props.rows[0], mean: 1, low: 0.5, high: 2 },
          { ...props.rows[1], mean: null, low: null, high: -900 },
        ]}
      />,
    )
    const labels = Array.from(container.querySelectorAll('[data-grid]')).map(
      (g) => Number(g.getAttribute('data-grid')),
    )
    expect(Math.min(...labels)).toBeGreaterThan(-5)
  })

  it('draws a hollow mark for a row outside the tested family and says why', () => {
    const { container } = render(<IntervalPlot {...props} />)
    expect(
      container.querySelector('[data-mark="mean"][data-row="cb2"]'),
    ).toHaveAttribute('data-tested', 'false')
    expect(
      container.querySelector('[data-mark="mean"][data-row="ba"]'),
    ).toHaveAttribute('data-tested', 'true')
    expect(screen.getByText(/not tested: too/)).toBeInTheDocument()
  })

  it('labels a negative result on the minus side of zero', () => {
    const { container } = render(<IntervalPlot {...props} />)
    const x = (v: number) =>
      Number(container.querySelector(`[data-grid="${v}"]`)!.getAttribute('x1'))
    const row = container.querySelector(
      '[data-mark="interval"][data-row="cb"]',
    )!
    expect(Number(row.getAttribute('data-x-mean'))).toBeLessThan(x(0))
  })

  it('shows a legend only when rows belong to two or more pipelines', () => {
    const { rerender } = render(<IntervalPlot {...props} />)
    expect(
      screen.getByRole('list', { name: 'Key to the pipelines' }),
    ).toBeInTheDocument()
    rerender(
      <IntervalPlot
        {...props}
        rows={props.rows.filter((r) => r.pipeline === 'C' && r.inFamily)}
      />,
    )
    expect(
      screen.queryByRole('list', { name: 'Key to the pipelines' }),
    ).toBeNull()
  })

  it('keys a not-tested row with a hollow grey dot in the legend', () => {
    const { rerender } = render(<IntervalPlot {...props} />)
    const legend = screen.getByRole('list', { name: 'Key to the pipelines' })
    expect(within(legend).getByText('not tested')).toBeInTheDocument()
    rerender(
      <IntervalPlot {...props} rows={props.rows.filter((r) => r.inFamily)} />,
    )
    expect(screen.queryByText('not tested')).toBeNull()
  })

  it('links the focused row to its tooltip with aria-describedby', async () => {
    const user = userEvent.setup()
    const { container } = render(<IntervalPlot {...props} />)
    await user.tab()
    await user.tab()
    expect(hits(container)[0]).toHaveAttribute(
      'aria-describedby',
      screen.getByRole('tooltip').id,
    )
    expect(hits(container)[1]).not.toHaveAttribute('aria-describedby')
  })

  it('widens a given domain to hold an interval end beyond it', () => {
    const { container } = render(
      <IntervalPlot
        {...props}
        domain={[-5, 5]}
        rows={[{ ...props.rows[0], mean: 12, low: 6, high: 30 }]}
      />,
    )
    const row = container.querySelector('[data-mark="interval"]')!
    const top = container.querySelector('[data-grid="30"]')!
    expect(Number(row.getAttribute('data-x-high'))).toBeCloseTo(
      Number(top.getAttribute('x1')),
    )
  })

  it('keeps the zero line inside the plot when the domain excludes zero', () => {
    const { container } = render(<IntervalPlot {...props} domain={[10, 20]} />)
    const grid = Array.from(container.querySelectorAll('[data-grid]')).map(
      (g) => Number(g.getAttribute('x1')),
    )
    const zero = Number(
      container.querySelector('[data-mark="zero"]')!.getAttribute('x1'),
    )
    expect(zero).toBeGreaterThanOrEqual(Math.min(...grid))
    expect(zero).toBeLessThanOrEqual(Math.max(...grid))
    expect(container.querySelector('[data-grid="0"]')).not.toBeNull()
  })

  it('offers the same numbers as a table', async () => {
    const user = userEvent.setup()
    render(<IntervalPlot {...props} />)
    await user.click(screen.getByRole('button', { name: 'Show as table' }))
    const row = within(screen.getByRole('table')).getByRole('row', {
      name: /B vs A, single record/,
    })
    expect(
      within(row)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['+12.0', '+6.0', '+19.0', '36 pairs in 12 groups', 'tested'])
  })

  it('opens its tooltip on focus, moves with arrows and closes on Escape', async () => {
    const user = userEvent.setup()
    const { container } = render(<IntervalPlot {...props} />)
    await user.tab()
    await user.tab()
    expect(hits(container)[0]).toHaveFocus()
    expect(screen.getByRole('tooltip')).toHaveTextContent('+12.0')
    expect(screen.getByRole('tooltip')).toHaveTextContent('+6.0 to +19.0')
    await user.keyboard('{ArrowDown}')
    expect(hits(container)[1]).toHaveFocus()
    expect(screen.getByRole('tooltip')).toHaveTextContent('-3.0')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('has an img role, a figure and a caption', () => {
    render(<IntervalPlot {...props} />)
    expect(within(screen.getByRole('figure')).getByRole('img')).toHaveAttribute(
      'aria-label',
      'What each layer adds',
    )
  })

  it('handles loading, empty, error and disabled', () => {
    const { rerender } = render(<IntervalPlot {...props} status="loading" />)
    expect(screen.getByRole('figure')).toHaveAttribute('aria-busy', 'true')
    rerender(<IntervalPlot {...props} rows={[]} />)
    expect(screen.getByText('No results to show.')).toBeInTheDocument()
    rerender(
      <IntervalPlot
        {...props}
        status="error"
        error="The comparison could not be read."
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The comparison could not be read.',
    )
    rerender(<IntervalPlot {...props} disabled />)
    expect(screen.getByRole('button', { name: 'Show as table' })).toBeDisabled()
  })
})
