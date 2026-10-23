import { describe, expect, it } from 'vitest'

import {
  layoutGraph,
  orderForLayout,
  tidyRoute,
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

describe('tags', () => {
  const box = (centre: Point) => ({
    left: centre.x - tag.width / 2,
    right: centre.x + tag.width / 2,
    top: centre.y - tag.height / 2,
    bottom: centre.y + tag.height / 2,
  })
  const hit = (
    a: { left: number; right: number; top: number; bottom: number },
    b: { left: number; right: number; top: number; bottom: number },
  ) =>
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

  it('never overlap one another or a node, in a whole layout', async () => {
    const { nodes, edges } = star(14)
    const { positions, routes } = await layoutGraph(
      nodes,
      edges,
      HEIGHT,
      new Map(),
    )
    const tags = [...routes.values()].map((r) => box(r.tag))
    tags.forEach((a, i) => {
      for (const b of tags.slice(i + 1)) expect(hit(a, b)).toBe(false)
      for (const [id, at] of positions)
        expect(
          hit(a, {
            left: at.x,
            right: at.x + (nodes.find((n) => n.id === id)?.width ?? 0),
            top: at.y,
            bottom: at.y + HEIGHT,
          }),
        ).toBe(false)
    })
  })

  it('sit on a stretch of their own edge that no other edge shares', async () => {
    const { nodes, edges } = star(6)
    const { routes } = await layoutGraph(nodes, edges, HEIGHT, new Map())
    for (const edge of edges) {
      const route = routes.get(edge.id) as { points: Point[]; tag: Point }
      const last = route.points.slice(-2)
      // The run into the target is the edge's own: the tag is within its x range.
      expect(route.tag.x).toBeGreaterThanOrEqual(Math.min(last[0].x, last[1].x))
      expect(route.tag.x).toBeLessThanOrEqual(Math.max(last[0].x, last[1].x))
    }
  })

  it('are clear of nodes and of each other on a plain route as well', async () => {
    const { nodes, edges } = star(6)
    const pinned = new Map<string, Point>(
      nodes
        .slice(1)
        .map((n, i): [string, Point] => [n.id, { x: 700, y: i * 100 }]),
    )
    const { positions, routes } = await layoutGraph(
      nodes,
      edges,
      HEIGHT,
      pinned,
    )
    const tags = [...routes.values()].map((r) => box(r.tag))
    tags.forEach((a, i) => {
      for (const b of tags.slice(i + 1)) expect(hit(a, b)).toBe(false)
    })
    for (const a of tags)
      for (const at of positions.values())
        expect(
          hit(a, {
            left: at.x,
            right: at.x + 260,
            top: at.y,
            bottom: at.y + HEIGHT,
          }),
        ).toBe(false)
  })
})

describe('crowded tags', () => {
  it('still never overlap a node or each other when the runs are packed', async () => {
    const { nodes, edges } = star(14)
    const pinned = new Map<string, Point>([['n0', { x: 0, y: 200 }]])
    nodes.slice(1).forEach((n, i) => pinned.set(n.id, { x: 330, y: i * 70 }))
    const { positions, routes } = await layoutGraph(
      nodes,
      edges,
      HEIGHT,
      pinned,
    )
    const boxes = [...routes.values()].map((r) => ({
      left: r.tag.x - tag.width / 2,
      right: r.tag.x + tag.width / 2,
      top: r.tag.y - tag.height / 2,
      bottom: r.tag.y + tag.height / 2,
    }))
    const hit = (a: (typeof boxes)[0], b: (typeof boxes)[0]) =>
      a.left < b.right &&
      b.left < a.right &&
      a.top < b.bottom &&
      b.top < a.bottom
    boxes.forEach((a, i) => {
      for (const b of boxes.slice(i + 1)) expect(hit(a, b)).toBe(false)
      for (const at of positions.values())
        expect(
          hit(a, {
            left: at.x,
            right: at.x + 260,
            top: at.y,
            bottom: at.y + HEIGHT,
          }),
        ).toBe(false)
    })
  })
})

describe('priority nodes', () => {
  it('take the top slots of their layer in a whole layout', async () => {
    const { nodes, edges } = star(14)
    const priority = new Set(['n9', 'n12', 'n3'])
    const { positions } = await layoutGraph(
      nodes,
      edges,
      HEIGHT,
      new Map(),
      priority,
    )
    const layer = nodes.slice(1).map((n) => ({
      id: n.id,
      y: (positions.get(n.id) as Point).y,
    }))
    const top = layer
      .sort((a, b) => a.y - b.y)
      .slice(0, priority.size)
      .map((n) => n.id)
    expect(new Set(top)).toEqual(priority)
  })

  it('keep elk routes when the priority nodes are listed first', async () => {
    const { nodes, edges } = star(10)
    const { routes } = await layoutGraph(
      nodes,
      edges,
      HEIGHT,
      new Map(),
      new Set(['n5']),
    )
    expect([...routes.values()].every((r) => r.kind === 'elk')).toBe(true)
  })
})

describe('tidyRoute', () => {
  it('flattens a short kink between two runs', () => {
    expect(
      tidyRoute([
        { x: 0, y: 100 },
        { x: 50, y: 100 },
        { x: 50, y: 329 },
        { x: 200, y: 329 },
        { x: 200, y: 322 },
        { x: 300, y: 322 },
      ]),
    ).toEqual([
      { x: 0, y: 100 },
      { x: 50, y: 100 },
      { x: 50, y: 322 },
      { x: 300, y: 322 },
    ])
  })

  it('keeps a real step', () => {
    const route = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 80 },
      { x: 100, y: 80 },
    ]
    expect(tidyRoute(route)).toEqual(route)
  })

  it('drops repeated points and the middle of a straight run', () => {
    expect(
      tidyRoute([
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 40, y: 0 },
        { x: 100, y: 0 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ])
  })
})

describe('orderForLayout', () => {
  const ids = (items: { id: string }[]) => items.map((i) => i.id)
  const { nodes, edges } = star(8)

  it('lists the priority nodes, then their neighbours, then the rest, each in given order', () => {
    // n0 is the seed; n6 and n3 are on the path.
    const ordered = orderForLayout(nodes, edges, new Set(['n0', 'n6', 'n3']))
    // n0 and the path first, then the other neighbours of the seed (all of them here).
    expect(ids(ordered.nodes)).toEqual([
      'n0',
      'n3',
      'n6',
      'n1',
      'n2',
      'n4',
      'n5',
      'n7',
    ])
  })

  it('puts the neighbours of a priority node ahead of nodes further away', () => {
    const chain = [node('a'), node('b'), node('c'), node('d')]
    const links = [
      { id: 'a>b', source: 'a', target: 'b', tag },
      { id: 'b>c', source: 'b', target: 'c', tag },
      { id: 'c>d', source: 'c', target: 'd', tag },
    ]
    const ordered = orderForLayout(chain, links, new Set(['b']))
    expect(ids(ordered.nodes)).toEqual(['b', 'a', 'c', 'd'])
  })

  it('ranks an edge with its better-ranked end and keeps given order within a rank', () => {
    const ordered = orderForLayout(nodes, edges, new Set(['n6']))
    expect(ids(ordered.edges)).toEqual([
      'n0>n6',
      'n0>n1',
      'n0>n2',
      'n0>n3',
      'n0>n4',
      'n0>n5',
      'n0>n7',
    ])
  })

  it('changes nothing without priority nodes', () => {
    const ordered = orderForLayout(nodes, edges, new Set())
    expect(ids(ordered.nodes)).toEqual(ids(nodes))
    expect(ids(ordered.edges)).toEqual(ids(edges))
  })

  it('does not change the lists it is given', () => {
    const before = ids(nodes)
    orderForLayout(nodes, edges, new Set(['n5']))
    expect(ids(nodes)).toEqual(before)
  })
})
