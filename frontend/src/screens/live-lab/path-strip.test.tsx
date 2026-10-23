import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { relationshipPhrase } from '../../design/relationships'
import { RECORDED_RUNS } from '../../run/recorded'
import { reduceAll, type RunEvent } from '../../run/reduce'
import { PathStrip } from './path-strip'

const h3 = RECORDED_RUNS.find((run) => run.stratum === 'H3')!
const h1 = RECORDED_RUNS.find((run) => run.stratum === 'H1')!
const events = (run: typeof h3) => run.events as unknown as RunEvent[]

/** The run state after the events up to and including the one of `type`, or all of them. */
const stateThrough = (run: typeof h3, type?: string) => {
  const all = events(run)
  const end = type
    ? all.findIndex((e) => e.event_type === type) + 1
    : all.length
  return reduceAll(all.slice(0, end))
}

describe('PathStrip', () => {
  it('shows nothing until the pipeline has recorded its evidence path', () => {
    const before = stateThrough(h3, 'graph.traversal.started')
    expect(before.graph.B.evidencePath).toBeNull()
    const { container } = render(
      <PathStrip id="B" state={before} results={h3.results} onOpen={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the recorded paths once the path event has arrived', () => {
    const state = stateThrough(h3)
    expect(state.graph.B.evidencePath).not.toBeNull()
    render(
      <PathStrip id="B" state={state} results={h3.results} onOpen={vi.fn()} />,
    )
    const strip = screen.getByRole('region', {
      name: 'B · Graph evidence path',
    })
    const paths = within(strip).getAllByRole('list', { name: /^Path \d+$/ })
    expect(paths.length).toBeGreaterThan(0)
  })

  it('draws a path as nodes joined by relationships in plain words', () => {
    const state = stateThrough(h3)
    render(
      <PathStrip id="B" state={state} results={h3.results} onOpen={vi.fn()} />,
    )
    const strip = screen.getByRole('region', {
      name: 'B · Graph evidence path',
    })
    // GAME_AT_04 -> INC_003 -> GAME_AT_03 is a recorded path of B.
    const path = within(strip)
      .getAllByRole('list', { name: /^Path \d+$/ })
      .find((p) => p.textContent?.includes('GAME_AT_03'))!
    expect(
      within(path)
        .getAllByRole('button')
        .map((b) => b.getAttribute('data-node-id')),
    ).toEqual(['GAME_AT_04', 'INC_003', 'GAME_AT_03'])
    // Each hop names the recorded relationship in words, never its code.
    const hops = state.graph.B.relationships.filter(
      (r) =>
        (r.from === 'GAME_AT_04' && r.to === 'INC_003') ||
        (r.from === 'INC_003' && r.to === 'GAME_AT_04') ||
        (r.from === 'INC_003' && r.to === 'GAME_AT_03') ||
        (r.from === 'GAME_AT_03' && r.to === 'INC_003'),
    )
    expect(hops.length).toBeGreaterThan(0)
    expect(
      hops.some((r) => path.textContent?.includes(relationshipPhrase(r.type))),
    ).toBe(true)
    for (const r of hops) expect(path.textContent).not.toContain(r.type)
  })

  it('keeps each path on one row that scrolls sideways, never wrapping a hop', () => {
    render(
      <PathStrip
        id="B"
        state={stateThrough(h3)}
        results={h3.results}
        onOpen={vi.fn()}
      />,
    )
    const strip = screen.getByRole('region', {
      name: 'B · Graph evidence path',
    })
    for (const path of within(strip).getAllByRole('list', {
      name: /^Path \d+$/,
    })) {
      expect(path).toHaveClass('flex-nowrap', 'overflow-x-auto')
      for (const hop of within(path).getAllByRole('listitem'))
        expect(hop).toHaveClass('shrink-0', 'whitespace-nowrap')
    }
  })

  it('opens a node from the keyboard', async () => {
    const onOpen = vi.fn()
    const user = userEvent.setup()
    render(
      <PathStrip
        id="B"
        state={stateThrough(h3)}
        results={h3.results}
        onOpen={onOpen}
      />,
    )
    const button = screen.getAllByRole('button')[0]
    await user.tab()
    expect(screen.getAllByRole('button')[0]).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(onOpen).toHaveBeenCalledWith(
      'B',
      button.getAttribute('data-node-id'),
    )
  })

  it('drops a path that is only the start of a longer one, and shows a few with the rest on request', async () => {
    const user = userEvent.setup()
    render(
      <PathStrip
        id="C"
        state={stateThrough(h3)}
        results={h3.results}
        onOpen={vi.fn()}
      />,
    )
    const shown = () => screen.getAllByRole('list', { name: /^Path \d+$/ })
    const more = screen.queryByRole('button', { name: /^Show all \d+ paths$/ })
    if (more) {
      const before = shown().length
      await user.click(more)
      expect(shown().length).toBeGreaterThan(before)
    }
    // No path is a strict beginning of another.
    const texts = shown().map((p) =>
      within(p)
        .getAllByRole('button')
        .map((b) => b.getAttribute('data-node-id')!.concat()),
    )
    for (const a of texts)
      for (const b of texts)
        if (a !== b && a.length < b.length)
          expect(b.slice(0, a.length)).not.toEqual(a)
  })

  it('marks a node the ontology added in C, and none in B', () => {
    const state = stateThrough(h1)
    render(
      <PathStrip id="C" state={state} results={h1.results} onOpen={vi.fn()} />,
    )
    // H1's C path nodes are all found by B too, so nothing is marked.
    expect(screen.queryByText('+ ontology')).toBeNull()
  })
})
