import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import fixture from '../run/fixtures/run-abc.json'
import { reduceAll, type RunEvent } from '../run/reduce'
import { GraphCanvas } from './graph-canvas'
import { graphView } from './model'

vi.mock('./layout', async (importActual) => ({
  ...(await importActual<typeof import('./layout')>()),
  layoutGraph: () => Promise.reject(new Error('elk exploded: stack detail')),
}))

afterEach(() => vi.restoreAllMocks())

describe('GraphCanvas when the layout fails', () => {
  it('says so in plain words and keeps the technical detail in the console', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const view = graphView(
      reduceAll(fixture.events as unknown as RunEvent[]).graph.C,
      { cap: 24, focus: false },
    )
    render(
      <GraphCanvas
        mode="live"
        view={view}
        onSelectNode={() => undefined}
        focusMode={false}
        presentation={false}
        reducedMotion={false}
        pipeline="C"
      />,
    )
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(
      'The graph could not be drawn. Reload the page.',
    )
    expect(alert).not.toHaveTextContent('elk')
    expect(logged).toHaveBeenCalledWith(
      'Graph layout failed',
      expect.objectContaining({ message: 'elk exploded: stack detail' }),
    )
  })
})
