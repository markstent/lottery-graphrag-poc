import { render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { components } from '../api/schema'
import fixture from '../run/fixtures/run-abc.json'
import { reduceAll, type RunEvent } from '../run/reduce'
import { recordedPathsFromResult } from './from-result'
import { GraphCanvas } from './graph-canvas'
import { graphView } from './model'

// Each layout takes a while, so several are requested before the first ends.
const calls: number[] = []
vi.mock('./layout', async (importActual) => {
  const actual = await importActual<typeof import('./layout')>()
  return {
    ...actual,
    layoutGraph: async (...args: Parameters<typeof actual.layoutGraph>) => {
      calls.push(args[0].length)
      await new Promise((resolve) => setTimeout(resolve, 60))
      return actual.layoutGraph(...args)
    },
  }
})

const recorded = fixture.events as unknown as RunEvent[]
const result = fixture.results.results
  .C as unknown as components['schemas']['GraphRunResult']
const viewAt = (sequence: number) =>
  graphView(reduceAll(recorded.filter((e) => e.sequence <= sequence)).graph.C, {
    cap: 1000,
    focus: false,
    paths: recordedPathsFromResult(result),
  })

describe('GraphCanvas layout requests', () => {
  it('runs only the latest of the layouts requested while one is running', async () => {
    const element = (sequence: number) => (
      <GraphCanvas
        mode="live"
        view={viewAt(sequence)}
        onSelectNode={() => undefined}
        focusMode={false}
        presentation={false}
        pipeline="C"
      />
    )
    const { rerender } = render(element(420))
    for (const sequence of [450, 480, 520, 560]) rerender(element(sequence))
    const latest = viewAt(560).nodes.length
    await waitFor(
      () =>
        expect(
          document.querySelectorAll('[data-node-id]').length,
        ).toBeGreaterThanOrEqual(latest),
      { timeout: 4000 },
    )
    // The first layout, then one for the latest view; none of the ones between.
    expect(calls).toHaveLength(2)
    expect(calls.at(-1)).toBe(latest)
  })
})
