import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Diagram } from './meta-graph'

describe('Diagram', () => {
  const nodes = [
    { id: 'a', title: 'game', detail: '120 nodes', width: 200 },
    { id: 'b', title: 'market', detail: '4 nodes', width: 200 },
  ]
  const edges = [
    { id: 'e', source: 'a', target: 'b', label: 'is available in' },
  ]

  it('draws a reversed link with its arrow back at the source, and reads it from the target', async () => {
    const { container } = render(
      <Diagram
        nodes={nodes}
        edges={[
          { ...edges[0], reversed: true },
          {
            id: 'f',
            source: 'a',
            target: 'b',
            label: 'are deployed to it',
            reversed: true,
          },
        ]}
        label="Map"
        onSelect={() => undefined}
        scale={1}
        titlePx={18}
      />,
    )
    expect(
      await screen.findByText('market is available in game'),
    ).toBeInTheDocument()
    // An incoming phrase names the source as "it", so the words name it instead.
    expect(screen.getByText('market are deployed to game')).toBeInTheDocument()
    const path = container.querySelector('g[data-edge-id="e"] path')
    expect(path).toHaveAttribute('marker-start')
    expect(path).not.toHaveAttribute('marker-end')
  })

  it('draws a keyboard-reachable button for each node and lists each link in words', async () => {
    const onSelect = vi.fn()
    render(
      <Diagram
        nodes={nodes}
        edges={edges}
        label="Map"
        onSelect={onSelect}
        scale={1}
        titlePx={18}
      />,
    )
    const game = await screen.findByRole('button', { name: 'game, 120 nodes' })
    expect(game).toHaveAttribute('tabindex', '0')
    fireEvent.keyDown(game, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith('a')
    expect(screen.getByText('game is available in market')).toBeInTheDocument()
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
        titlePx={18}
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
