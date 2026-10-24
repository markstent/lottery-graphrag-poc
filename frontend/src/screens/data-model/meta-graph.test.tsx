import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Diagram } from './meta-graph'

describe('Diagram', () => {
  const nodes = [
    { id: 'a', title: 'game', detail: '120 nodes', width: 200 },
    { id: 'b', title: 'market', detail: '4 nodes', width: 200 },
  ]
  const edges = [
    { id: 'e', source: 'a', target: 'b', label: 'is available in · 310' },
  ]

  it('draws a keyboard-reachable button for each node and lists each link in words', async () => {
    const onSelect = vi.fn()
    render(
      <Diagram
        nodes={nodes}
        edges={edges}
        label="Map"
        onSelect={onSelect}
        scale={1}
      />,
    )
    const game = await screen.findByRole('button', { name: 'game, 120 nodes' })
    expect(game).toHaveAttribute('tabindex', '0')
    fireEvent.keyDown(game, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith('a')
    expect(
      screen.getByText('game is available in · 310 market'),
    ).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Map' })).toBeInTheDocument()
  })

  it('marks the selected node as pressed', async () => {
    render(
      <Diagram
        nodes={nodes}
        edges={edges}
        label="Map"
        selected="b"
        onSelect={() => undefined}
        scale={1}
      />,
    )
    expect(
      await screen.findByRole('button', { name: 'market, 4 nodes' }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(
      screen.getByRole('button', { name: 'game, 120 nodes' }),
    ).toHaveAttribute('aria-pressed', 'false')
  })
})
