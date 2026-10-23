import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Schemas } from '../../api/client'
import { SettingsProvider } from '../../app/settings'
import { RECORDED_RUNS } from '../../run/recorded'
import { initialRunState, reduceAll, type RunEvent } from '../../run/reduce'
import { CanvasArea, type FoldedGroup } from './canvas-area'

type Results = Schemas['QueryResults']
type Recording = (typeof RECORDED_RUNS)[number]

const byStratum = (stratum: string) =>
  RECORDED_RUNS.find((run) => run.stratum === stratum)!
const h1 = byStratum('H1')
const h3 = byStratum('H3')
const finalOf = (run: Recording) =>
  reduceAll(run.events as unknown as RunEvent[])

interface Options {
  results?: Results | null
  onOpenNode?: (pipeline: 'B' | 'C', id: string) => void
  onOpenGroup?: (pipeline: 'B' | 'C', group: FoldedGroup) => void
  mode?: 'replay' | 'live'
  state?: ReturnType<typeof finalOf>
  finalState?: ReturnType<typeof finalOf> | null
}

function show(run: Recording, options: Options = {}) {
  const final = finalOf(run)
  return render(
    <SettingsProvider>
      <CanvasArea
        state={options.state ?? final}
        finalState={
          options.finalState === undefined ? final : options.finalState
        }
        results={options.results === undefined ? run.results : options.results}
        mode={options.mode ?? 'replay'}
        settled
        onOpenNode={options.onOpenNode ?? vi.fn()}
        onOpenGroup={options.onOpenGroup ?? vi.fn()}
      />
    </SettingsProvider>,
  )
}

const nodes = () =>
  screen
    .queryAllByRole('button')
    .filter((el) => el.hasAttribute('data-node-id'))
const placed = () => waitFor(() => expect(nodes().length).toBeGreaterThan(0))

beforeEach(() => window.localStorage.clear())

describe('CanvasArea', () => {
  it('has tabs for B and C, with B first and selected', async () => {
    show(h1)
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual([
      'B · Graph',
      'C · Graph + Ontology',
    ])
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false')
    await placed()
    expect(
      screen.getByRole('group', { name: 'Graph for B · Graph' }),
    ).toBeVisible()
  })

  it('shows C when its tab is chosen, and moves between tabs with the arrow keys', async () => {
    const user = userEvent.setup()
    show(h1)
    await placed()
    await user.click(screen.getByRole('tab', { name: 'C · Graph + Ontology' }))
    expect(
      await screen.findByRole('group', {
        name: 'Graph for C · Graph + Ontology',
      }),
    ).toBeVisible()
    screen.getByRole('tab', { name: 'C · Graph + Ontology' }).focus()
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { name: 'B · Graph' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('marks what the ontology added on C, never on B', async () => {
    const user = userEvent.setup()
    show(h1)
    await placed()
    expect(screen.queryByText('+ ontology')).toBeNull()
    expect(screen.queryByText('Added by the ontology')).toBeNull()
    await user.click(screen.getByRole('tab', { name: 'C · Graph + Ontology' }))
    await waitFor(() =>
      expect(screen.getAllByText('+ ontology').length).toBeGreaterThan(0),
    )
    expect(screen.getByText('Added by the ontology')).toBeVisible()
  })

  it('marks nothing on C when C recorded no ontology expansion', async () => {
    const user = userEvent.setup()
    show(h3)
    await user.click(screen.getByRole('tab', { name: 'C · Graph + Ontology' }))
    await waitFor(() => expect(nodes().length).toBeGreaterThan(0))
    expect(screen.queryByText('+ ontology')).toBeNull()
    expect(screen.queryByText('Added by the ontology')).toBeNull()
  })

  it('compares C with B at the same point of the replay', async () => {
    // B has met one concept node by this point, so it is not added; the other
    // concept node is one B has not met, so it is.
    window.localStorage.setItem('visible-node-cap', '60')
    const user = userEvent.setup()
    const final = finalOf(h1)
    const met = final.graph.C.nodes.find(
      (n) => n.id === 'CONCEPT_DRAW_INCIDENT',
    )!
    const early = {
      ...final,
      graph: {
        ...final.graph,
        B: { ...final.graph.B, nodes: [...final.graph.B.nodes, met] },
      },
    }
    show(h1, { state: early })
    await user.click(screen.getByRole('tab', { name: 'C · Graph + Ontology' }))
    await waitFor(
      () =>
        expect(
          nodes().find(
            (n) => n.dataset.nodeId === 'CONCEPT_APPLICATION_INCIDENT',
          ),
        ).toBeDefined(),
      { timeout: 5000 },
    )
    const badged = (id: string) =>
      within(nodes().find((n) => n.dataset.nodeId === id)!).queryByText(
        '+ ontology',
      ) !== null
    expect(badged('CONCEPT_APPLICATION_INCIDENT')).toBe(true)
    expect(badged('CONCEPT_DRAW_INCIDENT')).toBe(false)
  })

  describe('the other approach path', () => {
    /** B's path loses SUP_00005, which C's path keeps and B's graph holds. */
    const results = (() => {
      const out = structuredClone(h1.results) as Results
      const b = out.results!.B as Schemas['GraphRunResult']
      for (const n of b.node_evidence)
        if (n.node_id === 'SUP_00005') n.selected = false
      return out
    })()

    it('is off to begin with and offered as a toggle named for the other approach', async () => {
      show(h1, { results })
      await placed()
      const toggle = screen.getByRole('button', {
        name: "Show C's evidence path",
      })
      expect(toggle).toHaveAttribute('aria-pressed', 'false')
      expect(document.querySelector('[data-on-other-path="true"]')).toBeNull()
    })

    it('marks the other path on this graph when switched on, and off again', async () => {
      const user = userEvent.setup()
      show(h1, { results })
      await placed()
      await user.click(
        screen.getByRole('button', { name: "Show C's evidence path" }),
      )
      const marked = () =>
        Array.from(
          document.querySelectorAll(
            '[data-on-other-path="true"][data-node-id]',
          ),
        ).map((el) => el.getAttribute('data-node-id'))
      await waitFor(() => expect(marked()).toEqual(['SUP_00005']))
      expect(screen.getByText('C path')).toBeVisible()
      await user.click(
        screen.getByRole('button', { name: "Show C's evidence path" }),
      )
      await waitFor(() => expect(marked()).toEqual([]))
    })

    it('names the other approach on the other tab', async () => {
      const user = userEvent.setup()
      show(h1, { results })
      await user.click(
        screen.getByRole('tab', { name: 'C · Graph + Ontology' }),
      )
      expect(
        await screen.findByRole('button', { name: "Show B's evidence path" }),
      ).toBeVisible()
    })

    it('says how many steps of the other path this graph does not hold', async () => {
      const user = userEvent.setup()
      show(h3)
      await placed()
      await user.click(
        screen.getByRole('button', { name: "Show C's evidence path" }),
      )
      expect(
        await screen.findByText(
          "1 step of C's evidence path is not in this graph.",
        ),
      ).toBeVisible()
    })

    it('is disabled with a visible reason until the run has ended', () => {
      show(h1, { results: null })
      expect(
        screen.getByRole('button', { name: "Show C's evidence path" }),
      ).toBeDisabled()
      expect(
        screen.getByText('Available when the run has ended.'),
      ).toBeVisible()
    })

    it("is disabled with a visible reason until the other approach's path is recorded", () => {
      show(h1, { state: initialRunState(), finalState: null, mode: 'live' })
      expect(
        screen.getByRole('button', { name: "Show C's evidence path" }),
      ).toBeDisabled()
      expect(
        screen.getByText("C's evidence path is not recorded yet."),
      ).toBeVisible()
    })

    it("offers B's path on C while C has not recorded its own", async () => {
      const final = finalOf(h1)
      const inFlight = {
        ...final,
        graph: {
          ...final.graph,
          C: { ...final.graph.C, evidencePath: null },
        },
      }
      const user = userEvent.setup()
      show(h1, { state: inFlight, mode: 'live', finalState: null })
      await user.click(
        screen.getByRole('tab', { name: 'C · Graph + Ontology' }),
      )
      const toggle = await screen.findByRole('button', {
        name: "Show B's evidence path",
      })
      expect(toggle).toBeEnabled()
      expect(screen.queryByText(/not recorded yet/)).toBeNull()
    })
  })

  it('offers focus mode, which dims what is off the evidence path', async () => {
    const user = userEvent.setup()
    show(h1)
    await placed()
    const focus = screen.getByRole('button', {
      name: 'Focus on the evidence path',
    })
    expect(focus).toHaveAttribute('aria-pressed', 'false')
    expect(nodes().some((n) => n.getAttribute('data-dimmed') === 'true')).toBe(
      false,
    )
    await user.click(focus)
    expect(focus).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() =>
      expect(
        nodes().some((n) => n.getAttribute('data-dimmed') === 'true'),
      ).toBe(true),
    )
  })

  it('wires the node cap from Settings, grouping the nodes beyond it and noting what is out of view', async () => {
    window.localStorage.setItem('visible-node-cap', '12')
    render(
      <SettingsProvider>
        <CanvasArea
          state={finalOf(h1)}
          finalState={finalOf(h1)}
          results={h1.results}
          mode="replay"
          settled
          onOpenNode={vi.fn()}
          onOpenGroup={vi.fn()}
        />
      </SettingsProvider>,
    )
    await placed()
    expect(
      screen.getByRole('group', { name: 'Graph for B · Graph' }),
    ).toBeVisible()
    // Folded groups show as nodes of their own.
    expect(
      screen
        .getAllByRole('button')
        .some((b) => b.dataset.nodeId?.startsWith('cluster:')),
    ).toBe(true)
  })

  it('tells the owner of the canvas which node was opened', async () => {
    const onOpenNode = vi.fn()
    show(h1, { onOpenNode })
    await placed()
    const node = nodes().find((n) => n.dataset.nodeId === 'INC_037')!
    fireEvent.click(node)
    expect(onOpenNode).toHaveBeenCalledWith('B', 'INC_037')
  })

  it('opens a group of folded nodes with its recorded members, not as a node', async () => {
    window.localStorage.setItem('visible-node-cap', '12')
    const onOpenNode = vi.fn()
    const onOpenGroup = vi.fn()
    show(h1, { onOpenNode, onOpenGroup })
    await placed()
    const group = nodes().find((n) => n.dataset.nodeId?.startsWith('cluster:'))!
    fireEvent.click(group)
    expect(onOpenNode).not.toHaveBeenCalled()
    expect(onOpenGroup).toHaveBeenCalledTimes(1)
    const [pipeline, folded] = onOpenGroup.mock.calls[0]
    expect(pipeline).toBe('B')
    expect(folded.title).toMatch(/^Group of \d+ /)
    expect(folded.members.length).toBeGreaterThan(1)
    const known = new Set(finalOf(h1).graph.B.nodes.map((n) => n.id))
    for (const m of folded.members) {
      expect(known.has(m.id)).toBe(true)
      expect(m.label).toBeTruthy()
    }
    expect(folded.title).toContain(String(folded.members.length))
  })

  it('draws a live run in live mode from the state so far', async () => {
    const final = finalOf(h1)
    show(h1, { mode: 'live', finalState: null, state: final })
    await placed()
    expect(nodes().length).toBeGreaterThan(0)
  })

  it('says to run a question when there is nothing to draw', () => {
    show(h1, {
      state: initialRunState(),
      finalState: null,
      mode: 'live',
      results: null,
    })
    expect(
      screen.getByText('No graph activity has been recorded yet.'),
    ).toBeVisible()
  })

  it('gives a text alternative that lists the evidence paths', async () => {
    show(h1)
    await placed()
    const group = screen.getByRole('group', { name: 'Graph for B · Graph' })
    const ids = (group.getAttribute('aria-describedby') ?? '').split(' ')
    const text = ids
      .map((id) => document.getElementById(id)?.textContent)
      .join(' ')
    expect(text).toContain('Evidence path 1 of')
    expect(within(group).getByRole('toolbar', { name: 'Zoom' })).toBeVisible()
  })
})
