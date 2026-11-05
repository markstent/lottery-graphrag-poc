import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Diagram } from './meta-graph'

vi.mock('../../graph/layout', async (importActual) => ({
  ...(await importActual<typeof import('../../graph/layout')>()),
  layoutGraph: () => Promise.reject(new Error('elk exploded: stack detail')),
}))

afterEach(() => vi.restoreAllMocks())

describe('Diagram when the layout fails', () => {
  it('says so in plain words and keeps the technical detail in the console', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <Diagram
        nodes={[{ id: 'a', title: 'game', width: 200 }]}
        edges={[]}
        label="Map"
        onSelect={() => undefined}
        scale={1}
        titlePx={18}
      />,
    )
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The map could not be drawn.')
    expect(alert).not.toHaveTextContent('elk')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible()
    expect(logged).toHaveBeenCalledWith(
      'Map layout failed',
      expect.objectContaining({ message: 'elk exploded: stack detail' }),
    )
  })
})
