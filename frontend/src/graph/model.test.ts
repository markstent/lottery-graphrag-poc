/**
 * The graph view model over the recorded A, B, C run (fixtures/run-abc.json)
 * and small hand-built event streams for the clustering rules.
 */

import { describe, expect, it } from 'vitest'

import type { components } from '../api/schema'
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
  withClustersOf,
  type GraphView,
  type GraphViewOptions,
} from './model'
import { pathsFromResult, sourceRecordsFromResult } from './from-result'

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

const tally = (values: string[]) =>
  values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1
    return counts
  }, {})
const countStates = (view: GraphView) => tally(view.nodes.map((n) => n.state))
const countOutcomes = (view: GraphView) =>
  tally(view.nodes.map((n) => n.outcome).filter((o) => o !== 'discovered'))

type GraphRunResult = components['schemas']['GraphRunResult']
const resultOf = (pipeline: 'B' | 'C') =>
  fixture.results.results[pipeline] as unknown as GraphRunResult

/** The paths the backend returned in the run's results. */
const pathsOf = (pipeline: 'B' | 'C'): string[][] =>
  pathsFromResult(resultOf(pipeline))

/** The sequence of the first event of `type` for `pipeline` naming `id`. */
function sequenceOf(type: string, pipeline: string, id: string): number {
  const found = recorded.find(
    (e) =>
      e.event_type === type &&
      e.pipeline === pipeline &&
      JSON.stringify(e.payload).includes(`"${id}"`),
  )
  if (!found) throw new Error(`no ${type} for ${id} in ${pipeline}`)
  return found.sequence
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
  evidencePath: { paths: 1, maxHops: 1 },
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

  it('gives the fixture these node states and outcomes', () => {
    const b = graphView(full.graph.B, options)
    expect(countStates(b)).toEqual({ seed: 1, selected: 3, discarded: 37 })
    expect(countOutcomes(b)).toEqual({ selected: 4, discarded: 37 })
    const c = graphView(full.graph.C, options)
    expect(countStates(c)).toEqual({
      seed: 2,
      concept: 3,
      selected: 3,
      discarded: 53,
    })
    expect(countOutcomes(c)).toEqual({ selected: 4, discarded: 57 })
  })

  it('reads the seeds as seeds and the three ontology concepts as concepts', () => {
    const b = graphView(full.graph.B, options)
    expect(stateOf(b, 'INC_037')).toBe('seed')
    const c = graphView(full.graph.C, options)
    expect(stateOf(c, 'INC_037')).toBe('seed')
    expect(stateOf(c, 'CONCEPT_INCIDENT')).toBe('seed')
    const concepts = c.nodes.filter((n) => n.kind === 'concept')
    expect(concepts.map((n) => n.id).sort()).toEqual(
      full.graph.C.concepts.map((x) => x.id).sort(),
    )
    for (const n of concepts) expect(n.state).toBe('concept')
    expect(b.nodes.some((n) => n.kind === 'concept')).toBe(false)
  })

  it('keeps the verdict of a seed or concept in outcome for a badge', () => {
    const c = graphView(full.graph.C, options)
    const outcomeOf = (id: string) => c.nodes.find((n) => n.id === id)?.outcome
    expect(outcomeOf('INC_037')).toBe('selected')
    expect(outcomeOf('CONCEPT_INCIDENT')).toBe('discarded')
    expect(outcomeOf('CONCEPT_APPLICATION_INCIDENT')).toBe('discarded')
  })

  it('labels a node with its recorded label and an edge with its target state', () => {
    const view = graphView(full.graph.B, options)
    expect(view.nodes[0]).toMatchObject({ id: 'INC_037', label: 'Incident' })
    for (const edge of view.edges)
      expect(edge.state).toBe(stateOf(view, edge.target))
  })
})

describe('state: role first (seed, concept), then outcome (selected, discarded, candidate, source record, traversed)', () => {
  it('a node found by traversal alone is traversed', () => {
    const seq = sequenceOf(
      'graph.node.discovered',
      'C',
      'CONCEPT_APPLICATION_INCIDENT',
    )
    const view = graphView(graphAt('C', seq), options)
    expect(stateOf(view, 'CONCEPT_APPLICATION_INCIDENT')).toBe('traversed')
  })

  it('a node the reranker judged, with no verdict yet, is a candidate', () => {
    const seq = sequenceOf('graph.candidate.reranked', 'C', 'SUP_00113')
    const view = graphView(graphAt('C', seq), options)
    expect(stateOf(view, 'SUP_00113')).toBe('candidate')
  })

  it('a node with a verdict shows it', () => {
    const view = graphView(full.graph.C, options)
    expect(stateOf(view, 'SUP_00113')).toBe('selected')
    const discarded = full.graph.C.nodes.find(
      (n) => n.outcome === 'discarded' && !n.seed,
    )
    expect(stateOf(view, discarded?.id ?? '')).toBe('discarded')
  })

  it('a concept is a concept from its ontology event on, whatever happens after', () => {
    const seq = sequenceOf(
      'graph.ontology.expanded',
      'C',
      'CONCEPT_APPLICATION_INCIDENT',
    )
    const judged = sequenceOf(
      'graph.candidate.reranked',
      'C',
      'CONCEPT_APPLICATION_INCIDENT',
    )
    for (const at of [seq, judged, recorded.length]) {
      const view = graphView(graphAt('C', at), options)
      expect(stateOf(view, 'CONCEPT_APPLICATION_INCIDENT')).toBe('concept')
    }
  })

  it('a seed is a seed from its event on, whatever its verdict', () => {
    const seq = sequenceOf('graph.seed.selected', 'B', 'INC_037')
    const early = graphView(graphAt('B', seq), options)
    expect(stateOf(early, 'INC_037')).toBe('seed')
    expect(early.nodes[0].outcome).toBe('discovered')
    expect(stateOf(graphView(full.graph.B, options), 'INC_037')).toBe('seed')
  })

  it('a node with a source record is one until a verdict or role replaces it', () => {
    const sourceRecordIds = sourceRecordsFromResult(resultOf('C'))
    expect([...sourceRecordIds].sort()).toEqual(
      ['INC_037', 'SUP_00005', 'SUP_00113', 'SUP_00121'].sort(),
    )
    const found: GraphNode = {
      ...node('X', 'SupportCase'),
      outcome: 'discovered',
    }
    const once = graphView(graphOf([found]), {
      ...options,
      sourceRecordIds: new Set(['X']),
    })
    expect(stateOf(once, 'X')).toBe('source_record')
    const done = graphView(full.graph.C, { ...options, sourceRecordIds })
    expect(stateOf(done, 'SUP_00113')).toBe('selected')
    expect(stateOf(done, 'INC_037')).toBe('seed')
  })
})

describe('evidence paths', () => {
  it('are ignored until the path event is recorded', () => {
    const paths = pathsOf('C')
    const sourceRecordIds = sourceRecordsFromResult(resultOf('C'))
    const before = sequenceOf('graph.evidence_path.completed', 'C', 'paths') - 1
    const early = graphView(graphAt('C', before), {
      ...options,
      paths,
      sourceRecordIds,
    })
    expect(early.path).toEqual([])
    expect(early.paths).toEqual([])
    expect(early.recordedPaths).toEqual([])
    expect(early.nodes.some((n) => n.onPath)).toBe(false)
    expect(early.edges.some((e) => e.onPath)).toBe(false)
    expect(early.nodes.some((n) => n.state === 'source_record')).toBe(false)
    const at = graphView(graphAt('C', before + 1), { ...options, paths })
    expect(at.path.length).toBeGreaterThan(0)
  })

  it('are ignored at a mid-replay cursor too', () => {
    const mid = recorded.filter((e) => e.pipeline === 'C')[40].sequence
    const view = graphView(graphAt('C', mid), {
      ...options,
      paths: pathsOf('C'),
    })
    expect(view.path).toEqual([])
    expect(view.nodes.some((n) => n.onPath)).toBe(false)
  })

  it('keep the recorded order and mark their nodes and edges', () => {
    const paths = pathsOf('C')
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
      const paths = pathsOf(id)
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
    const view = graphView(full.graph.B, { ...options, cap: 41 })
    expect(view.clusters).toEqual([])
    expect(view.nodes.every((n) => n.clusterId === undefined)).toBe(true)
  })

  it('has a default cap of 24, which folds the 41 nodes of B', () => {
    expect(DEFAULT_VISIBLE_NODE_CAP).toBe(24)
    const view = graphView(full.graph.B, options)
    const visible =
      view.nodes.filter((n) => n.clusterId === undefined).length +
      view.clusters.length
    expect(view.clusters.length).toBeGreaterThan(0)
    expect(visible).toBeLessThanOrEqual(24)
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

  it('never clusters a seed, a node on an evidence path or the selected evidence', () => {
    const paths = pathsOf('C')
    const view = graphView(full.graph.C, { ...options, cap: 20, paths })
    const seeds = full.graph.C.nodes.filter((n) => n.seed).map((n) => n.id)
    expect(view.clusters.length).toBeGreaterThan(0)
    for (const n of view.nodes)
      if (n.onPath || n.outcome === 'selected' || seeds.includes(n.id))
        expect(n.clusterId).toBeUndefined()
    expect(view.nodes.filter((n) => n.outcome === 'selected')).toHaveLength(4)
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
    const paths = pathsOf('C')
    const once = graphView(full.graph.C, { ...options, cap: 30, paths })
    const again = graphView(full.graph.C, { ...options, cap: 30, paths })
    expect(again).toEqual(once)
  })

  it('in focus clusters every group of two or more whatever the cap', () => {
    const paths = pathsOf('B')
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

describe('path steps', () => {
  const twoWay: GraphEvents = {
    ...graphOf([
      { ...node('A', 'Incident', 0), seed: true, outcome: 'selected' },
      { ...node('B', 'Game', 1), outcome: 'selected' },
    ]),
    relationships: [
      { from: 'A', type: 'AFFECTS', to: 'B', toLabel: 'Game', hop: 1 },
      { from: 'B', type: 'RELATED_TO', to: 'A', toLabel: 'Incident', hop: 1 },
    ],
  }

  it('puts every edge between neighbours on a bare path', () => {
    const view = graphView(twoWay, { ...options, paths: [['A', 'B']] })
    expect(view.edges.map((e) => e.onPath)).toEqual([true, true])
  })

  it('puts only the edge of the named relationship on a path', () => {
    const view = graphView(twoWay, {
      ...options,
      paths: [{ ids: ['A', 'B'], lastRelationship: 'RELATED_TO' }],
    })
    expect(view.edges.map((e) => [e.relationship, e.onPath])).toEqual([
      ['AFFECTS', false],
      ['RELATED_TO', true],
    ])
    expect(view.pathSteps).toEqual([['B>RELATED_TO>A']])
  })

  it('takes the edge that runs along the path before one that runs against it', () => {
    const both: GraphEvents = {
      ...twoWay,
      relationships: [
        { from: 'B', type: 'AFFECTS', to: 'A', toLabel: 'Incident', hop: 1 },
        { from: 'A', type: 'AFFECTS', to: 'B', toLabel: 'Game', hop: 1 },
      ],
    }
    const view = graphView(both, {
      ...options,
      paths: [{ ids: ['A', 'B'], lastRelationship: 'AFFECTS' }],
    })
    expect(view.pathSteps).toEqual([['A>AFFECTS>B']])
    expect(view.edges.map((e) => e.onPath)).toEqual([false, true])
  })

  it('takes an edge that runs against the path when none runs along it', () => {
    const view = graphView(twoWay, {
      ...options,
      paths: [{ ids: ['B', 'A'], lastRelationship: 'AFFECTS' }],
    })
    expect(view.pathSteps).toEqual([['A>AFFECTS>B']])
  })

  it('reports ids with no recorded node and keeps the path as recorded', () => {
    const view = graphView(twoWay, { ...options, paths: [['A', 'X', 'B']] })
    expect(view.droppedPathIds).toEqual(['X'])
    expect(view.recordedPaths).toEqual([['A', 'X', 'B']])
    expect(view.paths).toEqual([['A', 'B']])
    expect(view.pathSteps).toEqual([[null, null]])
    expect(view.edges.map((e) => e.onPath)).toEqual([false, false])
  })
})

describe('withClustersOf', () => {
  const finalView = graphView(full.graph.C, { ...options, cap: 20 })
  const partial = graphView(graphAt('C', 405), { ...options, cap: 1000 })
  const shown = withClustersOf(partial, finalView)

  it('keeps the nodes, edges and paths of the view it is given', () => {
    expect(shown.nodes.map((n) => n.id)).toEqual(partial.nodes.map((n) => n.id))
    expect(shown.edges).toEqual(partial.edges)
    expect(shown.path).toEqual(partial.path)
  })

  it('puts each node in the group it has in the final view, or in none', () => {
    const finalCluster = new Map(
      finalView.nodes.map((n) => [n.id, n.clusterId]),
    )
    for (const n of shown.nodes)
      expect(n.clusterId ?? n.slot).toBe(finalCluster.get(n.id))
    expect(shown.nodes.some((n) => n.clusterId !== undefined)).toBe(true)
  })

  it('draws a group only from two revealed members; a lone member takes the group as its slot', () => {
    const lone = shown.nodes.filter((n) => n.slot !== undefined)
    expect(lone.length).toBeGreaterThan(0)
    for (const n of lone) {
      expect(n.clusterId).toBeUndefined()
      expect(shown.clusters.some((c) => c.id === n.slot)).toBe(false)
      const members = shown.nodes.filter(
        (m) => (m.clusterId ?? m.slot) === n.slot,
      )
      expect(members).toHaveLength(1)
    }
    for (const c of shown.clusters) expect(c.count).toBeGreaterThanOrEqual(2)
    expect(shown.nodes.some((n) => n.slot === undefined && n.clusterId)).toBe(
      true,
    )
  })

  it('counts only the members that have arrived, and drops a group with none', () => {
    for (const c of shown.clusters) {
      expect(c.count).toBe(c.members.length)
      expect(c.count).toBeGreaterThan(0)
      const whole = finalView.clusters.find((f) => f.id === c.id)
      expect(c.count).toBeLessThanOrEqual(whole?.count ?? 0)
    }
    expect(shown.clusters.length).toBeLessThanOrEqual(finalView.clusters.length)
  })

  it('is the final view when the view is complete', () => {
    const done = withClustersOf(finalView, finalView)
    expect(done.clusters).toEqual(finalView.clusters)
    expect(done.nodes.some((n) => n.slot !== undefined)).toBe(false)
  })
})

describe('evidence path nodes are never grouped', () => {
  for (const config of ['B', 'C'] as const) {
    for (const [cap, focus] of [
      [DEFAULT_VISIBLE_NODE_CAP, false],
      [12, false],
      [60, true],
    ] as const) {
      it(`on ${config} at cap ${cap}${focus ? ' with focus' : ''}, once the path is recorded`, () => {
        const events = full.graph[config]
        const view = graphView(events, {
          cap,
          focus,
          paths: pathsFromResult(resultOf(config)),
        })
        expect(view.path.length).toBeGreaterThan(0)
        const grouped = new Set(view.clusters.flatMap((c) => c.members))
        for (const id of view.path) expect(grouped.has(id), id).toBe(false)
        for (const node of view.nodes.filter((n) => n.onPath)) {
          expect(node.clusterId, node.id).toBeUndefined()
          expect(node.slot, node.id).toBeUndefined()
        }
      })
    }
  }

  it('also holds in a replay drawn with the final grouping, before and after the path event', () => {
    const paths = pathsFromResult(resultOf('B'))
    const finalView = graphView(full.graph.B, { ...options, paths })
    for (const upTo of [200, 600, recorded.length]) {
      const part = reduceAll(recorded.slice(0, upTo)).graph.B
      const shown = withClustersOf(
        graphView(part, { ...options, paths }),
        finalView,
      )
      const grouped = new Set(shown.clusters.flatMap((c) => c.members))
      for (const id of finalView.path)
        expect(grouped.has(id), `${id} at ${upTo}`).toBe(false)
    }
  })
})
