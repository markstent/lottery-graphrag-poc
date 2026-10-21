import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { components } from '../api/schema'
import { EVIDENCE_STATES } from '../design/evidence-states'
import fixture from '../run/fixtures/run-abc.json'
import { reduceAll, type RunEvent } from '../run/reduce'
import { recordedPathsFromResult } from './from-result'
import { GraphSummary } from './graph-summary'
import { graphView } from './model'

const full = reduceAll(fixture.events as unknown as RunEvent[])
const paths = recordedPathsFromResult(
  fixture.results.results
    .C as unknown as components['schemas']['GraphRunResult'],
)
const viewOf = (cap: number) =>
  graphView(full.graph.C, { cap, focus: false, paths })

describe('GraphSummary', () => {
  it('counts the nodes and relationships and says how many lie on a path', () => {
    const view = viewOf(1000)
    const { container } = render(<GraphSummary id="s" view={view} />)
    expect(container.querySelector('p')).toHaveTextContent(
      `The graph shows ${view.nodes.length} nodes and ${view.edges.length} relationships.`,
    )
    expect(container.querySelector('p')).toHaveTextContent(
      `${view.path.length} nodes lie on an evidence path`,
    )
  })

  it('lists every node that is not on a path, once, under its state', () => {
    const view = viewOf(1000)
    render(<GraphSummary id="s" view={view} />)
    const onPath = new Set(view.path)
    const others = view.nodes.filter((n) => !onPath.has(n.id))
    for (const state of ['concept', 'discarded', 'seed'] as const) {
      const section = screen.queryByRole('region', {
        name: EVIDENCE_STATES[state].label,
      })
      const ofState = others.filter((n) => n.state === state)
      if (ofState.length === 0) continue
      expect(section).not.toBeNull()
      const items = within(section as HTMLElement).getAllByRole('listitem')
      expect(items).toHaveLength(ofState.length)
      for (const node of ofState)
        expect(section).toHaveTextContent(`(${node.id})`)
    }
    for (const id of onPath)
      expect(screen.queryByText(new RegExp(`\\(${id}\\)`))).toBeNull()
  })

  it('groups the nodes the cap folded together and names every member', () => {
    const view = viewOf(20)
    expect(view.clusters.length).toBeGreaterThan(0)
    render(<GraphSummary id="s" view={view} />)
    const folded = view.clusters.reduce((total, c) => total + c.count, 0)
    expect(screen.getByText(/are folded into/)).toHaveTextContent(
      `${folded} nodes are folded into ${view.clusters.length} groups`,
    )
    for (const cluster of view.clusters)
      for (const member of cluster.members)
        expect(document.body.textContent).toContain(member)
    expect(screen.getAllByText(/^Group of \d+ /).length).toBeGreaterThan(0)
  })

  it('says the kind of each node in plain words', () => {
    render(<GraphSummary id="s" view={viewOf(1000)} />)
    expect(document.body.textContent).toContain('incident type (')
    expect(document.body.textContent).not.toMatch(
      /IncidentType|BusinessConcept/,
    )
  })

  it('says so when no evidence path has been recorded', () => {
    render(
      <GraphSummary
        id="s"
        view={graphView(full.graph.C, { cap: 1000, focus: false })}
      />,
    )
    expect(
      screen.getByText(/No evidence path has been recorded yet/),
    ).toBeInTheDocument()
  })

  it('uses none of the banned words', () => {
    const { container } = render(<GraphSummary id="s" view={viewOf(20)} />)
    expect(container.textContent).not.toMatch(
      /honest|never|real|fake|prototype|telemetry|seed|chunk|rerank|MAPS_TO/i,
    )
  })
})
