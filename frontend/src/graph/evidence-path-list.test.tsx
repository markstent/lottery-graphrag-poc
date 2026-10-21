import { act, render, renderHook, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { components } from '../api/schema'
import { EVIDENCE_STATES } from '../design/evidence-states'
import fixture from '../run/fixtures/run-abc.json'
import { reduceAll, type RunEvent } from '../run/reduce'
import { useReplay } from '../run/use-replay'
import { pathsFromResult } from './from-result'
import { EvidencePathList } from './evidence-path-list'
import { DEFAULT_VISIBLE_NODE_CAP, graphView } from './model'

const recorded = fixture.events as unknown as RunEvent[]
const full = reduceAll(recorded)
const options = { cap: DEFAULT_VISIBLE_NODE_CAP, focus: false }

const resultOf = (pipeline: 'B' | 'C') =>
  fixture.results.results[
    pipeline
  ] as unknown as components['schemas']['GraphRunResult']
const pathsOf = (pipeline: 'B' | 'C') => pathsFromResult(resultOf(pipeline))

describe('EvidencePathList', () => {
  it('lists each path in order, one item per node', () => {
    const paths = pathsOf('C')
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
      `${EVIDENCE_STATES.seed.label}: incident (INC_037)`,
    )
    expect(first).not.toHaveTextContent('related')
    const edge = full.graph.B.relationships.find((r) => r.to === 'SUP_00113')
    expect(edge).toBeDefined()
    expect(second).toHaveTextContent(
      `${EVIDENCE_STATES.selected.label}: support case (SUP_00113), incident is related to support case`,
    )
  })

  it('says so when no path was recorded', () => {
    render(<EvidencePathList view={graphView(full.graph.B, options)} />)
    expect(screen.queryByRole('list')).toBeNull()
    expect(
      screen.getByText('No evidence path was recorded for this pipeline.'),
    ).toBeVisible()
  })

  it('says a step was not recorded and does not join its neighbours', () => {
    const view = graphView(full.graph.B, {
      ...options,
      paths: [['INC_037', 'NOT_A_NODE', 'SUP_00113']],
    })
    expect(view.droppedPathIds).toEqual(['NOT_A_NODE'])
    render(<EvidencePathList view={view} />)
    const [first, gap, last] = screen.getAllByRole('listitem')
    expect(first).toHaveTextContent('incident (INC_037)')
    expect(gap).toHaveTextContent('A step that was not recorded (NOT_A_NODE)')
    expect(last).toHaveTextContent('support case (SUP_00113)')
    expect(last).not.toHaveTextContent('related')
    expect(last).not.toHaveTextContent('incident')
  })

  it('names no step between two recorded nodes with no recorded edge', () => {
    const view = graphView(full.graph.B, {
      ...options,
      paths: [['SUP_00005', 'MKT_UK']],
    })
    expect(view.pathSteps).toEqual([[null]])
    render(<EvidencePathList view={view} />)
    const [, second] = screen.getAllByRole('listitem')
    expect(second).toHaveTextContent('market (MKT_UK)')
    expect(second).not.toHaveTextContent(',')
  })

  it('uses none of the banned words', () => {
    const view = graphView(full.graph.C, {
      ...options,
      paths: pathsOf('C'),
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
    const paths = pathsOf('C')
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
