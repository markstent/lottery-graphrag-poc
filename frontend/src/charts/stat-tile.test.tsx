import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Legend } from './legend'
import { StatTile } from './stat-tile'

describe('StatTile', () => {
  it('draws a negative value with the true minus sign, no space', () => {
    render(<StatTile label="Change" value={-3.5} unit="points" />)
    expect(screen.getByText('\u22123.5')).toBeInTheDocument()
  })

  it('shows the value, its unit and its interval and counts in muted text', () => {
    render(
      <StatTile
        label="Evidence found"
        value={61.4}
        unit="points"
        interval={[55.2, 67.9]}
        n={36}
        groups={12}
      />,
    )
    expect(screen.getByText('Evidence found')).toBeInTheDocument()
    expect(screen.getByText('61.4')).toBeInTheDocument()
    expect(screen.getByText('points')).toBeInTheDocument()
    expect(screen.getByText('interval 55.2 to 67.9')).toBeInTheDocument()
    expect(screen.getByText('36 pairs in 12 groups')).toBeInTheDocument()
  })

  it('draws the interval it is given, as given', () => {
    render(
      <StatTile
        label="Evidence found"
        value={61.4}
        unit="points"
        interval={[80, 10]}
      />,
    )
    expect(screen.getByText('interval 80.0 to 10.0')).toBeInTheDocument()
  })

  it('draws a large value with separators, in tabular numerals so tiles compare', () => {
    render(
      <StatTile
        label="Questions"
        value={12840}
        unit="questions"
        decimals={0}
      />,
    )
    expect(screen.getByText('12,840')).toHaveClass('tabular')
  })

  it('sets the interval and counts in tabular numerals', () => {
    render(
      <StatTile
        label="Evidence found"
        value={61.4}
        unit="points"
        interval={[55.2, 67.9]}
        n={36}
      />,
    )
    expect(screen.getByText('interval 55.2 to 67.9')).toHaveClass('tabular')
  })

  it('draws a missing value as no value with no unit, never zero', () => {
    render(<StatTile label="Evidence found" value={null} unit="points" />)
    expect(screen.getByText('no value')).toBeInTheDocument()
    expect(screen.queryByText('0.0')).toBeNull()
    expect(screen.queryByText('points')).toBeNull()
  })

  it('does not wear a series colour on its text', () => {
    const { container } = render(
      <StatTile label="Evidence found" value={61.4} unit="points" />,
    )
    expect(container.innerHTML).not.toMatch(/pipeline/)
  })
})

describe('Legend', () => {
  it('is absent for fewer than two series', () => {
    const { container } = render(<Legend series={['A']} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('lists each series in order with its swatch and name', () => {
    render(<Legend series={['A', 'B', 'C']} />)
    const items = screen.getAllByRole('listitem').map((i) => i.textContent)
    expect(items).toEqual([
      'A · Text search',
      'B · Graph',
      'C · Graph + Ontology',
    ])
  })
})
