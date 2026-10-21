import { describe, expect, it } from 'vitest'

import type { Point, Size } from './layout'
import { bezierPoint, placeTags, type TaggedEdge } from './label-placement'

const size: Size = { width: 260, height: 64 }
const font = 14

/** A source on the left with `n` targets in a column 500 px to its right. */
function fan(n: number, pitch: number, text = 'is related to version') {
  const positions = new Map<string, Point>([['s', { x: 0, y: 0 }]])
  const edges: TaggedEdge[] = []
  for (let i = 0; i < n; i += 1) {
    positions.set(`t${i}`, { x: 500, y: i * pitch })
    edges.push({
      id: `e${i}`,
      source: 's',
      target: `t${i}`,
      text,
      onPath: false,
    })
  }
  return { positions, edges }
}

/** The tag boxes the placement implies, for checking overlap. */
function boxes(
  tags: Map<string, number>,
  edges: TaggedEdge[],
  positions: Map<string, Point>,
) {
  return [...tags].map(([id, t]) => {
    const edge = edges.find((e) => e.id === id) as TaggedEdge
    const s = positions.get(edge.source) as Point
    const d = positions.get(edge.target) as Point
    const at = bezierPoint(
      { x: s.x + size.width, y: s.y + size.height / 2 },
      { x: d.x, y: d.y + size.height / 2 },
      t,
    )
    const width = edge.text.length * font * 0.6 + 14
    return {
      id,
      left: at.x - width / 2,
      right: at.x + width / 2,
      top: at.y - font * 0.75,
      bottom: at.y + font * 0.75,
    }
  })
}

describe('bezierPoint', () => {
  it('starts at the source handle and ends at the target handle', () => {
    const from = { x: 260, y: 32 }
    const to = { x: 500, y: 200 }
    expect(bezierPoint(from, to, 0)).toEqual(from)
    expect(bezierPoint(from, to, 1)).toEqual(to)
  })

  it('passes through the middle of a left-to-right curve at one half', () => {
    const at = bezierPoint({ x: 0, y: 0 }, { x: 400, y: 200 }, 0.5)
    expect(at.x).toBeCloseTo(200)
    expect(at.y).toBeCloseTo(100)
  })
})

describe('placeTags', () => {
  it('puts a lone tag nearer the target than the middle of its curve', () => {
    const { positions, edges } = fan(1, 100, 'affects')
    const at = placeTags(edges, positions, size, font, undefined).get('e0')
    expect(at).toBeGreaterThan(0.5)
    expect(at).toBeLessThan(1)
  })

  it('never lets two tags overlap, and leaves an edge untagged rather than overlap', () => {
    const { positions, edges } = fan(12, 40)
    const tags = placeTags(edges, positions, size, font, undefined)
    expect(tags.size).toBeGreaterThan(0)
    expect(tags.size).toBeLessThan(edges.length)
    const all = boxes(tags, edges, positions)
    for (const [i, a] of all.entries())
      for (const b of all.slice(i + 1))
        expect(
          a.left < b.right &&
            b.left < a.right &&
            a.top < b.bottom &&
            b.top < a.bottom,
          `${a.id} overlaps ${b.id}`,
        ).toBe(false)
  })

  it('slides a tag along its curve when the middle is taken', () => {
    const { positions, edges } = fan(3, 24, 'affects')
    const tags = placeTags(edges, positions, size, font, undefined)
    expect(new Set(tags.values()).size).toBeGreaterThan(1)
  })

  it('never puts a tag on a node', () => {
    const { positions, edges } = fan(6, 70)
    positions.set('wall', { x: 270, y: 0 })
    const tags = placeTags(edges, positions, size, font, undefined)
    for (const b of boxes(tags, edges, positions)) {
      const wall = { left: 270, right: 530, top: 0, bottom: 64 }
      expect(
        b.left < wall.right &&
          wall.left < b.right &&
          b.top < wall.bottom &&
          wall.top < b.bottom,
      ).toBe(false)
    }
  })

  it('tags evidence-path edges first, then the focused node, then the rest', () => {
    const { positions, edges } = fan(12, 40)
    edges[11].onPath = true
    const tags = placeTags(edges, positions, size, font, undefined)
    expect(tags.has('e11')).toBe(true)
    const focused = placeTags(edges, positions, size, font, 't7')
    expect(focused.has('e7')).toBe(true)
    expect(focused.has('e11')).toBe(true)
  })

  it('skips an edge with an end that has no position', () => {
    const { positions, edges } = fan(1, 100)
    positions.delete('t0')
    expect(placeTags(edges, positions, size, font, undefined).size).toBe(0)
  })
})
