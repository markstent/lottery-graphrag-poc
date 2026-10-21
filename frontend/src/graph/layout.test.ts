import { describe, expect, it } from 'vitest'

import { layoutGraph, type Point, type Size } from './layout'

const size: Size = { width: 260, height: 64 }
const ids = (n: number) => Array.from({ length: n }, (_, i) => `n${i}`)

/** A seed with `n - 1` children, two of which have a child each. */
const star = (n: number) => {
  const nodes = ids(n)
  const edges = nodes.slice(1).map((target) => ({ source: 'n0', target }))
  return { nodes, edges }
}

const apart = (a: Point, b: Point) =>
  Math.abs(a.x - b.x) >= size.width || Math.abs(a.y - b.y) >= size.height

function expectNoOverlap(positions: Map<string, Point>) {
  const all = [...positions.entries()]
  for (const [i, [idA, a]] of all.entries())
    for (const [idB, b] of all.slice(i + 1))
      expect(apart(a, b), `${idA} and ${idB} overlap`).toBe(true)
}

describe('layoutGraph', () => {
  it('places every node, layers left to right, and never overlaps two nodes', async () => {
    const { nodes, edges } = star(30)
    const positions = await layoutGraph(nodes, edges, size, new Map())
    expect([...positions.keys()].sort()).toEqual([...nodes].sort())
    const seed = positions.get('n0') as Point
    for (const id of nodes.slice(1))
      expect((positions.get(id) as Point).x).toBeGreaterThan(
        seed.x + size.width,
      )
    expectNoOverlap(positions)
  })

  it('keeps the exact position of every placed node when nodes are added', async () => {
    const small = star(8)
    const first = await layoutGraph(small.nodes, small.edges, size, new Map())
    const large = star(40)
    const second = await layoutGraph(large.nodes, large.edges, size, first)
    for (const [id, at] of first) expect(second.get(id)).toEqual(at)
    expect(second.size).toBe(40)
    expectNoOverlap(second)
  })

  it('keeps positions that elk would not have chosen', async () => {
    const { nodes, edges } = star(6)
    const pinned = new Map<string, Point>([
      ['n0', { x: 500, y: 900 }],
      ['n1', { x: 40, y: 10 }],
    ])
    const positions = await layoutGraph(nodes, edges, size, pinned)
    expect(positions.get('n0')).toEqual({ x: 500, y: 900 })
    expect(positions.get('n1')).toEqual({ x: 40, y: 10 })
    expectNoOverlap(positions)
  })

  it('moves a new node clear of a placed node it would land on', async () => {
    const pinned = new Map<string, Point>([['n1', { x: 0, y: 0 }]])
    const positions = await layoutGraph(['n0', 'n1'], [], size, pinned)
    expect(positions.get('n1')).toEqual({ x: 0, y: 0 })
    expectNoOverlap(positions)
  })

  it('gives the same layout for the same graph', async () => {
    const { nodes, edges } = star(25)
    const a = await layoutGraph(nodes, edges, size, new Map())
    const b = await layoutGraph(nodes, edges, size, new Map())
    expect([...a]).toEqual([...b])
  })

  it('ignores an edge to a node that is not there and an edge to itself', async () => {
    const positions = await layoutGraph(
      ['a', 'b'],
      [
        { source: 'a', target: 'missing' },
        { source: 'b', target: 'b' },
        { source: 'a', target: 'b' },
      ],
      size,
      new Map(),
    )
    expect([...positions.keys()].sort()).toEqual(['a', 'b'])
  })

  it('lays out nothing for no nodes', async () => {
    expect((await layoutGraph([], [], size, new Map())).size).toBe(0)
  })
})
