/**
 * Where each edge's relationship tag goes so that no two tags overlap each
 * other or a node. An edge's tag sits on its curve; if the middle is taken
 * the tag slides along the curve, and an edge with no free spot goes
 * untagged. Evidence-path edges choose first, then the edges of the focused
 * node, then the rest in the order given, so the tags that matter are drawn.
 */

import type { Point, Size } from './layout'

export interface TaggedEdge {
  id: string
  source: string
  target: string
  text: string
  onPath: boolean
}

/**
 * Positions along the curve to try. The first is nearer the target than the
 * middle, where edges that fan out of one node have already come apart.
 */
const OFFSETS = [0.65, 0.5, 0.75, 0.4, 0.8, 0.3, 0.2]
/** Average glyph width as a share of the font size, with a little to spare. */
const GLYPH_WIDTH = 0.6
const TAG_PADDING = 14
const MARGIN = 3

/**
 * The point at `t` on the curve @xyflow/react draws between a source handle on
 * the right of one node and a target handle on the left of another.
 */
export function bezierPoint(from: Point, to: Point, t: number): Point {
  const reach = to.x - from.x
  const offset = reach >= 0 ? 0.5 * reach : 0.25 * 25 * Math.sqrt(-reach)
  const c1 = { x: from.x + offset, y: from.y }
  const c2 = { x: to.x - offset, y: to.y }
  const u = 1 - t
  const mix = (a: number, b: number, c: number, d: number) =>
    u ** 3 * a + 3 * u ** 2 * t * b + 3 * u * t ** 2 * c + t ** 3 * d
  return {
    x: mix(from.x, c1.x, c2.x, to.x),
    y: mix(from.y, c1.y, c2.y, to.y),
  }
}

interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

const overlaps = (a: Box, b: Box): boolean =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

/** The offset along the curve (0 to 1) of the tag of each edge that has a free spot. */
export function placeTags(
  edges: TaggedEdge[],
  positions: ReadonlyMap<string, Point>,
  size: Size,
  font: number,
  focused: string | undefined,
): Map<string, number> {
  const taken: Box[] = [...positions.values()].map((at) => ({
    left: at.x - MARGIN,
    top: at.y - MARGIN,
    right: at.x + size.width + MARGIN,
    bottom: at.y + size.height + MARGIN,
  }))
  const rank = (edge: TaggedEdge) =>
    edge.onPath ? 0 : edge.source === focused || edge.target === focused ? 1 : 2
  const ordered = [...edges].sort((a, b) => rank(a) - rank(b))
  const placed = new Map<string, number>()
  for (const edge of ordered) {
    const source = positions.get(edge.source)
    const target = positions.get(edge.target)
    if (!source || !target) continue
    const from = { x: source.x + size.width, y: source.y + size.height / 2 }
    const to = { x: target.x, y: target.y + size.height / 2 }
    const width = edge.text.length * font * GLYPH_WIDTH + TAG_PADDING
    const height = font * 1.5
    for (const t of OFFSETS) {
      const at = bezierPoint(from, to, t)
      const box = {
        left: at.x - width / 2 - MARGIN,
        right: at.x + width / 2 + MARGIN,
        top: at.y - height / 2 - MARGIN,
        bottom: at.y + height / 2 + MARGIN,
      }
      if (taken.some((other) => overlaps(box, other))) continue
      taken.push(box)
      placed.set(edge.id, t)
      break
    }
  }
  return placed
}
