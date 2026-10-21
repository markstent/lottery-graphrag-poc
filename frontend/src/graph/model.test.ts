/**
 * The graph view model over the recorded A, B, C run (fixtures/run-abc.json)
 * and small hand-built event streams for the clustering rules.
 */

import { describe, expect, it } from 'vitest'

import fixture from '../run/fixtures/run-abc.json'
import {
  reduceAll,
  type GraphEvents,
  type GraphNode,
  type RunEvent,
} from '../run/reduce'
import {
  DEFAULT_VISIBLE_NODE_CAP,
  graphView,
  type GraphView,
  type GraphViewOptions,
} from './model'

const recorded = fixture.events as unknown as RunEvent[]
const full = reduceAll(recorded)
const options: GraphViewOptions = {
  cap: DEFAULT_VISIBLE_NODE_CAP,
  focus: false,
}

/** The graph of `pipeline` after the events up to and including `sequence`. */
const graphAt = (pipeline: 'B' | 'C', sequence: number): GraphEvents =>
  reduceAll(recorded.filter((e) => e.sequence <= sequence)).graph[pipeline]

const stateOf = (view: GraphView, id: string) =>
  view.nodes.find((n) => n.id === id)?.state

const countStates = (view: GraphView) =>
  view.nodes.reduce<Record<string, number>>((counts, node) => {
    counts[node.state] = (counts[node.state] ?? 0) + 1
    return counts
  }, {})

/**
 * Evidence paths for the fixture's selected nodes, followed back along the
 * recorded relationship events. The backend returns them in the run's
 * results, which the fixture does not carry; this stands in for them.
 */
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

const node = (id: string, label: string, hop = 2): GraphNode => ({
  id,
  label,
  hop,
  seed: false,
  viaConcept: null,
  outcome: 'discarded',
  reason: 'context_budget',
  score: 0.1,
  rerankScore: null,
})

const graphOf = (nodes: GraphNode[]): GraphEvents => ({
  entities: [],
  nodes,
  relationships: [],
  concepts: [],
  evidencePath: null,
})

describe('the recorded run', () => {
  it('shows every node and edge that was recorded and no other', () => {
    for (const id of ['B', 'C'] as const) {
      const view = graphView(full.graph[id], options)
      expect(view.nodes.map((n) => n.id)).toEqual(
        full.graph[id].nodes.map((n) => n.id),
      )
      expect(
        view.edges.map((e) => [e.source, e.relationship, e.target]),
      ).toEqual(full.graph[id].relationships.map((r) => [r.from, r.type, r.to]))
      expect(new Set(view.edges.map((e) => e.id)).size).toBe(view.edges.length)
    }
  })

  it('gives the fixture these node states', () => {
    expect(countStates(graphView(full.graph.B, options))).toEqual({
      selected: 4,
      discarded: 37,
    })
    expect(countStates(graphView(full.graph.C, options))).toEqual({
      selected: 4,
      discarded: 57,
    })
  })

  it('marks a concept by kind even when its verdict sets it aside', () => {
    const view = graphView(full.graph.C, options)
    const concepts = view.nodes.filter((n) => n.kind === 'concept')
    expect(concepts.map((n) => n.id).sort()).toEqual(
      full.graph.C.concepts.map((c) => c.id).sort(),
    )
    expect(
      graphView(full.graph.B, options).nodes.some((n) => n.kind === 'concept'),
    ).toBe(false)
  })

  it('labels a node with its recorded label and an edge with its target state', () => {
    const view = graphView(full.graph.B, options)
    expect(view.nodes[0]).toMatchObject({ id: 'INC_037', label: 'Incident' })
    for (const edge of view.edges)
      expect(edge.state).toBe(stateOf(view, edge.target))
  })
})

describe('state precedence: selected, discarded, candidate, seed, concept, source record, traversed', () => {
  it('a node found by traversal alone is traversed', () => {
    const view = graphView(graphAt('C', 465), options)
    expect(stateOf(view, 'CONCEPT_APPLICATION_INCIDENT')).toBe('traversed')
  })

  it('a seed with no verdict yet is a seed', () => {
    expect(stateOf(graphView(graphAt('B', 135), options), 'INC_037')).toBe(
      'seed',
    )
  })

  it('an ontology concept with no verdict yet is a concept', () => {
    const view = graphView(graphAt('C', 505), options)
    expect(stateOf(view, 'CONCEPT_APPLICATION_INCIDENT')).toBe('concept')
  })

  it('a reranked node is a candidate, ahead of concept', () => {
    const view = graphView(graphAt('C', 560), options)
    const concept = view.nodes.find(
      (n) => n.id === 'CONCEPT_APPLICATION_INCIDENT',
    )
    expect(concept).toMatchObject({ state: 'candidate', kind: 'concept' })
  })

  it('a verdict beats seed and concept in the finished run', () => {
    const view = graphView(full.graph.C, options)
    expect(stateOf(view, 'INC_037')).toBe('selected')
    expect(stateOf(view, 'CONCEPT_INCIDENT')).toBe('discarded')
    expect(stateOf(view, 'CONCEPT_APPLICATION_INCIDENT')).toBe('discarded')
  })

  it('a source record ranks below concept and above traversed, and below a verdict', () => {
    const sourceRecordIds = new Set(['CONCEPT_APPLICATION_INCIDENT', 'INC_037'])
    const early = graphView(graphAt('C', 465), { ...options, sourceRecordIds })
    expect(stateOf(early, 'CONCEPT_APPLICATION_INCIDENT')).toBe('source_record')
    const late = graphView(graphAt('C', 505), { ...options, sourceRecordIds })
    expect(stateOf(late, 'CONCEPT_APPLICATION_INCIDENT')).toBe('concept')
    const done = graphView(full.graph.C, { ...options, sourceRecordIds })
    expect(stateOf(done, 'INC_037')).toBe('selected')
  })
})

describe('evidence paths', () => {
  it('keep the recorded order and mark their nodes and edges', () => {
    const paths = pathsOf(full.graph.C)
    const view = graphView(full.graph.C, { ...options, paths })
    expect(view.paths).toEqual(paths)
    expect(view.path).toEqual([...new Set(paths.flat())])
    expect(view.path[0]).toBe('INC_037')
    const onPath = view.nodes.filter((n) => n.onPath).map((n) => n.id)
    expect(new Set(onPath)).toEqual(new Set(view.path))
    const edgesOnPath = view.edges.filter((e) => e.onPath)
    expect(edgesOnPath.map((e) => e.target).sort()).toEqual(
      ['SUP_00005', 'SUP_00113', 'SUP_00121'].sort(),
    )
  })

  it('agree with the path event the backend recorded', () => {
    for (const id of ['B', 'C'] as const) {
      const paths = pathsOf(full.graph[id])
      expect(paths).toHaveLength(full.graph[id].evidencePath?.paths ?? -1)
      expect(Math.max(...paths.map((p) => p.length - 1))).toBe(
        full.graph[id].evidencePath?.maxHops,
      )
    }
  })

  it('leave out an id no event recorded rather than invent a node', () => {
    const view = graphView(full.graph.B, {
      ...options,
      paths: [['INC_037', 'NOT_RECORDED', 'SUP_00113']],
    })
    expect(view.paths).toEqual([['INC_037', 'SUP_00113']])
    expect(view.nodes.some((n) => n.id === 'NOT_RECORDED')).toBe(false)
  })

  it('are empty when none were given', () => {
    const view = graphView(full.graph.B, options)
    expect(view.paths).toEqual([])
    expect(view.path).toEqual([])
  })
})

describe('added by the ontology', () => {
  it('is true for the nodes C found that B never did, with B as the overlay', () => {
    const b = new Set(full.graph.B.nodes.map((n) => n.id))
    const view = graphView(full.graph.C, { ...options, overlay: full.graph.B })
    const added = view.nodes.filter((n) => n.addedByOntology)
    expect(full.graph.B.nodes).toHaveLength(41)
    expect(full.graph.C.nodes).toHaveLength(61)
    expect(added).toHaveLength(20)
    for (const n of view.nodes) expect(n.addedByOntology).toBe(!b.has(n.id))
  })

  it('is false without an overlay and for B against itself', () => {
    expect(
      graphView(full.graph.C, options).nodes.some((n) => n.addedByOntology),
    ).toBe(false)
    const own = graphView(full.graph.B, { ...options, overlay: full.graph.B })
    expect(own.nodes.some((n) => n.addedByOntology)).toBe(false)
  })
})

describe('clustering', () => {
  it('does nothing at or below the cap', () => {
    const view = graphView(full.graph.B, options)
    expect(view.clusters).toEqual([])
    expect(view.nodes.every((n) => n.clusterId === undefined)).toBe(true)
  })

  it('groups the largest (hop, label) group of C above the cap and drops nothing', () => {
    const view = graphView(full.graph.C, { ...options, cap: 50 })
    expect(view.nodes).toHaveLength(61)
    expect(view.clusters).toHaveLength(1)
    const [cluster] = view.clusters
    expect(cluster).toMatchObject({
      id: 'cluster:3:IncidentType',
      label: 'IncidentType',
      hop: 3,
      count: 12,
    })
    expect(new Set(cluster.members)).toEqual(
      new Set(
        full.graph.C.nodes
          .filter((n) => n.hop === 3 && n.label === 'IncidentType')
          .map((n) => n.id),
      ),
    )
    const clustered = view.nodes.filter((n) => n.clusterId === cluster.id)
    expect(clustered.map((n) => n.id).sort()).toEqual(
      [...cluster.members].sort(),
    )
  })

  it('keeps visible nodes plus clusters at or below the cap', () => {
    for (const cap of [60, 50, 40, 30]) {
      const view = graphView(full.graph.C, { ...options, cap })
      const visible = view.nodes.filter((n) => n.clusterId === undefined).length
      expect(visible + view.clusters.length).toBeLessThanOrEqual(cap)
      const members = view.clusters.flatMap((c) => c.members)
      expect(members).toHaveLength(view.nodes.length - visible)
      expect(new Set(members).size).toBe(members.length)
      for (const c of view.clusters) expect(c.count).toBe(c.members.length)
    }
  })

  it('never clusters a seed or a node on an evidence path', () => {
    const paths = pathsOf(full.graph.C)
    const view = graphView(full.graph.C, { ...options, cap: 20, paths })
    const seeds = full.graph.C.nodes.filter((n) => n.seed).map((n) => n.id)
    for (const n of view.nodes)
      if (n.onPath || seeds.includes(n.id)) expect(n.clusterId).toBeUndefined()
  })

  it('never makes a cluster of one node', () => {
    const view = graphView(full.graph.C, { ...options, cap: 1 })
    for (const c of view.clusters) expect(c.count).toBeGreaterThan(1)
  })

  it('breaks ties by label, then by first event', () => {
    const nodes = [
      node('z1', 'Zeta'),
      node('z2', 'Zeta'),
      node('a1', 'Alpha'),
      node('a2', 'Alpha'),
      node('a3', 'Alpha', 3),
      node('a4', 'Alpha', 3),
    ]
    const view = graphView(graphOf(nodes), { cap: 5, focus: false })
    expect(view.clusters.map((c) => c.id)).toEqual(['cluster:2:Alpha'])
    const more = graphView(graphOf(nodes), { cap: 4, focus: false })
    expect(more.clusters.map((c) => c.id)).toEqual([
      'cluster:2:Alpha',
      'cluster:3:Alpha',
    ])
    const first = graphView(
      graphOf([...nodes.slice(4), ...nodes.slice(0, 4)]),
      {
        cap: 5,
        focus: false,
      },
    )
    expect(first.clusters.map((c) => c.id)).toEqual(['cluster:3:Alpha'])
  })

  it('gives the same view for the same events', () => {
    const paths = pathsOf(full.graph.C)
    const once = graphView(full.graph.C, { ...options, cap: 30, paths })
    const again = graphView(full.graph.C, { ...options, cap: 30, paths })
    expect(again).toEqual(once)
  })

  it('in focus clusters every group of two or more whatever the cap', () => {
    const paths = pathsOf(full.graph.B)
    const view = graphView(full.graph.B, { cap: 999, focus: true, paths })
    expect(view.clusters.length).toBeGreaterThan(0)
    for (const n of view.nodes)
      if (n.onPath) expect(n.clusterId).toBeUndefined()
    expect(view.nodes).toHaveLength(41)
  })
})

describe('edges', () => {
  it('keep both ends when the same relationship was recorded twice', () => {
    const graph: GraphEvents = {
      ...graphOf([node('a', 'A', 0), node('b', 'B', 1)]),
      relationships: [
        { from: 'a', type: 'AFFECTS', to: 'b', toLabel: 'B', hop: 1 },
        { from: 'a', type: 'AFFECTS', to: 'b', toLabel: 'B', hop: 1 },
      ],
    }
    const view = graphView(graph, options)
    expect(view.edges).toHaveLength(2)
    expect(new Set(view.edges.map((e) => e.id)).size).toBe(2)
  })
})
