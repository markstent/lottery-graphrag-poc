import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import type { components } from '../api/schema'
import { EvidenceDrawer } from '../components/evidence-drawer'
import { stubApi } from '../test/api-stub'
import { warmLayout } from '../test/warm-layout'
import { EVIDENCE_STATES } from '../design/evidence-states'
import { TOKENS } from '../design/tokens'
import fixture from '../run/fixtures/run-abc.json'
import { reduceAll, type RunEvent } from '../run/reduce'
import { recordedPathsFromResult } from './from-result'
import { EvidencePathList } from './evidence-path-list'
import { GraphCanvas } from './graph-canvas'
import { graphView, withClustersOf, type GraphView } from './model'

const recorded = fixture.events as unknown as RunEvent[]
const resultOf = (pipeline: 'B' | 'C') =>
  fixture.results.results[
    pipeline
  ] as unknown as components['schemas']['GraphRunResult']

/** The B or C graph after the events up to `sequence` (all of them by default). */
function viewAt(
  pipeline: 'B' | 'C',
  options: { sequence?: number; cap?: number; focus?: boolean } = {},
): GraphView {
  const { sequence = Infinity, cap = 1000, focus = false } = options
  const state = reduceAll(recorded.filter((e) => e.sequence <= sequence))
  return graphView(state.graph[pipeline], {
    cap,
    focus,
    paths: recordedPathsFromResult(resultOf(pipeline)),
  })
}

/** A sequence at which `pipeline` has discovered about `count` nodes. */
function sequenceWithNodes(pipeline: 'B' | 'C', count: number): number {
  for (const e of recorded) {
    if (e.sequence < 1) continue
    const n = reduceAll(recorded.filter((x) => x.sequence <= e.sequence)).graph[
      pipeline
    ].nodes.length
    if (n >= count) return e.sequence
  }
  throw new Error('fixture has too few nodes')
}

const noop = () => undefined
interface Extra {
  pipeline?: 'B' | 'C'
  focusMode?: boolean
  presentation?: boolean
  reducedMotion?: boolean
  label?: string
  pathListId?: string
  otherPipeline?: 'B' | 'C'
  onSelectNode?: (id: string) => void
  /** Draw as a replay of this final view; otherwise as a live stream. */
  replayOf?: GraphView
  /** For a live stream: it has ended. */
  settled?: boolean
}
const canvas = (view: GraphView, extra: Extra = {}) => {
  const { replayOf, settled, ...rest } = extra
  const base = {
    view,
    onSelectNode: noop,
    focusMode: false,
    presentation: false,
    reducedMotion: false,
    pipeline: 'C' as const,
    ...rest,
  }
  return replayOf ? (
    <GraphCanvas {...base} mode="replay" finalView={replayOf} />
  ) : (
    <GraphCanvas {...base} mode="live" settled={settled} />
  )
}

const nodeButtons = () =>
  screen
    .queryAllByRole('button')
    .filter((el) => el.hasAttribute('data-node-id'))

const nodeButton = (id: string) =>
  nodeButtons().find(
    (el) => el.getAttribute('data-node-id') === id,
  ) as HTMLElement

/**
 * The ready flag waits for the layout and the animated fit, which can pass
 * waitFor's default second when the whole suite runs in parallel.
 */
const READY = { timeout: 5000 }

/** Waits for the async layout to place every node. */
async function placed(count: number) {
  await waitFor(() => expect(nodeButtons()).toHaveLength(count))
}

/** The position of a node: its own place, or the group place a lone member stands in. */
const transformOf = (id: string) => {
  const wrapper = document
    .querySelector(`[data-node-id="${id}"]`)
    ?.closest<HTMLElement>('.react-flow__node')
  if (!wrapper) throw new Error(`no node ${id} on the page`)
  return wrapper.style.transform
}

beforeAll(warmLayout)

describe('GraphCanvas', () => {
  it('flags the canvas ready only once the layout is placed and the fit applied', async () => {
    const view = viewAt('B')
    render(canvas(view))
    const group = screen.getByRole('group', { name: 'Evidence graph' })
    await waitFor(
      () => expect(group).toHaveAttribute('data-layout-ready', 'true'),
      READY,
    )
    expect(nodeButtons()).toHaveLength(view.nodes.length)
  })

  it('fades the drawing at its right and bottom edges, over nothing a reader can click', async () => {
    render(canvas(viewAt('B')))
    await placed(viewAt('B').nodes.length)
    const fades = document.querySelectorAll<HTMLElement>('[data-canvas-fade]')
    expect(fades).toHaveLength(2)
    for (const fade of fades) {
      expect(fade).toHaveAttribute('aria-hidden', 'true')
      expect(fade.className).toContain('pointer-events-none')
      expect(fade.style.background).toContain('var(--color-surface)')
    }
  })

  it('flags the canvas ready only once the viewport has stopped moving', async () => {
    const view = viewAt('B')
    render(canvas(view))
    const group = screen.getByRole('group', { name: 'Evidence graph' })
    const viewport = () =>
      group.querySelector<HTMLElement>('.react-flow__viewport')!.style.transform
    await waitFor(
      () => expect(group).toHaveAttribute('data-layout-ready', 'true'),
      { ...READY, interval: 5 },
    )
    const atReady = viewport()
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(viewport()).toBe(atReady)
  })

  it('flags the canvas ready under reduced motion, where the fit has no animation', async () => {
    const view = viewAt('B')
    render(canvas(view, { reducedMotion: true }))
    const group = screen.getByRole('group', { name: 'Evidence graph' })
    await waitFor(
      () => expect(group).toHaveAttribute('data-layout-ready', 'true'),
      READY,
    )
  })

  it('draws one DOM node for each node of the view', async () => {
    const view = viewAt('B')
    expect(view.nodes).toHaveLength(35)
    render(canvas(view))
    await placed(35)
    expect(nodeButtons().map((el) => el.dataset.nodeId)).toEqual(
      view.nodes.map((n) => n.id),
    )
  })

  it('names each node by its state and its label in plain words', async () => {
    const view = viewAt('C')
    render(canvas(view))
    await placed(53)
    const seed = nodeButton('INC_021')
    expect(seed).toHaveAccessibleName(`${EVIDENCE_STATES.seed.label}: incident`)
    expect(seed).toHaveAccessibleDescription(
      'INC_021, set aside, on an evidence path',
    )
    expect(nodeButton('CONCEPT_INCIDENT')).toHaveAccessibleName(
      `${EVIDENCE_STATES.seed.label}: business concept`,
    )
    expect(
      screen.getAllByRole('button', { name: /^Set aside: incident type$/ })
        .length,
    ).toBeGreaterThan(0)
  })

  it('tags each edge with its relationship in plain words while the view is small', async () => {
    const sequence = sequenceWithNodes('B', 12)
    const view = viewAt('B', { sequence })
    render(canvas(view))
    await placed(view.nodes.length)
    await waitFor(() =>
      expect(document.querySelectorAll('[data-edge-id]')).toHaveLength(
        view.edges.length,
      ),
    )
    const tags = [...document.querySelectorAll('[data-edge-id]')].map(
      (el) => el.textContent,
    )
    for (const tag of tags) expect(tag).toMatch(/^[a-z][a-z ,x0-9]+$/)
    expect(tags).toContain('is related to version')
  })

  it('tags every evidence path edge even when the view is crowded', async () => {
    const view = viewAt('C')
    render(canvas(view))
    await placed(53)
    await waitFor(() =>
      expect(
        document.querySelectorAll('[data-edge-id]').length,
      ).toBeGreaterThan(0),
    )
    const tags = [...document.querySelectorAll('[data-edge-id]')]
    const onPath = view.edges.filter((e) => e.onPath)
    expect(onPath.length).toBeGreaterThan(0)
    for (const edge of onPath)
      expect(
        tags.some(
          (el) =>
            el.getAttribute('data-edge-id') === `${edge.source}>${edge.target}`,
        ),
      ).toBe(true)
  })

  it('puts the evidence path edges of the fixture on the path', () => {
    for (const id of ['B', 'C'] as const) {
      const view = viewAt(id)
      const steps = view.pathSteps.flat().filter((s) => s !== null)
      expect(steps.length).toBeGreaterThan(0)
      expect(view.edges.filter((e) => e.onPath).length).toBeGreaterThanOrEqual(
        new Set(steps).size,
      )
    }
  })

  it('dims every node and edge off the path to 25 percent in focus mode', async () => {
    const view = viewAt('C')
    render(canvas(view, { focusMode: true }))
    await placed(53)
    for (const node of view.nodes) {
      const el = nodeButton(node.id)
      expect(el.dataset.dimmed).toBe(String(!node.onPath))
      expect(el.style.opacity).toBe(node.onPath ? '1' : '0.25')
    }
    expect(
      [
        ...document.querySelectorAll<SVGPathElement>('.react-flow__edge-path'),
      ].filter((p) => p.style.opacity === '0.25').length,
    ).toBeGreaterThan(0)
  })

  it('leaves nothing dimmed with focus mode off', async () => {
    render(canvas(viewAt('B')))
    await placed(35)
    for (const el of nodeButtons()) expect(el.style.opacity).toBe('1')
  })

  it('lets Tab reach exactly one node, the first on the path', async () => {
    const user = userEvent.setup()
    const view = viewAt('B')
    render(canvas(view))
    await placed(35)
    const tabbable = nodeButtons().filter((el) => el.tabIndex === 0)
    expect(tabbable).toHaveLength(1)
    await user.tab()
    expect(document.activeElement).toBe(tabbable[0])
    expect(tabbable[0].dataset.nodeId).toBe(view.path[0])
  })

  it('moves focus along an edge with the arrow keys', async () => {
    const user = userEvent.setup()
    const view = viewAt('B')
    render(canvas(view))
    await placed(35)
    await user.tab()
    const start = (document.activeElement as HTMLElement).dataset.nodeId
    const linked = new Set(
      view.edges.flatMap((e) =>
        e.source === start ? [e.target] : e.target === start ? [e.source] : [],
      ),
    )
    expect(linked.size).toBeGreaterThan(0)
    const visited: string[] = []
    for (const key of [
      '{ArrowRight}',
      '{ArrowLeft}',
      '{ArrowDown}',
      '{ArrowUp}',
    ]) {
      await user.keyboard(key)
      const now = (document.activeElement as HTMLElement).dataset
        .nodeId as string
      if (now !== start) {
        visited.push(now)
        expect(linked.has(now)).toBe(true)
        await user.keyboard('{ArrowLeft}{ArrowRight}')
        nodeButton(start as string).focus()
      }
    }
    expect(visited.length).toBeGreaterThan(0)
  })

  it('stays on a node when no edge leads the way of the arrow key', async () => {
    const user = userEvent.setup()
    render(canvas(viewAt('B')))
    await placed(35)
    await user.tab()
    const start = document.activeElement
    await user.keyboard('{ArrowLeft}')
    expect(document.activeElement).toBe(start)
  })

  it('calls onSelectNode with the focused node on Enter', async () => {
    const user = userEvent.setup()
    const onSelectNode = vi.fn()
    render(canvas(viewAt('B'), { onSelectNode }))
    await placed(35)
    await user.tab()
    await user.keyboard('{Enter}')
    expect(onSelectNode).toHaveBeenCalledExactlyOnceWith('INC_021')
  })

  it('opens the evidence drawer on Enter and returns focus to the node on close', async () => {
    stubApi({
      '/api/v1/graph/nodes/INC_021': {
        node_id: 'INC_021',
        labels: ['Incident'],
        properties: { title: 'Payment outage' },
        provenance: null,
      },
    })
    function Page() {
      const [opened, setOpened] = useState<string | null>(null)
      return (
        <>
          {canvas(viewAt('B'), { onSelectNode: setOpened })}
          <EvidenceDrawer
            source={opened ? { kind: 'node', nodeId: opened } : null}
            onClose={() => setOpened(null)}
          />
        </>
      )
    }
    const user = userEvent.setup()
    render(<Page />)
    await placed(35)
    await user.tab()
    const node = document.activeElement
    expect(node).toHaveAttribute('data-node-id', 'INC_021')
    await user.keyboard('{Enter}')
    expect(
      await screen.findByRole('dialog', { name: 'Evidence' }),
    ).toBeVisible()
    expect(await screen.findByText('Payment outage')).toBeVisible()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(node)
    vi.unstubAllGlobals()
  })

  it('calls onSelectNode on a click', async () => {
    const onSelectNode = vi.fn()
    render(canvas(viewAt('B'), { onSelectNode }))
    await placed(35)
    // user-event's pointer sequence reaches d3-drag, which needs a real window.
    fireEvent.click(nodeButton('SUP_00036'))
    expect(onSelectNode).toHaveBeenCalledExactlyOnceWith('SUP_00036')
  })

  it('moves focus past the canvas on Escape', async () => {
    const user = userEvent.setup()
    render(
      <>
        {canvas(viewAt('B'))}
        <button type="button">After the graph</button>
      </>,
    )
    await placed(35)
    await user.tab()
    expect(document.activeElement?.hasAttribute('data-node-id')).toBe(true)
    await user.keyboard('{Escape}')
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'After the graph' }),
    )
  })

  it('keeps the position of every node already placed when nodes are added', async () => {
    const small = viewAt('C', { sequence: sequenceWithNodes('C', 12) })
    const full = viewAt('C')
    const { rerender } = render(canvas(small))
    await placed(small.nodes.length)
    const before = new Map(small.nodes.map((n) => [n.id, transformOf(n.id)]))
    expect(new Set(before.values()).size).toBe(small.nodes.length)
    rerender(canvas(full))
    await placed(full.nodes.length)
    for (const [id, transform] of before)
      expect(transformOf(id)).toBe(transform)
    expect(new Set(full.nodes.map((n) => transformOf(n.id))).size).toBe(
      full.nodes.length,
    )
  })

  it('folds the nodes above the cap into group nodes', async () => {
    const view = viewAt('C', { cap: 20 })
    expect(view.clusters.length).toBeGreaterThan(0)
    const visible = view.nodes.filter((n) => n.clusterId === undefined).length
    render(canvas(view))
    await placed(visible + view.clusters.length)
    const group = screen.getAllByRole('button', { name: /^Group: / })
    expect(group).toHaveLength(view.clusters.length)
    expect(group[0]).toHaveAccessibleName(/^Group: \d+ [a-z ]+s$/)
  })

  it('says so when there is nothing to draw', () => {
    render(canvas(viewAt('B', { sequence: 0 })))
    expect(
      screen.getByText('No graph activity has been recorded yet.'),
    ).toBeVisible()
  })

  it('gives the canvas a name and a description that covers the whole view', async () => {
    const view = viewAt('C', { cap: 20 })
    render(canvas(view, { label: 'Graph for configuration C' }))
    await placed(
      view.nodes.filter((n) => n.clusterId === undefined).length +
        view.clusters.length,
    )
    const region = screen.getByRole('group', {
      name: 'Graph for configuration C',
    })
    const summary = document.getElementById(
      region.getAttribute('aria-describedby') as string,
    ) as HTMLElement
    expect(summary).not.toBeNull()
    expect(summary).toHaveTextContent(
      `The graph shows ${view.nodes.length} nodes`,
    )
    // Every node is either on a path or in the summary.
    const onPath = new Set(view.path)
    for (const node of view.nodes)
      if (!onPath.has(node.id)) expect(summary).toHaveTextContent(node.id)
  })

  it('draws no transition under reduced motion', async () => {
    const view = viewAt('B', { sequence: sequenceWithNodes('B', 12) })
    render(canvas(view, { reducedMotion: true }))
    await placed(view.nodes.length)
    const wrapper = document.querySelector('.react-flow__node') as HTMLElement
    expect(wrapper.style.transition).toBe('none')
    expect(nodeButtons()[0].className).not.toContain('graph-node-enter')
  })

  it('eases position and fades new nodes in otherwise', async () => {
    const view = viewAt('B', { sequence: sequenceWithNodes('B', 12) })
    render(canvas(view))
    await placed(view.nodes.length)
    const wrapper = document.querySelector('.react-flow__node') as HTMLElement
    expect(wrapper.style.transition).toBe('transform 240ms ease-out')
    expect(nodeButtons()[0].className).toContain('graph-node-enter')
  })

  it('sets node text at 16 px, or 22 px in presentation mode', async () => {
    const view = viewAt('B', { sequence: sequenceWithNodes('B', 12) })
    const { rerender } = render(canvas(view))
    await placed(view.nodes.length)
    const fontOf = () =>
      nodeButtons()[0].querySelector<HTMLElement>('span[style*="font-size"]')
        ?.style.fontSize
    expect(fontOf()).toBe('16px')
    rerender(canvas(view, { presentation: true }))
    await waitFor(() => expect(fontOf()).toBe('22px'))
  })

  it('gives a node the focus ring class', async () => {
    render(canvas(viewAt('B')))
    await placed(35)
    expect(nodeButtons()[0].className).toContain('graph-node')
  })
})

/** A #rrggbb colour as jsdom writes it in a style. */
const rgb = (hex: string) =>
  `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`

describe('pipeline identity', () => {
  const overlayView = (pipelineId: 'B' | 'C') => {
    const state = reduceAll(recorded)
    return graphView(state.graph[pipelineId], {
      cap: 1000,
      focus: false,
      overlay: pipelineId === 'C' ? state.graph.B : undefined,
      paths: recordedPathsFromResult(resultOf(pipelineId)),
    })
  }

  it('badges and tints in C the nodes the ontology added, and only those', async () => {
    const view = overlayView('C')
    const added = view.nodes.filter((n) => n.addedByOntology)
    expect(added.length).toBeGreaterThan(0)
    render(canvas(view, { pipeline: 'C' }))
    await placed(view.nodes.length)
    for (const node of view.nodes) {
      const badge = within(nodeButton(node.id)).queryByText('+ ontology')
      expect(badge !== null, node.id).toBe(node.addedByOntology)
    }
    const tint = nodeButton(added[0].id).querySelector('svg')?.innerHTML
    expect(tint).toContain(TOKENS['color-pipeline-c-tint'])
  })

  it('shows no ontology badge in B', async () => {
    const view = overlayView('B')
    render(canvas(view, { pipeline: 'B' }))
    await placed(view.nodes.length)
    expect(screen.queryByText('+ ontology')).toBeNull()
  })

  it('rings path nodes in the strong tone of the canvas pipeline', async () => {
    const view = overlayView('B')
    const { unmount } = render(canvas(view, { pipeline: 'B' }))
    await placed(view.nodes.length)
    const onPath = view.nodes.find((n) => n.onPath && n.state === 'selected')
    const ring = () =>
      nodeButton(onPath?.id as string)
        .querySelector('svg')
        ?.innerHTML.toLowerCase()
    expect(ring()).toContain(TOKENS['color-pipeline-b-strong'])
    unmount()
    render(canvas(overlayView('C'), { pipeline: 'C' }))
    await placed(53)
    expect(ring()).toContain(TOKENS['color-pipeline-c-strong'])
  })

  it('draws path edges in the strong tone and ontology edges in C colour', async () => {
    const view = overlayView('C')
    render(canvas(view, { pipeline: 'C' }))
    await placed(view.nodes.length)
    await waitFor(() =>
      expect(document.querySelectorAll('.react-flow__edge-path').length).toBe(
        new Set(view.edges.map((e) => `${e.source}>${e.target}`)).size,
      ),
    )
    const strokes = [
      ...document.querySelectorAll<SVGPathElement>('.react-flow__edge-path'),
    ].map((p) => p.style.stroke)
    expect(strokes).toContain(rgb(TOKENS['color-pipeline-c-strong']))
    expect(strokes).toContain(rgb(TOKENS['color-pipeline-c']))
  })

  it('never cuts an identifier or a label short', async () => {
    const view = overlayView('C')
    render(canvas(view, { pipeline: 'C' }))
    await placed(view.nodes.length)
    for (const node of view.nodes) {
      expect(nodeButton(node.id)).toHaveTextContent(node.id)
      expect(nodeButton(node.id).innerHTML).not.toMatch(/truncate|ellipsis/)
    }
    expect(nodeButton('CONCEPT_APPLICATION_INCIDENT')).toHaveTextContent(
      'CONCEPT_APPLICATION_INCIDENT',
    )
  })

  it('gives each canvas its own arrow heads', async () => {
    const view = overlayView('B')
    render(
      <>
        {canvas(view, { pipeline: 'B' })}
        {canvas(view, { pipeline: 'C' })}
      </>,
    )
    await waitFor(() =>
      expect(document.querySelectorAll('marker[id$="-path"]').length).toBe(2),
    )
    const ids = [...document.querySelectorAll('marker')].map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

const MID = 212

describe('replay and live', () => {
  const CAP = 20
  const fullC = () => viewAt('C', { cap: CAP })
  const midC = (sequence = MID) => viewAt('C', { sequence, cap: CAP })
  const routeKinds = () =>
    [...document.querySelectorAll('[data-edge-id]')].map((el) =>
      el.getAttribute('data-route'),
    )
  /** What a replay draws for `view`: nodes standing alone or in a lone slot, and groups. */
  const drawn = (view: GraphView, final: GraphView) => {
    const shown = withClustersOf(view, final)
    return (
      shown.nodes.filter((n) => n.clusterId === undefined).length +
      shown.clusters.length
    )
  }
  const afterPaths = recorded.find(
    (e) =>
      e.event_type === 'graph.evidence_path.completed' && e.pipeline === 'C',
  )?.sequence as number

  it('shows no evidence path before the path event, then shows it', async () => {
    const final = fullC()
    const mid = midC()
    expect(final.path.length).toBeGreaterThan(0)
    expect(mid.path).toEqual([])
    const { rerender } = render(canvas(mid, { replayOf: final }))
    await placed(drawn(mid, final))
    expect(document.querySelectorAll('[data-on-path="true"]')).toHaveLength(0)
    expect(afterPaths).toBeGreaterThan(MID)
    rerender(canvas(midC(afterPaths), { replayOf: final }))
    await waitFor(() =>
      expect(
        document.querySelectorAll('[data-on-path="true"]').length,
      ).toBeGreaterThan(0),
    )
  })

  it('in replay lays out the final graph once: every node is where it will end, with an elk route', async () => {
    const final = fullC()
    const mid = midC()
    const { rerender } = render(canvas(mid, { replayOf: final }))
    await placed(drawn(mid, final))
    const before = new Map(
      nodeButtons().map((b) => [
        b.dataset.nodeId as string,
        transformOf(b.dataset.nodeId as string),
      ]),
    )
    await waitFor(() => expect(routeKinds().length).toBeGreaterThan(0))
    expect(routeKinds().every((kind) => kind === 'elk')).toBe(true)
    for (const sequence of [240, 280, Infinity]) {
      const next = midC(sequence)
      rerender(canvas(next, { replayOf: final }))
      await placed(drawn(next, final))
      // A node that was drawn stays where it was, also when it becomes part of a group.
      for (const [id, transform] of before) {
        const wrapper = document
          .querySelector(`[data-node-id="${id}"]`)
          ?.closest('.react-flow__node') as HTMLElement | null
        if (wrapper) expect(wrapper.style.transform, id).toBe(transform)
      }
      await waitFor(() => expect(routeKinds().length).toBeGreaterThan(0))
      expect(routeKinds().every((kind) => kind === 'elk')).toBe(true)
    }
  })

  it('in replay shows only the nodes whose events have arrived', async () => {
    const final = fullC()
    const mid = midC()
    render(canvas(mid, { replayOf: final }))
    await placed(drawn(mid, final))
    const seen = new Set(mid.nodes.map((n) => n.id))
    for (const button of nodeButtons()) {
      const id = button.dataset.nodeId as string
      expect(seen.has(id) || id.startsWith('cluster:'), id).toBe(true)
    }
    expect(nodeButtons().length).toBeLessThan(drawn(final, final))
  })

  it('in replay draws every edge of the cursor view and no edge that has not arrived, none of them on the path', async () => {
    const final = fullC()
    const mid = midC()
    render(canvas(mid, { replayOf: final }))
    await placed(drawn(mid, final))
    await waitFor(() => expect(routeKinds().length).toBeGreaterThan(0))
    const slotOf = (view: GraphView) => {
      const shown = withClustersOf(view, final)
      const place = new Map(
        shown.nodes.map((n) => [n.id, n.clusterId ?? n.slot ?? n.id]),
      )
      return new Set(
        shown.edges
          .map((e) => [place.get(e.source), place.get(e.target)] as const)
          .filter(([a, b]) => a !== b)
          .map(([a, b]) => `${a}>${b}`),
      )
    }
    const arrived = slotOf(mid)
    const finalEdges = slotOf(final)
    const futureOnly = [...finalEdges].filter((id) => !arrived.has(id))
    expect(futureOnly.length).toBeGreaterThan(0)
    const tags = [...document.querySelectorAll('[data-edge-id]')]
    expect(tags).toHaveLength(arrived.size)
    for (const tag of tags) {
      const id = tag.getAttribute('data-edge-id') as string
      expect(arrived.has(id), id).toBe(true)
      expect(futureOnly.includes(id), id).toBe(false)
      expect(tag.getAttribute('data-on-path')).toBe('false')
    }
  })

  it('in replay draws a group from two revealed members, and a lone member as itself in the group place', async () => {
    const final = fullC()
    // A cursor at which some group has two members revealed and another has one.
    const cursor = Array.from({ length: 80 }, (_, i) => 160 + i * 2).find(
      (sequence) => {
        const some = withClustersOf(midC(sequence), final)
        return (
          some.clusters.length > 0 &&
          some.nodes.some((n) => n.slot !== undefined)
        )
      },
    )
    expect(cursor).toBeDefined()
    const mid = midC(cursor)
    const shown = withClustersOf(mid, final)
    const lone = shown.nodes.filter((n) => n.slot !== undefined)
    expect(shown.clusters.length).toBeGreaterThan(0)
    const { rerender } = render(canvas(mid, { replayOf: final }))
    await placed(drawn(mid, final))
    for (const n of shown.clusters)
      expect(
        screen.getByRole('button', { name: new RegExp(`^Group: ${n.count} `) }),
      ).toBeInTheDocument()
    for (const group of screen.getAllByRole('button', { name: /^Group: / }))
      expect(group.getAttribute('aria-label')).not.toMatch(/^Group: 1 /)
    const spots = new Map(
      lone.map((n) => [n.slot as string, transformOf(n.id)]),
    )
    for (const n of lone) {
      expect(nodeButton(n.id)).toBeInTheDocument()
      expect(
        nodeButton(n.id).closest('.react-flow__node')?.getAttribute('data-id'),
      ).toBe(n.slot)
    }
    // When the group is drawn, it takes the place the lone member had.
    rerender(canvas(final, { replayOf: final }))
    await placed(drawn(final, final))
    for (const [slot, transform] of spots) {
      const wrapper = document.querySelector(
        `.react-flow__node[data-id="${slot}"]`,
      ) as HTMLElement | null
      expect(wrapper, slot).not.toBeNull()
      expect(wrapper?.style.transform).toBe(transform)
    }
  })

  it('in live settles into the whole layout when the stream ends', async () => {
    const final = viewAt('C')
    const mid = viewAt('C', { sequence: MID })
    const { rerender } = render(canvas(mid))
    await placed(mid.nodes.length)
    rerender(canvas(final))
    await placed(final.nodes.length)
    rerender(canvas(final, { settled: true }))
    await waitFor(() => expect(routeKinds().length).toBeGreaterThan(0))
    await waitFor(() =>
      expect(routeKinds().every((kind) => kind === 'elk')).toBe(true),
    )
  })
})

describe('what a screen reader is given', () => {
  const view = () => {
    const state = reduceAll(recorded)
    return graphView(state.graph.C, {
      cap: 1000,
      focus: false,
      overlay: state.graph.B,
      paths: recordedPathsFromResult(resultOf('C')),
    })
  }

  it('is described by the summary and the evidence-path list together', async () => {
    const v = view()
    render(
      <>
        {canvas(v, { label: 'Graph C', pathListId: 'paths' })}
        <EvidencePathList id="paths" view={v} />
      </>,
    )
    await placed(v.nodes.length)
    const region = screen.getByRole('group', { name: 'Graph C' })
    const [summary, paths] = (region.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id))
    expect(summary).toHaveTextContent('The graph shows')
    expect(paths).toHaveTextContent('Evidence path 1 of')
  })

  it('names what the ontology added in the node, the summary and the path list', async () => {
    // Take a node on the path out of B and record it in C as reached through a
    // concept, so it reads as added by the ontology.
    const state = reduceAll(recorded)
    const withoutOnPath = {
      ...state.graph.B,
      nodes: state.graph.B.nodes.filter((n) => n.id !== 'SUP_00036'),
    }
    const viaConcept = {
      ...state.graph.C,
      nodes: state.graph.C.nodes.map((n) =>
        n.id === 'SUP_00036' ? { ...n, viaConcept: 'CONCEPT_INCIDENT' } : n,
      ),
    }
    const v = graphView(viaConcept, {
      cap: 1000,
      focus: false,
      overlay: withoutOnPath,
      paths: recordedPathsFromResult(resultOf('C')),
    })
    const added = v.nodes.filter((n) => n.addedByOntology)
    expect(added.length).toBeGreaterThan(0)
    expect(added.some((n) => n.onPath)).toBe(true)
    render(
      <>
        {canvas(v, { label: 'Graph C', pathListId: 'paths' })}
        <EvidencePathList id="paths" view={v} />
      </>,
    )
    await placed(v.nodes.length)
    for (const node of added)
      expect(nodeButton(node.id)).toHaveAccessibleDescription(
        /added by the ontology/,
      )
    const region = screen.getByRole('group', { name: 'Graph C' })
    const summary = document.getElementById(
      (region.getAttribute('aria-describedby') ?? '').split(' ')[0],
    )
    expect(summary).toHaveTextContent(
      `${added.length} nodes were added by the ontology`,
    )
    expect(summary?.textContent).toContain(', added by the ontology')
    const pathList = document.getElementById('paths')
    const onPathAdded = added.filter((n) => n.onPath)
    expect(onPathAdded.map((n) => n.id)).toContain('SUP_00036')
    expect(pathList?.textContent).toContain(
      'support case (SUP_00036), added by the ontology',
    )
    // A path node the ontology did not add is not marked.
    expect(pathList?.textContent).not.toContain(
      'support case (SUP_00009), added by the ontology',
    )
  })
})

describe('the other pipeline path', () => {
  const state = reduceAll(recorded)
  // B's graph with a path of C's marked that runs through nodes B's own path
  // does not reach (the recorded B and C paths happen to be the same).
  const own = recordedPathsFromResult(resultOf('B'))
  const onOwn = new Set(own.flatMap((p) => p.ids))
  const hop = state.graph.B.relationships.find(
    (r) => onOwn.has(r.from) && !onOwn.has(r.to),
  )!
  const view = graphView(state.graph.B, {
    cap: 1000,
    focus: false,
    paths: own,
    otherPaths: [[hop.from, hop.to]],
  })

  it('rings its nodes in the other pipeline colour with a text cue, and says so aloud', async () => {
    const marked = view.nodes.filter((n) => n.onOtherPath)
    expect(marked.length).toBeGreaterThan(0)
    render(canvas(view, { pipeline: 'B', otherPipeline: 'C' }))
    await placed(view.nodes.length)
    for (const node of view.nodes) {
      const button = nodeButton(node.id)
      expect(
        button.getAttribute('data-on-other-path') === 'true',
        node.id,
      ).toBe(node.onOtherPath)
      expect(within(button).queryByText('C path') !== null, node.id).toBe(
        node.onOtherPath,
      )
    }
    const button = nodeButton(marked[0].id)
    expect(button).toHaveAccessibleDescription(/on pipeline C's evidence path/)
    expect(button.querySelector('svg')?.innerHTML).toContain(
      TOKENS['color-pipeline-c-strong'],
    )
  })

  it('draws its edges dashed in the other pipeline colour', async () => {
    render(canvas(view, { pipeline: 'B', otherPipeline: 'C' }))
    await placed(view.nodes.length)
    expect(view.edges.some((e) => e.onOtherPath && !e.onPath)).toBe(true)
    await waitFor(() =>
      expect(
        document.querySelectorAll('[data-edge-id][data-on-other-path="true"]')
          .length,
      ).toBe(
        new Set(
          view.edges.filter((e) => e.onOtherPath && !e.onPath).map((e) => e.id),
        ).size,
      ),
    )
  })

  it('draws nothing of it without another pipeline', async () => {
    render(canvas(view, { pipeline: 'B' }))
    await placed(view.nodes.length)
    expect(document.querySelector('[data-on-other-path="true"]')).toBeNull()
  })
})
