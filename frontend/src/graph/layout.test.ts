import { describe, expect, it } from 'vitest'

import {
  layoutGraph,
  type LayoutEdge,
  type LayoutNode,
  type Point,
} from './layout'

const HEIGHT = 64
const tag = { width: 100, height: 25 }

const node = (id: string, width = 260): LayoutNode => ({ id, width })

/** A source with `n - 1` children. */
function star(n: number) {
  const nodes = Array.from({ length: n }, (_, i) => node(`n${i}`))
  const edges: LayoutEdge[] = nodes.slice(1).map((target) => ({
    id: `n0>${target.id}`,
    source: 'n0',
    target: target.id,
    tag,
  }))
  return { nodes, edges }
}

function expectNoOverlap(positions: Map<string, Point>, nodes: LayoutNode[]) {
  const width = new Map(nodes.map((n) => [n.id, n.width]))
  const all = [...positions.entries()]
  for (const [i, [idA, a]] of all.entries())
    for (const [idB, b] of all.slice(i + 1)) {
      const apart =
        a.x + (width.get(idA) ?? 0) <= b.x ||
        b.x + (width.get(idB) ?? 0) <= a.x ||
        Math.abs(a.y - b.y) >= HEIGHT
      expect(apart, `${idA} and ${idB} overlap`).toBe(true)
    }
}

describe('layoutGraph', () => {
  it('places every node, layers left to right, and never overlaps two nodes', async () => {
    const { nodes, edges } = star(30)
    const { positions } = await layoutGraph(nodes, edges, HEIGHT, new Map())
    expect([...positions.keys()].sort()).toEqual(nodes.map((n) => n.id).sort())
    const seed = positions.get('n0') as Point
    for (const { id } of nodes.slice(1))
      expect((positions.get(id) as Point).x).toBeGreaterThan(seed.x + 260)
    expectNoOverlap(positions, nodes)
  })

  it('fits nodes of different widths without overlap', async () => {
    const nodes = [
      node('a', 200),
      node('b', 420),
      node('c', 300),
      node('d', 200),
    ]
    const edges = ['b', 'c', 'd'].map((t) => ({
      id: `a>${t}`,
      source: 'a',
      target: t,
      tag,
    }))
    const { positions } = await layoutGraph(nodes, edges, HEIGHT, new Map())
    expectNoOverlap(positions, nodes)
  })

  it('keeps the exact position of every placed node when nodes are added', async () => {
    const small = star(8)
    const first = await layoutGraph(small.nodes, small.edges, HEIGHT, new Map())
    const large = star(40)
    const second = await layoutGraph(
      large.nodes,
      large.edges,
      HEIGHT,
      first.positions,
    )
    for (const [id, at] of first.positions)
      expect(second.positions.get(id)).toEqual(at)
    expect(second.positions.size).toBe(40)
    expectNoOverlap(second.positions, large.nodes)
  })

  it('keeps positions that elk would not have chosen', async () => {
    const { nodes, edges } = star(6)
    const pinned = new Map<string, Point>([
      ['n0', { x: 500, y: 900 }],
      ['n1', { x: 40, y: 10 }],
    ])
    const { positions } = await layoutGraph(nodes, edges, HEIGHT, pinned)
    expect(positions.get('n0')).toEqual({ x: 500, y: 900 })
    expect(positions.get('n1')).toEqual({ x: 40, y: 10 })
    expectNoOverlap(positions, nodes)
  })

  it('moves a new node clear of a placed node it would land on', async () => {
    const nodes = [node('n0'), node('n1')]
    const { positions } = await layoutGraph(
      nodes,
      [],
      HEIGHT,
      new Map([['n1', { x: 0, y: 0 }]]),
    )
    expect(positions.get('n1')).toEqual({ x: 0, y: 0 })
    expectNoOverlap(positions, nodes)
  })

  it('gives the same layout for the same graph', async () => {
    const { nodes, edges } = star(25)
    const a = await layoutGraph(nodes, edges, HEIGHT, new Map())
    const b = await layoutGraph(nodes, edges, HEIGHT, new Map())
    expect([...a.positions]).toEqual([...b.positions])
    expect([...a.routes]).toEqual([...b.routes])
  })

  it('ignores an edge to a node that is not there and an edge to itself', async () => {
    const { positions, routes } = await layoutGraph(
      [node('a'), node('b')],
      [
        { id: 'a>x', source: 'a', target: 'x', tag },
        { id: 'b>b', source: 'b', target: 'b', tag },
        { id: 'a>b', source: 'a', target: 'b', tag },
      ],
      HEIGHT,
      new Map(),
    )
    expect([...positions.keys()].sort()).toEqual(['a', 'b'])
    expect([...routes.keys()]).toEqual(['a>b'])
  })

  it('lays out nothing for no nodes', async () => {
    const { positions, routes } = await layoutGraph([], [], HEIGHT, new Map())
    expect(positions.size + routes.size).toBe(0)
  })
})

describe('edge routes', () => {
  it('run in right angles from the right of the source to the left of the target', async () => {
    const { nodes, edges } = star(6)
    const { positions, routes } = await layoutGraph(
      nodes,
      edges,
      HEIGHT,
      new Map(),
    )
    expect(routes.size).toBe(edges.length)
    for (const edge of edges) {
      const { points } = routes.get(edge.id) as { points: Point[] }
      const source = positions.get('n0') as Point
      const target = positions.get(edge.target) as Point
      expect(points[0]).toEqual({ x: source.x + 260, y: source.y + HEIGHT / 2 })
      expect(points.at(-1)).toEqual({ x: target.x, y: target.y + HEIGHT / 2 })
      points.slice(1).forEach((p, i) => {
        expect(p.x === points[i].x || p.y === points[i].y).toBe(true)
      })
    }
  })

  it('leave room for the tag: it sits on the route and clear of every node', async () => {
    const { nodes, edges } = star(8)
    const { positions, routes } = await layoutGraph(
      nodes,
      edges,
      HEIGHT,
      new Map(),
    )
    for (const edge of edges) {
      const { tag: centre } = routes.get(edge.id) as { tag: Point }
      const box = {
        left: centre.x - tag.width / 2,
        right: centre.x + tag.width / 2,
        top: centre.y - tag.height / 2,
        bottom: centre.y + tag.height / 2,
      }
      for (const at of positions.values())
        expect(
          box.left < at.x + 260 &&
            at.x < box.right &&
            box.top < at.y + HEIGHT &&
            at.y < box.bottom,
        ).toBe(false)
    }
  })

  it('fall back to a plain three-segment route for a node that was pinned elsewhere', async () => {
    const { nodes, edges } = star(3)
    const pinned = new Map([['n1', { x: 900, y: 500 }]])
    const { routes } = await layoutGraph(nodes, edges, HEIGHT, pinned)
    const { points } = routes.get('n0>n1') as { points: Point[] }
    expect(points).toHaveLength(4)
    expect(points[3]).toEqual({ x: 900, y: 532 })
  })
})
