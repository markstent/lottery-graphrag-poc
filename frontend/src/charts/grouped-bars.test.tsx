import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { PIPELINES } from '../design/pipelines'
import { GroupedBars, type GroupedBarsProps } from './grouped-bars'

const props: GroupedBarsProps = {
  title: 'Evidence by question type',
  unit: 'evidence points',
  domain: [0, 100],
  groups: [
    { key: 'H1', label: 'Single record', values: { A: 40, B: 60, C: 80 } },
    {
      key: 'H3',
      label: 'Multi-hop reasoning',
      values: { A: 30, B: null, C: 50 },
    },
  ],
}

const marks = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<SVGElement>('[data-mark="hit"]'))

describe('GroupedBars', () => {
  it('draws one bar per given value and none for null', () => {
    const { container } = render(<GroupedBars {...props} />)
    const bars = container.querySelectorAll('[data-mark="bar"]')
    expect(bars).toHaveLength(5)
    expect(
      container.querySelector(
        '[data-mark="bar"][data-group="H3"][data-series="B"]',
      ),
    ).toBeNull()
  })

  it('labels a null as no value, not as a zero-height bar', () => {
    render(<GroupedBars {...props} />)
    expect(screen.getAllByText('no value')).toHaveLength(1)
  })

  it('draws only gaps when every value is null', () => {
    const { container } = render(
      <GroupedBars
        {...props}
        groups={[
          { key: 'H1', label: 'Single record', values: { A: null, B: null } },
        ]}
      />,
    )
    expect(container.querySelectorAll('[data-mark="bar"]')).toHaveLength(0)
    expect(screen.getAllByText('no value')).toHaveLength(2)
  })

  it('keeps null out of the scale: a bar of 60 reaches the 60 gridline whatever else is null', () => {
    const { container } = render(<GroupedBars {...props} />)
    const bar = container.querySelector(
      '[data-mark="bar"][data-group="H1"][data-series="B"]',
    )!
    const grid = container.querySelector('[data-grid="60"]')!
    expect(Number(bar.getAttribute('data-top'))).toBeCloseTo(
      Number(grid.getAttribute('y1')),
    )
  })

  it('draws the delta it is given, even when it is not the difference', () => {
    render(
      <GroupedBars
        {...props}
        delta={{ between: ['A', 'C'], values: { H1: 9, H3: -4 } }}
      />,
    )
    // 80 - 40 is 40: the chart draws the given 9, and the given negative one.
    expect(screen.getByText('A \u2212 C +9.0')).toBeInTheDocument()
    expect(screen.getByText('A \u2212 C -4.0')).toBeInTheDocument()
    expect(screen.queryByText(/\+40\.0/)).toBeNull()
  })

  it('names the pair the bracket compares, with a true minus sign', () => {
    render(
      <GroupedBars
        {...props}
        delta={{ between: ['C', 'B'], values: { H1: 3.5 } }}
      />,
    )
    expect(screen.getByText('C \u2212 B +3.5')).toBeInTheDocument()
  })

  it('spans the delta bracket from the first to the second bar', () => {
    const { container } = render(
      <GroupedBars
        {...props}
        delta={{ between: ['A', 'C'], values: { H1: 9 } }}
      />,
    )
    const centre = (series: string) => {
      const bar = container.querySelector(
        `[data-mark="bar"][data-group="H1"][data-series="${series}"]`,
      )!
      return (
        Number(bar.getAttribute('data-x')) +
        Number(bar.getAttribute('data-width')) / 2
      )
    }
    const bracket = container.querySelector(
      '[data-mark="delta"][data-group="H1"]',
    )!
    expect(Number(bracket.getAttribute('data-x1'))).toBeCloseTo(centre('A'))
    expect(Number(bracket.getAttribute('data-x2'))).toBeCloseTo(centre('C'))
  })

  it('draws no bracket where either bar is null', () => {
    const { container } = render(
      <GroupedBars
        {...props}
        delta={{ between: ['A', 'B'], values: { H3: 5 } }}
      />,
    )
    expect(container.querySelector('[data-mark="delta"]')).toBeNull()
  })

  it('maps interval endpoints through the same scale as the bars', () => {
    const { container } = render(
      <GroupedBars {...props} intervals={{ H1: { B: [40, 80] } }} />,
    )
    const whisker = container.querySelector(
      '[data-mark="interval"][data-group="H1"][data-series="B"]',
    )!
    const y40 = container.querySelector('[data-grid="40"]')!.getAttribute('y1')
    const y80 = container.querySelector('[data-grid="80"]')!.getAttribute('y1')
    expect(whisker.getAttribute('data-y-low')).toBe(y40)
    expect(whisker.getAttribute('data-y-high')).toBe(y80)
  })

  it('shows a legend for two or more series and none for one', () => {
    const { rerender } = render(<GroupedBars {...props} />)
    const legend = screen.getByRole('list', { name: 'Key to the pipelines' })
    expect(within(legend).getAllByRole('listitem')).toHaveLength(3)
    rerender(
      <GroupedBars
        {...props}
        groups={[{ key: 'H1', label: 'Single record', values: { A: 40 } }]}
      />,
    )
    expect(
      screen.queryByRole('list', { name: 'Key to the pipelines' }),
    ).toBeNull()
  })

  it('names the pipelines on the bars when there are four series or fewer', () => {
    const { container } = render(<GroupedBars {...props} />)
    const letters = Array.from(
      container.querySelectorAll('[data-mark="letter"]'),
    ).map((l) => l.textContent)
    expect(letters).toEqual(['A', 'B', 'C', 'A', 'B', 'C'])
  })

  it('never colours text with a series colour', () => {
    const { container } = render(
      <GroupedBars
        {...props}
        delta={{ between: ['A', 'C'], values: { H1: 9 } }}
      />,
    )
    const seriesColours = PIPELINES.flatMap((p) => [p.hue, p.strong, p.tint])
    for (const text of container.querySelectorAll(
      'text, figcaption, li, button',
    )) {
      expect(seriesColours).not.toContain(text.getAttribute('fill'))
      expect(text.getAttribute('class') ?? '').not.toMatch(
        /text-pipeline|text-baseline|text-graph|text-ontology/,
      )
    }
  })

  it('has an img role with a short label inside a figure with a caption', () => {
    render(<GroupedBars {...props} description="Mean per type" />)
    const figure = screen.getByRole('figure')
    expect(within(figure).getByRole('img')).toHaveAttribute(
      'aria-label',
      'Evidence by question type',
    )
    expect(figure.querySelector('figcaption')).toHaveTextContent(
      'Evidence by question type',
    )
  })

  it('offers the same numbers as a table, in tabular numerals', async () => {
    const user = userEvent.setup()
    const { container } = render(<GroupedBars {...props} />)
    await user.click(screen.getByRole('button', { name: 'Show as table' }))
    expect(container.querySelector('svg')).toBeNull()
    const table = screen.getByRole('table')
    expect(
      within(table).getByRole('columnheader', { name: 'A · Text search' }),
    ).toBeInTheDocument()
    const row = within(table).getByRole('row', { name: /Single record/ })
    expect(
      within(row)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['40.0', '60.0', '80.0'])
    expect(within(table).getAllByRole('cell')[0]).toHaveClass('tabular')
    expect(within(table).getByText('no value')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show as chart' }))
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('shows the tooltip on hover and on keyboard focus, and Escape closes it', async () => {
    const user = userEvent.setup()
    const { container } = render(<GroupedBars {...props} />)
    const first = marks(container)[0]
    await user.hover(first)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Single record')
    expect(screen.getByRole('tooltip')).toHaveTextContent('40')
    await user.unhover(first)
    expect(screen.queryByRole('tooltip')).toBeNull()
    await user.tab()
    await user.tab()
    expect(marks(container)[0]).toHaveFocus()
    expect(screen.getByRole('tooltip')).toHaveTextContent('Text search')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('moves between marks with the arrow keys on a roving tabindex', async () => {
    const user = userEvent.setup()
    const { container } = render(<GroupedBars {...props} />)
    const all = marks(container)
    expect(all.filter((m) => m.getAttribute('tabindex') === '0')).toHaveLength(
      1,
    )
    await user.tab()
    await user.tab()
    await user.keyboard('{ArrowRight}')
    expect(all[1]).toHaveFocus()
    expect(all[1]).toHaveAttribute('tabindex', '0')
    expect(all[0]).toHaveAttribute('tabindex', '-1')
    // The gap is reachable too, and its tooltip says so.
    await user.keyboard('{End}')
    expect(all[all.length - 1]).toHaveFocus()
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tooltip')).toHaveTextContent('no value')
  })

  it('holds the previous render, dimmed, while loading', () => {
    const { container } = render(<GroupedBars {...props} status="loading" />)
    expect(screen.getByRole('figure')).toHaveAttribute('aria-busy', 'true')
    expect(container.querySelectorAll('[data-mark="bar"]')).toHaveLength(5)
  })

  it('says so when there is nothing to draw', () => {
    render(<GroupedBars {...props} groups={[]} />)
    expect(screen.getByText('No results to show.')).toBeInTheDocument()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('shows an error in place of the chart', () => {
    render(
      <GroupedBars
        {...props}
        status="error"
        error="The results could not be read."
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The results could not be read.',
    )
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('takes the marks out of the tab order when disabled', async () => {
    const user = userEvent.setup()
    const { container } = render(<GroupedBars {...props} disabled />)
    expect(
      marks(container).every((m) => m.getAttribute('tabindex') === null),
    ).toBe(true)
    expect(screen.getByRole('button', { name: 'Show as table' })).toBeDisabled()
    await user.tab()
    expect(document.body).toHaveFocus()
  })

  it('draws a negative bar below the baseline', () => {
    const { container } = render(
      <GroupedBars
        {...props}
        domain={[-50, 100]}
        groups={[
          { key: 'H1', label: 'Single record', values: { A: -20, B: 20 } },
        ]}
      />,
    )
    const neg = container.querySelector('[data-series="A"][data-mark="bar"]')!
    const pos = container.querySelector('[data-series="B"][data-mark="bar"]')!
    expect(Number(neg.getAttribute('data-bottom'))).toBeGreaterThan(
      Number(pos.getAttribute('data-bottom')),
    )
  })
})
