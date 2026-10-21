/**
 * Layered left-to-right layout with elkjs, kept stable as the graph grows:
 * a node that already has a position keeps it exactly, and only new nodes are
 * placed. elk sees the placed positions so new nodes land beside their
 * neighbours, then the placed nodes are pinned and any new node that would
 * overlap another is moved down to the next free slot.
 *
 * elk runs in a web worker, so a large layout never blocks input. Vite
 * bundles the worker script from the `?worker` import with no configuration;
 * the layout of 200 nodes takes about 170 ms there (e2e/graph-canvas-200.spec.ts).
 */

import type { ELK } from 'elkjs/lib/elk-api.js'

export interface Size {
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

export type Positions = ReadonlyMap<string, Point>

export interface LayoutEdge {
  source: string
  target: string
}

/** Space between neighbouring nodes in a layer, and between layers (room for an edge label). */
const NODE_GAP = 24
const LAYER_GAP = 270

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

const overlaps = (a: Point, b: Point, size: Size): boolean =>
  Math.abs(a.x - b.x) < size.width + NODE_GAP / 2 &&
  Math.abs(a.y - b.y) < size.height + NODE_GAP / 2

/**
 * Positions for `ids`: the position in `placed` where there is one, else a
 * fresh one from elk. Every node has the same `size`. An edge with an end
 * outside `ids` is ignored.
 */
export async function layoutGraph(
  ids: string[],
  edges: LayoutEdge[],
  size: Size,
  placed: Positions,
): Promise<Map<string, Point>> {
  const known = new Set(ids)
  const interactive = ids.some((id) => placed.has(id))
  const laidOut = await (
    await loadElk()
  ).layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.spacing.nodeNode': String(NODE_GAP),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(LAYER_GAP),
      'elk.layered.spacing.edgeNodeBetweenLayers': '24',
      ...(interactive && {
        'elk.layered.layering.strategy': 'INTERACTIVE',
        'elk.layered.crossingMinimization.strategy': 'INTERACTIVE',
      }),
    },
    children: ids.map((id) => ({
      id,
      ...size,
      ...placed.get(id),
    })),
    edges: edges
      .filter(
        (e) =>
          e.source !== e.target && known.has(e.source) && known.has(e.target),
      )
      .map((e, i) => ({
        id: `e${i}`,
        sources: [e.source],
        targets: [e.target],
      })),
  })

  const positions = new Map<string, Point>()
  const fresh: { id: string; at: Point }[] = []
  for (const child of laidOut.children ?? []) {
    const at = { x: child.x ?? 0, y: child.y ?? 0 }
    const kept = placed.get(child.id)
    if (kept) positions.set(child.id, kept)
    else fresh.push({ id: child.id, at })
  }
  // Nudge only the new nodes, left to right then top to bottom, so the
  // result does not depend on elk's output order.
  fresh.sort((a, b) => a.at.x - b.at.x || a.at.y - b.at.y)
  for (const { id, at } of fresh) {
    const point = { ...at }
    while (
      [...positions.values()].some((other) => overlaps(point, other, size))
    )
      point.y += size.height + NODE_GAP
    positions.set(id, point)
  }
  return positions
}
