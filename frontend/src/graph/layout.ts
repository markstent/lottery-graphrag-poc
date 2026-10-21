/**
 * Layered left-to-right layout with elkjs.
 *
 * Two uses:
 * - A whole layout: every node is placed by elk and every edge keeps elk's
 *   orthogonal route. A replay of a recorded run uses this once, on the final
 *   graph, and then shows nodes and edges as their events arrive, so nothing
 *   ever moves.
 * - A growing layout (a live stream): a node that already has a position keeps
 *   it exactly, and only new nodes are placed. elk sees the placed positions
 *   and keeps to them (interactive layering, crossing and node placement), the
 *   placed nodes are pinned, and a new node that would overlap another is moved
 *   down to the next free slot. An edge whose two nodes ended where elk put
 *   them keeps elk's route; any other edge gets a plain three-segment route.
 *   When the stream ends the caller lays the final graph out whole.
 *
 * Tags: elk is given each edge's tag size so it leaves room for it, but the
 * tag is then placed here, on the longest stretch of the edge's own route that
 * no other edge shares, clear of every node and every other tag. A tag on a
 * shared vertical or horizontal run could belong to any of the edges on it.
 *
 * `priority` nodes (the evidence path, the seeds, what the ontology added) are
 * kept together at the top of their layers in a whole layout, by giving elk
 * its nodes and edges priority-first (`considerModelOrder`).
 *
 * elk runs in a web worker, so a large layout never blocks input. Vite
 * bundles the worker script from the `?worker` import with no configuration.
 */

import type { ELK, ElkExtendedEdge } from 'elkjs/lib/elk-api.js'

export interface Point {
  x: number
  y: number
}

export type Positions = ReadonlyMap<string, Point>

export interface LayoutNode {
  id: string
  width: number
}

export interface LayoutEdge {
  id: string
  source: string
  target: string
  /** The measured size of the edge's tag. */
  tag: { width: number; height: number }
}

/** An edge's path, the centre of its tag, and where the path came from. */
export interface Route {
  points: Point[]
  tag: Point
  /** `elk` for elk's own route, `plain` for the three-segment route. */
  kind: 'elk' | 'plain'
}

export interface Layout {
  positions: Map<string, Point>
  routes: Map<string, Route>
}

/** Space between neighbouring nodes in a layer. */
const NODE_GAP = 28
/** Space between layers, beyond what the tags on the edges between them need. */
const LAYER_GAP = 90
/** Space between parallel edge segments, and between an edge and a node. */
const EDGE_GAP = 14
const EDGE_NODE_GAP = 24
/** How far a node may sit from where elk put it and still use elk's route. */
const TOLERANCE = 0.5
/** A step in a route no taller than this is a kink, and is flattened. */
const KINK = 10
/** Space kept between a tag and its edge, a node or another tag. */
const TAG_GAP = 4

/** elk and its worker are large, so they load when the first layout needs them. */
let elk: Promise<ELK> | undefined
const loadElk = (): Promise<ELK> => {
  elk ??= Promise.all([
    import('elkjs/lib/elk-api.js'),
    import('elkjs/lib/elk-worker.min.js?worker'),
  ])
    .then(
      ([api, worker]) =>
        new api.default({ workerFactory: () => new worker.default() }),
    )
    .catch((error: unknown) => {
      // A failed load is tried again by the next layout.
      elk = undefined
      throw error
    })
  return elk
}

interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

const overlaps = (a: Box, b: Box): boolean =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

const near = (a: Point, b: Point): boolean =>
  Math.abs(a.x - b.x) <= TOLERANCE && Math.abs(a.y - b.y) <= TOLERANCE

/** Out of the right side of the source, down or up at the middle, into the left side of the target. */
function plainRoute(from: Point, to: Point): Point[] {
  const x = (from.x + to.x) / 2
  return [from, { x, y: from.y }, { x, y: to.y }, to]
}

const sameSpot = (a: Point, b: Point) => a.x === b.x && a.y === b.y

/**
 * `points` without repeated points or middle points of a straight run, and
 * with a kink (a short step between two parallel runs) flattened where an end
 * of the route does not pin it.
 */
export function tidyRoute(points: Point[]): Point[] {
  let route = dedupe(points)
  for (let again = true; again;) {
    again = false
    for (let i = 0; i + 3 < route.length; i += 1) {
      const [a, b, c, d] = route.slice(i, i + 4)
      const step = Math.abs(b.y - c.y)
      if (b.x !== c.x || step === 0 || step > KINK) continue
      if (i > 0 && a.y === b.y) {
        // Raise or lower the run before the step to the run after it.
        route[i] = { x: a.x, y: c.y }
        route[i + 1] = { x: b.x, y: c.y }
        again = true
      } else if (i + 3 < route.length - 1 && c.y === d.y) {
        // Or the run after it to the run before.
        route[i + 2] = { x: c.x, y: b.y }
        route[i + 3] = { x: d.x, y: b.y }
        again = true
      }
      if (again) break
    }
    route = straighten(dedupe(route))
  }
  return route
}

const dedupe = (points: Point[]): Point[] =>
  points.filter((p, i) => i === 0 || !sameSpot(p, points[i - 1]))

/** Without the middle point of a straight run. */
const straighten = (points: Point[]): Point[] =>
  points.filter((p, i) => {
    const before = points[i - 1]
    const after = points[i + 1]
    return (
      !before ||
      !after ||
      !(
        (before.x === p.x && p.x === after.x) ||
        (before.y === p.y && p.y === after.y)
      )
    )
  })

/** The horizontal runs of a route. */
function runs(points: Point[]) {
  return points.slice(1).flatMap((end, i) => {
    const start = points[i]
    return Math.abs(start.y - end.y) < 0.5
      ? [
          {
            y: start.y,
            left: Math.min(start.x, end.x),
            right: Math.max(start.x, end.x),
          },
        ]
      : []
  })
}

/**
 * Where each edge's tag goes: on a horizontal run of its own route that no
 * other edge shares if there is one (the longest first), below the line or
 * above it, in the first spot clear of nodes and of tags already placed.
 */
function placeTags(
  edges: { id: string; points: Point[]; tag: LayoutEdge['tag']; elk: Point }[],
  nodes: Box[],
): Map<string, Point> {
  const taken: Box[] = nodes.map((b) => ({
    left: b.left - 2,
    top: b.top - 2,
    right: b.right + 2,
    bottom: b.bottom + 2,
  }))
  const all = edges.map((e) => ({ id: e.id, runs: runs(e.points) }))
  const shared = (
    id: string,
    run: { y: number; left: number; right: number },
  ) =>
    all.some(
      (other) =>
        other.id !== id &&
        other.runs.some(
          (o) =>
            Math.abs(o.y - run.y) < 1 &&
            Math.min(o.right, run.right) - Math.max(o.left, run.left) > 4,
        ),
    )
  const placed = new Map<string, Point>()
  const boxAt = (x: number, y: number, tag: LayoutEdge['tag']): Box => ({
    left: x - tag.width / 2,
    right: x + tag.width / 2,
    top: y - tag.height / 2,
    bottom: y + tag.height / 2,
  })
  const free = (box: Box) => !taken.some((t) => overlaps(box, t))
  const take = (box: Box) =>
    taken.push({
      left: box.left - TAG_GAP,
      right: box.right + TAG_GAP,
      top: box.top - TAG_GAP,
      bottom: box.bottom + TAG_GAP,
    })
  for (const edge of edges) {
    const { tag } = edge
    const own = all.find((a) => a.id === edge.id)?.runs ?? []
    const byFit = (
      a: { y: number; left: number; right: number },
      b: typeof a,
    ) =>
      Number(shared(edge.id, a)) - Number(shared(edge.id, b)) ||
      b.right - b.left - (a.right - a.left)
    const long = own
      .filter((r) => r.right - r.left >= tag.width + 2 * TAG_GAP)
      .sort(byFit)
    let chosen: Point | undefined
    // On a run long enough to hold the tag, below the line or above it.
    for (const run of long) {
      const middle = (run.left + run.right) / 2
      const slack = (run.right - run.left - tag.width) / 2 - TAG_GAP
      for (const x of [middle, middle - slack / 2, middle + slack / 2]) {
        for (const side of [1, -1]) {
          const y = run.y + side * (tag.height / 2 + TAG_GAP)
          if (free(boxAt(x, y, tag))) chosen = { x, y }
          if (chosen) break
        }
        if (chosen) break
      }
      if (chosen) break
    }
    // Otherwise as near the middle of the longest run as there is room,
    // stepping up and down by whole tags until a spot is clear.
    if (!chosen) {
      const run = [...own].sort(byFit).at(0)
      const anchor = run
        ? { x: (run.left + run.right) / 2, y: run.y }
        : edge.points[0]
      for (let step = 1; step <= 60 && !chosen; step += 1) {
        const rows = Math.ceil(step / 2) * (step % 2 ? 1 : -1)
        const y = anchor.y + rows * (tag.height + TAG_GAP)
        if (free(boxAt(anchor.x, y, tag))) chosen = { x: anchor.x, y }
      }
    }
    const spot = chosen ?? edge.elk
    take(boxAt(spot.x, spot.y, tag))
    placed.set(edge.id, spot)
  }
  return placed
}

interface ElkResult {
  fromElk: Map<string, Point>
  edges: Map<string, ElkExtendedEdge>
}

async function runElk(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  height: number,
  hints: Positions,
  interactive: boolean,
): Promise<ElkResult> {
  const laidOut = await (
    await loadElk()
  ).layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.spacing.nodeNode': String(NODE_GAP),
      'elk.spacing.edgeEdge': String(EDGE_GAP),
      'elk.spacing.edgeNode': String(EDGE_NODE_GAP),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(LAYER_GAP),
      'elk.layered.spacing.edgeEdgeBetweenLayers': String(EDGE_GAP),
      'elk.layered.spacing.edgeNodeBetweenLayers': String(EDGE_NODE_GAP),
      'elk.edgeLabels.placement': 'CENTER',
      'elk.layered.edgeLabels.centerLabelPlacementStrategy': 'MEDIAN_LAYER',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.nodePlacement.strategy': interactive
        ? 'INTERACTIVE'
        : 'NETWORK_SIMPLEX',
      ...(interactive && {
        'elk.layered.layering.strategy': 'INTERACTIVE',
        'elk.layered.crossingMinimization.strategy': 'INTERACTIVE',
      }),
    },
    children: nodes.map(({ id, width }) => ({
      id,
      width,
      height,
      ...hints.get(id),
      layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
      // One port at the middle of each side, so every edge meets a node where
      // its arrow and its shape's outline are.
      ports: [
        {
          id: `${id}:out`,
          x: width,
          y: height / 2,
          width: 0,
          height: 0,
          layoutOptions: { 'elk.port.side': 'EAST' },
        },
        {
          id: `${id}:in`,
          x: 0,
          y: height / 2,
          width: 0,
          height: 0,
          layoutOptions: { 'elk.port.side': 'WEST' },
        },
      ],
    })),
    edges: edges.map((e): ElkExtendedEdge => ({
      id: e.id,
      sources: [`${e.source}:out`],
      targets: [`${e.target}:in`],
      labels: [{ text: e.id, ...e.tag }],
    })),
  })
  return {
    fromElk: new Map(
      (laidOut.children ?? []).map((c) => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }]),
    ),
    edges: new Map(
      (laidOut.edges ?? []).map((e) => [e.id, e as ElkExtendedEdge]),
    ),
  }
}

/**
 * Positions for `nodes` (the position in `placed` where there is one, else a
 * fresh one) and a route for each edge. Every node has the same `height`. An
 * edge with an end outside `nodes` is ignored. With nothing placed and some
 * `priority` nodes, the layout is a whole one that keeps them together.
 */
export async function layoutGraph(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  height: number,
  placed: Positions,
  priority: ReadonlySet<string> = new Set(),
): Promise<Layout> {
  const widths = new Map(nodes.map((n) => [n.id, n.width]))
  const usable = edges.filter(
    (e) =>
      e.source !== e.target && widths.has(e.source) && widths.has(e.target),
  )
  const growing = nodes.some((n) => placed.has(n.id))

  // elk keeps the order it is given where nothing else decides, so listing the
  // priority nodes (and the edges into them) first keeps them together.
  const first = <T>(items: T[], isFirst: (item: T) => boolean) => [
    ...items.filter(isFirst),
    ...items.filter((item) => !isFirst(item)),
  ]
  const result = await runElk(
    growing ? nodes : first(nodes, (n) => priority.has(n.id)),
    growing
      ? usable
      : first(usable, (e) => priority.has(e.source) || priority.has(e.target)),
    height,
    placed,
    growing,
  )
  const { fromElk } = result

  const positions = new Map<string, Point>()
  const fresh: { id: string; at: Point }[] = []
  for (const [id, at] of fromElk) {
    const kept = placed.get(id)
    if (kept) positions.set(id, kept)
    else fresh.push({ id, at })
  }
  // Nudge only the new nodes, left to right then top to bottom, so the
  // result does not depend on elk's output order. A whole layout needs none.
  fresh.sort((a, b) => a.at.x - b.at.x || a.at.y - b.at.y)
  const boxOf = (at: Point, id: string): Box => ({
    left: at.x - NODE_GAP / 2,
    top: at.y - NODE_GAP / 2,
    right: at.x + (widths.get(id) ?? 0) + NODE_GAP / 2,
    bottom: at.y + height + NODE_GAP / 2,
  })
  const clear = (point: Point, id: string) =>
    ![...positions].some(([other, at]) =>
      overlaps(boxOf(point, id), boxOf(at, other)),
    )
  for (const { id, at } of fresh) {
    const point = { ...at }
    while (!clear(point, id)) point.y += height + NODE_GAP
    positions.set(id, point)
  }

  const routes = new Map<string, Omit<Route, 'tag'>>()
  for (const edge of usable) {
    const source = positions.get(edge.source) as Point
    const target = positions.get(edge.target) as Point
    const section = result.edges.get(edge.id)?.sections?.[0]
    const unmoved =
      near(source, fromElk.get(edge.source) as Point) &&
      near(target, fromElk.get(edge.target) as Point)
    routes.set(
      edge.id,
      section && unmoved
        ? {
            points: tidyRoute([
              section.startPoint,
              ...(section.bendPoints ?? []),
              section.endPoint,
            ]),
            kind: 'elk',
          }
        : {
            points: plainRoute(
              {
                x: source.x + (widths.get(edge.source) ?? 0),
                y: source.y + height / 2,
              },
              { x: target.x, y: target.y + height / 2 },
            ),
            kind: 'plain',
          },
    )
  }
  const tags = placeTags(
    usable.map((e) => {
      const label = result.edges.get(e.id)?.labels?.[0]
      const points = (routes.get(e.id) as { points: Point[] }).points
      return {
        id: e.id,
        points,
        tag: e.tag,
        elk: {
          x: (label?.x ?? points[0].x) + (label?.width ?? 0) / 2,
          y: (label?.y ?? points[0].y) + (label?.height ?? 0) / 2,
        },
      }
    }),
    [...positions].map(([id, at]) => ({
      left: at.x,
      top: at.y,
      right: at.x + (widths.get(id) ?? 0),
      bottom: at.y + height,
    })),
  )
  return {
    positions,
    routes: new Map(
      [...routes].map(([id, route]) => [
        id,
        { ...route, tag: tags.get(id) as Point },
      ]),
    ),
  }
}
