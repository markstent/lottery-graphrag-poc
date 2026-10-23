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
const priorities: Set<string>[] = []
vi.mock('./layout', async (importActual) => {
  const actual = await importActual<typeof import('./layout')>()
  return {
    ...actual,
    layoutGraph: async (...args: Parameters<typeof actual.layoutGraph>) => {
      calls.push(args[0].length)
      priorities.push(new Set(args[4]))
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
        reducedMotion={false}
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

  it('gives elk the seeds and the evidence path as priority, in a replay (laid out from the final graph) and in a settled stream, and not what the ontology added', async () => {
    calls.length = 0
    priorities.length = 0
    const final = graphView(reduceAll(recorded).graph.C, {
      cap: 1000,
      focus: false,
      paths: recordedPathsFromResult(result),
    })
    const seeds = new Set(
      final.nodes.filter((n) => n.state === 'seed').map((n) => n.id),
    )
    expect(final.path.some((id) => !seeds.has(id))).toBe(true)
    const common = {
      view: final,
      onSelectNode: () => undefined,
      focusMode: false,
      presentation: false,
      reducedMotion: false,
      pipeline: 'C' as const,
    }
    const replay = render(
      <GraphCanvas {...common} mode="replay" finalView={final} />,
    )
    await waitFor(() => expect(priorities.length).toBeGreaterThan(0))
    expect(priorities.at(-1)).toEqual(new Set([...seeds, ...final.path]))
    replay.unmount()
    priorities.length = 0
    render(<GraphCanvas {...common} mode="live" settled />)
    await waitFor(() => expect(priorities.length).toBeGreaterThan(0))
    expect(priorities.at(-1)).toEqual(new Set([...seeds, ...final.path]))
  })
})
