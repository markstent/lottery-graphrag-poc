/**
 * Layered left-to-right layout with elkjs, kept stable as the graph grows:
 * a node that already has a position keeps it exactly, and only new nodes are
 * placed. elk sees the placed positions and keeps to them (interactive
 * layering, crossing and node placement), then the placed nodes are pinned
 * and any new node that would overlap another is moved down to the next free
 * slot.
 *
 * elk also routes the edges, orthogonally, and places their tags: each tag is
 * given its measured size and elk leaves room for it on the edge. An edge
 * whose two nodes ended where elk put them uses elk's route and tag position.
 * An edge with an end that was pinned or nudged elsewhere gets a plain
 * three-segment route and a tag at its middle instead, since elk's route no
 * longer meets its nodes.
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

/** An edge's path, and the centre of its tag. */
export interface Route {
  points: Point[]
  tag: Point
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

/** elk and its worker are large, so they load when the first layout needs them. */
let elk: Promise<ELK> | undefined
const loadElk = (): Promise<ELK> =>
  (elk ??= Promise.all([
    import('elkjs/lib/elk-api.js'),
    import('elkjs/lib/elk-worker.min.js?worker'),
  ]).then(
    ([api, worker]) =>
      new api.default({ workerFactory: () => new worker.default() }),
  ))

const overlaps = (
  a: Point,
  wa: number,
  b: Point,
  wb: number,
  height: number,
): boolean =>
  a.x < b.x + wb + NODE_GAP / 2 &&
  b.x < a.x + wa + NODE_GAP / 2 &&
  Math.abs(a.y - b.y) < height + NODE_GAP / 2

const near = (a: Point, b: Point): boolean =>
  Math.abs(a.x - b.x) <= TOLERANCE && Math.abs(a.y - b.y) <= TOLERANCE

/** Out of the right side of the source, down or up at the middle, into the left side of the target. */
function plainRoute(from: Point, to: Point): Route {
  const x = (from.x + to.x) / 2
  return {
    points: [from, { x, y: from.y }, { x, y: to.y }, to],
    tag: { x, y: (from.y + to.y) / 2 },
  }
}

/**
 * Positions for `nodes` (the position in `placed` where there is one, else a
 * fresh one) and a route for each edge. Every node has the same `height`. An
 * edge with an end outside `nodes` is ignored.
 */
export async function layoutGraph(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  height: number,
  placed: Positions,
): Promise<Layout> {
  const widths = new Map(nodes.map((n) => [n.id, n.width]))
  const usable = edges.filter(
    (e) =>
      e.source !== e.target && widths.has(e.source) && widths.has(e.target),
  )
  const interactive = nodes.some((n) => placed.has(n.id))
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
      ...(!interactive && {
        'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      }),
      ...(interactive && {
        'elk.layered.layering.strategy': 'INTERACTIVE',
        'elk.layered.crossingMinimization.strategy': 'INTERACTIVE',
        'elk.layered.nodePlacement.strategy': 'INTERACTIVE',
      }),
    },
    children: nodes.map(({ id, width }) => ({
      id,
      width,
      height,
      ...placed.get(id),
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
    edges: usable.map((e): ElkExtendedEdge => ({
      id: e.id,
      sources: [`${e.source}:out`],
      targets: [`${e.target}:in`],
      labels: [{ text: e.id, ...e.tag }],
    })),
  })

  const positions = new Map<string, Point>()
  const fromElk = new Map<string, Point>()
  const fresh: { id: string; at: Point }[] = []
  for (const child of laidOut.children ?? []) {
    const at = { x: child.x ?? 0, y: child.y ?? 0 }
    fromElk.set(child.id, at)
    const kept = placed.get(child.id)
    if (kept) positions.set(child.id, kept)
    else fresh.push({ id: child.id, at })
  }
  // Nudge only the new nodes, left to right then top to bottom, so the
  // result does not depend on elk's output order.
  fresh.sort((a, b) => a.at.x - b.at.x || a.at.y - b.at.y)
  const clear = (point: Point, width: number) =>
    ![...positions].some(([id, other]) =>
      overlaps(point, width, other, widths.get(id) ?? 0, height),
    )
  for (const { id, at } of fresh) {
    const point = { ...at }
    const width = widths.get(id) ?? 0
    while (!clear(point, width)) point.y += height + NODE_GAP
    positions.set(id, point)
  }

  const routes = new Map<string, Route>()
  const elkEdges = new Map(
    (laidOut.edges ?? []).map((e) => [e.id, e as ElkExtendedEdge]),
  )
  for (const edge of usable) {
    const source = positions.get(edge.source) as Point
    const target = positions.get(edge.target) as Point
    const elkEdge = elkEdges.get(edge.id)
    const section = elkEdge?.sections?.[0]
    const label = elkEdge?.labels?.[0]
    const unmoved =
      near(source, fromElk.get(edge.source) as Point) &&
      near(target, fromElk.get(edge.target) as Point)
    if (section && label && unmoved) {
      routes.set(edge.id, {
        points: [
          section.startPoint,
          ...(section.bendPoints ?? []),
          section.endPoint,
        ],
        tag: {
          x: (label.x ?? 0) + (label.width ?? 0) / 2,
          y: (label.y ?? 0) + (label.height ?? 0) / 2,
        },
      })
    } else {
      routes.set(
        edge.id,
        plainRoute(
          {
            x: source.x + (widths.get(edge.source) ?? 0),
            y: source.y + height / 2,
          },
          { x: target.x, y: target.y + height / 2 },
        ),
      )
    }
  }
  return { positions, routes }
}
