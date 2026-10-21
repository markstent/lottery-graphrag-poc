import { act, render, renderHook, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { EVIDENCE_STATES } from '../design/evidence-states'
import fixture from '../run/fixtures/run-abc.json'
import { reduceAll, type GraphEvents, type RunEvent } from '../run/reduce'
import { useReplay } from '../run/use-replay'
import { EvidencePathList } from './evidence-path-list'
import { DEFAULT_VISIBLE_NODE_CAP, graphView } from './model'

const recorded = fixture.events as unknown as RunEvent[]
const full = reduceAll(recorded)
const options = { cap: DEFAULT_VISIBLE_NODE_CAP, focus: false }

/** The selected nodes' paths, followed back along the recorded relationships. */
function pathsOf(graph: GraphEvents): string[][] {
  const parent = new Map(graph.relationships.map((r) => [r.to, r.from]))
  return graph.nodes
    .filter((n) => n.outcome === 'selected')
    .map((n) => {
      const path = [n.id]
      for (let up = parent.get(n.id); up; up = parent.get(up)) path.unshift(up)
      return path
    })
}

describe('EvidencePathList', () => {
  it('lists each path in order, one item per node', () => {
    const paths = pathsOf(full.graph.C)
    const view = graphView(full.graph.C, { ...options, paths })
    render(<EvidencePathList view={view} />)
    const lists = screen.getAllByRole('list')
    expect(lists).toHaveLength(paths.length)
    lists.forEach((list, i) => {
      const items = within(list).getAllByRole('listitem')
      expect(items).toHaveLength(paths[i].length)
      items.forEach((item, hop) => {
        expect(item).toHaveTextContent(`(${paths[i][hop]})`)
      })
    })
  })

  it('names the state, the label and the relationship that reached each node', () => {
    const view = graphView(full.graph.B, {
      ...options,
      paths: [['INC_037', 'SUP_00113']],
    })
    render(<EvidencePathList view={view} />)
    const [first, second] = screen.getAllByRole('listitem')
    expect(first).toHaveTextContent(
      `${EVIDENCE_STATES.selected.label}: Incident (INC_037)`,
    )
    expect(first).not.toHaveTextContent('related')
    const edge = full.graph.B.relationships.find((r) => r.to === 'SUP_00113')
    expect(edge).toBeDefined()
    expect(second).toHaveTextContent(
      `${EVIDENCE_STATES.selected.label}: SupportCase (SUP_00113), Incident is related to SupportCase`,
    )
  })

  it('says so when no path was recorded', () => {
    render(<EvidencePathList view={graphView(full.graph.B, options)} />)
    expect(screen.queryByRole('list')).toBeNull()
    expect(
      screen.getByText('No evidence path was recorded for this pipeline.'),
    ).toBeVisible()
  })

  it('uses none of the banned words', () => {
    const view = graphView(full.graph.C, {
      ...options,
      paths: pathsOf(full.graph.C),
    })
    const { container } = render(<EvidencePathList view={view} />)
    expect(container.textContent).not.toMatch(
      /honest|never|real|fake|prototype|telemetry|seed|chunk|rerank|MAPS_TO/i,
    )
  })

  it('under reduced motion the replay ends on the full graph and its list', () => {
    const { result } = renderHook(() =>
      useReplay(recorded, { reducedMotion: true }),
    )
    act(() => result.current.controls.play())
    const graph = result.current.state.graph.C
    const paths = pathsOf(graph)
    const view = graphView(graph, { ...options, paths })
    expect(view).toEqual(graphView(full.graph.C, { ...options, paths }))
    expect(view.nodes).toHaveLength(61)
    render(<EvidencePathList view={view} />)
    expect(screen.getAllByRole('list')).toHaveLength(paths.length)
    expect(screen.getAllByRole('listitem')).toHaveLength(
      paths.reduce((total, p) => total + p.length, 0),
    )
  })
})
