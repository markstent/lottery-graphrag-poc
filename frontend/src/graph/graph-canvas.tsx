/**
 * The graph canvas: draws exactly the `GraphView` it is given, which the
 * caller builds from the events recorded up to the replay cursor, so the
 * picture grows only as recorded events arrive. Nodes are DOM buttons laid
 * out by elk (layout.ts) and drawn by @xyflow/react; the nodes the cap folded
 * away show as one group node each.
 *
 * Keyboard: Tab enters the canvas at one node, the arrow keys move along
 * edges, Enter opens the node, `+` `-` and `0` zoom and fit, Escape moves
 * focus on past the canvas.
 *
 * Edges are routed orthogonally by elk and carry a tag (layout.ts). Evidence
 * paths and selected evidence are drawn in the strong tone of the pipeline the
 * canvas shows; in C, what the ontology added is tinted in C's colour, badged
 * and dotted.
 *
 * Two modes. In `replay` every event is known: the final graph is laid out
 * once, and nodes and edges appear at their final places and with their elk
 * routes as their events arrive, so nothing moves. In `live` the graph grows
 * with the stream: new nodes are placed beside the old ones, which keep their
 * positions, and when the stream is `settled` the final graph is laid out
 * whole (no motion under reduced motion).
 */

import '@xyflow/react/dist/style.css'

import {
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  useUpdateNodeInternals,
  useViewport,
  type Node,
} from '@xyflow/react'
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'

import { Maximize, ZoomIn, ZoomOut, type LucideIcon } from 'lucide-react'

import type { EvidenceState } from '../design/evidence-states'
import { pipeline, type PipelineId } from '../design/pipelines'
import { relationshipPhrase } from '../design/relationships'
import {
  ArrowDefinitions,
  RelationshipEdge,
  type RelationshipFlowEdge,
} from './edge'
import { GraphSummary } from './graph-summary'
import { layoutGraph, type Layout, type Positions } from './layout'
import { withClustersOf, type GraphView } from './model'
import {
  ClusterNode,
  EntityNode,
  type EntityNodeData,
  type GraphFlowNode,
} from './node'
import { nextAfter, outOfView, outOfViewNote } from './view-bounds'
import {
  groupWidth,
  nodeWidth,
  PRESENTATION_TYPE_SIZE,
  TYPE_SIZE,
  type NodeSize,
} from './node-size'

/** Space left around the framed nodes, in px. */
const FIT_MARGIN = 32

/** The ontology pipeline's colours, for what it added. */
const ONTOLOGY = (({ hue, tint, strong }) => ({ hue, tint, strong }))(
  pipeline('C'),
)

const nodeTypes = { entity: EntityNode, cluster: ClusterNode }
const edgeTypes = { relationship: RelationshipEdge }

interface CommonProps {
  view: GraphView
  /** Called with a node id, or a group id for a group node. */
  onSelectNode: (id: string) => void
  /** Dim everything off the evidence path to 25 percent. */
  focusMode: boolean
  /** Larger type and nodes for a presentation screen. */
  presentation: boolean
  /** No motion: nodes appear and move at once. */
  reducedMotion: boolean
  /** The pipeline the view belongs to; sets the colour of evidence paths. */
  pipeline: Exclude<PipelineId, 'A'>
  /** The accessible name of the canvas. */
  label?: string
  /** The id of the evidence-path list, which the canvas is described by with its summary. */
  pathListId?: string
}

export type GraphCanvasProps = CommonProps &
  (
    | {
        /** A recorded run: every event is known, so the final graph sets the layout. */
        mode: 'replay'
        /** The view at the end of the run. */
        finalView: GraphView
      }
    | {
        /** A stream: the graph grows with it. */
        mode: 'live'
        /** True once the stream has ended; the final graph is then laid out whole. */
        settled?: boolean
      }
  )

interface Placed {
  /** The id of the node's place: its own, a group's, or the group a lone member stands in for. */
  id: string
  /** The id of the node the place draws: `id` unless a lone member stands in for a group. */
  nodeId: string
  kind: 'entity' | 'cluster'
  state: EvidenceState
  onPath: boolean
  added: boolean
}

interface VisibleEdge {
  id: string
  source: string
  target: string
  phrases: Set<string>
  count: number
  onPath: boolean
  added: boolean
  state: EvidenceState
}

/** What the canvas draws: the nodes the cap left standing and one node per group. */
function visibleGraph(view: GraphView) {
  const clusters = new Map(view.clusters.map((c) => [c.id, c]))
  const nodes: Placed[] = []
  const seenClusters = new Set<string>()
  for (const node of view.nodes) {
    if (node.clusterId === undefined) {
      nodes.push({
        id: node.slot ?? node.id,
        nodeId: node.id,
        kind: 'entity',
        state: node.state,
        onPath: node.onPath,
        added: node.addedByOntology,
      })
    } else if (!seenClusters.has(node.clusterId)) {
      seenClusters.add(node.clusterId)
      nodes.push({
        id: node.clusterId,
        nodeId: node.clusterId,
        kind: 'cluster',
        state: 'traversed',
        onPath: false,
        added: false,
      })
    }
  }
  const clusterOf = new Map(
    view.nodes.map((n) => [n.id, n.clusterId ?? n.slot]),
  )
  const represent = (id: string) => clusterOf.get(id) ?? id
  const added = new Map(view.nodes.map((n) => [n.id, n.addedByOntology]))

  const edges = new Map<string, VisibleEdge>()
  for (const edge of view.edges) {
    const source = represent(edge.source)
    const target = represent(edge.target)
    if (source === target) continue
    const key = `${source}>${target}`
    const folded = edges.get(key) ?? {
      id: key,
      source,
      target,
      phrases: new Set<string>(),
      count: 0,
      onPath: false,
      added: false,
      state: clusters.has(target) ? ('traversed' as const) : edge.state,
    }
    folded.phrases.add(relationshipPhrase(edge.relationship))
    folded.count += 1
    folded.onPath ||= edge.onPath
    folded.added ||= !!(added.get(edge.source) || added.get(edge.target))
    edges.set(key, folded)
  }
  return { nodes, edges: [...edges.values()] }
}

/** An edge's tag: its relationships in plain words, and how many edges it stands for. */
const tagText = (edge: { phrases: Set<string>; count: number }): string =>
  `${[...edge.phrases].join(', ')}${edge.count > 1 ? ` ×${edge.count}` : ''}`

/** The size of an edge's tag, estimated from its text. */
const tagSize = (text: string, font: number) => ({
  width: Math.ceil(text.length * font * 0.6 + 14),
  height: Math.ceil(font * 1.5 + 4),
})

/** The connected node best in line with an arrow key, or null if none lies that way. */
function neighbourToward(
  key: string,
  from: string,
  linked: Map<string, Set<string>>,
  positions: Positions,
): string | null {
  const here = positions.get(from)
  if (!here) return null
  const direction = {
    ArrowRight: [1, 0],
    ArrowLeft: [-1, 0],
    ArrowDown: [0, 1],
    ArrowUp: [0, -1],
  }[key]
  if (!direction) return null
  let best: { id: string; score: number } | null = null
  for (const id of linked.get(from) ?? []) {
    const there = positions.get(id)
    if (!there) continue
    const dx = there.x - here.x
    const dy = there.y - here.y
    const length = Math.hypot(dx, dy) || 1
    const alignment = (dx * direction[0] + dy * direction[1]) / length
    if (alignment > 0 && (!best || alignment > best.score))
      best = { id, score: alignment }
  }
  return best?.id ?? null
}

const TABBABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Moves focus to the first tabbable element after `container`, or off the page. */
function leave(container: HTMLElement): void {
  const after = [...document.querySelectorAll<HTMLElement>(TABBABLE)].filter(
    (el) =>
      !container.contains(el) &&
      container.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING,
  )
  if (after.length > 0) after[0].focus()
  else (document.activeElement as HTMLElement | null)?.blur()
}

/** One layout to run: what to lay out, and whether from scratch. */
interface Job {
  nodes: { id: string; width: number }[]
  edges: {
    id: string
    source: string
    target: string
    tag: { width: number; height: number }
  }[]
  height: number
  priority: Set<string>
  whole: boolean
  /** The `structure` this job lays out. */
  structure: string
}

function ToolButton({
  name,
  icon: Icon,
  onClick,
}: {
  name: string
  icon: LucideIcon
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={name}
      title={name}
      className="grid size-8 place-items-center rounded-chip border border-border bg-surface text-text-primary"
      onClick={onClick}
    >
      <Icon aria-hidden="true" size={18} />
    </button>
  )
}

function Canvas(props: GraphCanvasProps) {
  const {
    view,
    onSelectNode,
    focusMode,
    presentation,
    reducedMotion,
    pipeline: pipelineId,
    label = 'Evidence graph',
    pathListId,
  } = props
  const replay = props.mode === 'replay'
  const settled = props.mode === 'live' && props.settled === true
  const summaryId = useId()
  const type = presentation ? PRESENTATION_TYPE_SIZE : TYPE_SIZE
  const strong = pipeline(pipelineId).strong
  const arrows = `arrow-${useId().replaceAll(':', '')}`
  const flow = useReactFlow()
  const container = useRef<HTMLDivElement>(null)
  // The drawing area alone: the toolbar above it is not part of it.
  const drawing = useRef<HTMLDivElement>(null)
  const autoFit = useRef(true)

  // What is laid out: the final graph of a replay, or the graph so far.
  const layoutView = props.mode === 'replay' ? props.finalView : view
  // What is drawn: a replay's graph so far, grouped as the final graph is.
  const finalView = props.mode === 'replay' ? props.finalView : undefined
  const shown = useMemo(
    () => (finalView ? withClustersOf(view, finalView) : view),
    [view, finalView],
  )
  const forLayout = useMemo(() => visibleGraph(layoutView), [layoutView])
  const visible = useMemo(() => visibleGraph(shown), [shown])
  const byId = useMemo(
    () => new Map(shown.nodes.map((n) => [n.id, n])),
    [shown],
  )
  const clusterById = useMemo(
    () => new Map(shown.clusters.map((c) => [c.id, c])),
    [shown],
  )
  const ids = useMemo(() => forLayout.nodes.map((n) => n.id), [forLayout])
  const widths = useMemo(() => {
    const nodeOf = new Map(layoutView.nodes.map((n) => [n.id, n]))
    const groupOf = new Map(layoutView.clusters.map((c) => [c.id, c]))
    return new Map(
      forLayout.nodes.map((v) => {
        const node = nodeOf.get(v.id)
        const group = groupOf.get(v.id)
        // A group's place is also where a lone member is drawn while the rest
        // have not arrived, so it holds the widest of them.
        const widest = group
          ? Math.max(
              groupWidth(group, type),
              ...group.members.map((id) => {
                const member = nodeOf.get(id)
                return member ? nodeWidth(member, type) : 0
              }),
            )
          : 0
        return [v.id, node ? nodeWidth(node, type) : widest]
      }),
    )
  }, [forLayout, layoutView, type])
  const linked = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const edge of visible.edges) {
      map.set(edge.source, (map.get(edge.source) ?? new Set()).add(edge.target))
      map.set(edge.target, (map.get(edge.target) ?? new Set()).add(edge.source))
    }
    return map
  }, [visible])

  const [layout, setLayout] = useState<Layout>({
    positions: new Map(),
    routes: new Map(),
  })
  const { positions, routes } = layout
  const placed = useRef<Positions>(new Map())
  const [failure, setFailure] = useState<string | null>(null)
  const [laidOut, setLaidOut] = useState(false)
  // The structure the placed layout was made for.
  const [laidFor, setLaidFor] = useState('')

  // The layout reruns when the nodes, their widths, the edges, their tags, the
  // type size or the mode change, not when the view is rebuilt with the same
  // shape. Only the latest pending layout runs; one in flight finishes first.
  const laidTags = forLayout.edges.map((e) => ({ ...e, text: tagText(e) }))
  const structure = `${replay}|${settled}|${type.font}|${ids.map((id) => `${id}:${widths.get(id)}`).join(',')}|${laidTags.map((e) => `${e.id}:${e.text}`).join(',')}`
  const latest = useRef<Job>(null)
  useEffect(() => {
    latest.current = {
      nodes: ids.map((id) => ({ id, width: widths.get(id) ?? type.minWidth })),
      edges: laidTags.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        tag: tagSize(e.text, type.font),
      })),
      height: type.height,
      // The seeds are kept together at the top in every whole layout. The
      // evidence path and what the ontology added are kept together too,
      // except in a replay: its layout is made before the path is recorded
      // and must not show where the path will be.
      priority: new Set(
        forLayout.nodes
          .filter(
            (n) =>
              n.state === 'seed' ||
              (!replay && (n.onPath || (pipelineId === 'C' && n.added))),
          )
          .map((n) => n.id),
      ),
      // A replay and a settled stream are laid out whole.
      whole: replay || settled,
      structure,
    }
  })
  const pending = useRef<Job | null>(null)
  const busy = useRef(false)
  const alive = useRef(true)
  const lastSize = useRef(type.font)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  useEffect(() => {
    const job = latest.current
    if (!job) return
    // A change of type size starts the layout afresh.
    if (lastSize.current !== type.font) {
      lastSize.current = type.font
      placed.current = new Map()
    }
    pending.current = job
    if (busy.current) return
    busy.current = true
    void (async () => {
      try {
        while (pending.current) {
          const next = pending.current
          pending.current = null
          const kept = next.whole
            ? new Map()
            : new Map(
                [...placed.current].filter(([id]) =>
                  next.nodes.some((n) => n.id === id),
                ),
              )
          const result = await layoutGraph(
            next.nodes,
            next.edges,
            next.height,
            kept,
            next.whole ? next.priority : undefined,
          )
          // A newer layout is waiting: this one is stale.
          if (pending.current || !alive.current) continue
          placed.current = result.positions
          setLayout(result)
          setLaidFor(next.structure)
          setFailure(null)
          setLaidOut(true)
        }
      } catch (error: unknown) {
        if (alive.current)
          setFailure(error instanceof Error ? error.message : String(error))
      } finally {
        busy.current = false
      }
    })()
  }, [structure, type.font])

  const duration = reducedMotion ? 0 : 240
  // Fit frames what matters: the evidence path, every seed and, on C, what the
  // ontology added; until a path is recorded, every node. It never zooms out far
  // enough to take the type below `type.minPx` on screen, so a framed set that
  // is taller than the screen is framed from its start (the first node of the
  // path, else the first seed) and the rest is reached by panning or by
  // zooming out. The framed set sits against the left edge so the graph it
  // leads into shows beside it.
  const framedIds = useMemo(() => {
    // Until a path is recorded the graph is still growing: frame all of it.
    const important =
      shown.path.length > 0
        ? visible.nodes.filter(
            (n) =>
              n.onPath || n.state === 'seed' || (pipelineId === 'C' && n.added),
          )
        : visible.nodes
    return important.map((n) => n.id)
  }, [visible, shown.path, pipelineId])
  const startId =
    shown.path[0] ?? visible.nodes.find((n) => n.state === 'seed')?.id
  const fit = useCallback((): Promise<unknown> => {
    const box = drawing.current?.getBoundingClientRect()
    const framed = framedIds.flatMap((id) => {
      const at = positions.get(id)
      return at ? [{ at, width: widths.get(id) ?? type.minWidth }] : []
    })
    if (!box || framed.length === 0) return Promise.resolve()
    const left = Math.min(...framed.map((n) => n.at.x))
    const right = Math.max(...framed.map((n) => n.at.x + n.width))
    const top = Math.min(...framed.map((n) => n.at.y))
    const bottom = Math.max(...framed.map((n) => n.at.y + type.height))
    const room = {
      width: box.width - 2 * FIT_MARGIN,
      height: box.height - 2 * FIT_MARGIN,
    }
    const zoom = Math.max(
      Math.min(1, room.width / (right - left), room.height / (bottom - top)),
      type.minPx / type.font,
    )
    const start = startId ? positions.get(startId) : undefined
    const middle =
      (bottom - top) * zoom <= room.height || !start
        ? (top + bottom) / 2
        : start.y + type.height / 2
    return flow.setViewport(
      {
        x: FIT_MARGIN - left * zoom,
        y: box.height / 2 - middle * zoom,
        zoom,
      },
      { duration },
    )
  }, [flow, duration, framedIds, positions, widths, type, startId])
  // The layout the viewport was last settled for: the canvas is ready (for the
  // end-to-end specs and for anything waiting on it) once the layout is placed
  // and the fit has been applied.
  const [settledFor, setSettledFor] = useState<Layout | null>(null)
  useEffect(() => {
    if (!laidOut) return
    if (!autoFit.current) {
      setSettledFor(layout)
      return
    }
    const frame = requestAnimationFrame(() => {
      void fit().then(() => setSettledFor(layout))
    })
    return () => cancelAnimationFrame(frame)
  }, [layout, laidOut, fit])
  const ready = laidOut && laidFor === structure && settledFor === layout

  const [activeId, setActiveId] = useState<string | null>(null)
  const active =
    activeId !== null && visible.nodes.some((n) => n.id === activeId)
      ? activeId
      : (visible.nodes.find((n) => n.onPath) ?? visible.nodes[0])?.id

  // Evidence the viewport does not wholly show. The fit keeps the type
  // legible, so it can leave some off screen; the strip above the drawing says
  // so and steps through them.
  const viewport = useViewport()
  const frameWidth = useStore((state) => state.width)
  const frameHeight = useStore((state) => state.height)
  const hidden = useMemo(() => {
    if (!laidOut) return []
    const onPath = new Set(shown.path)
    return outOfView(
      visible.nodes.flatMap((v) => {
        const at = positions.get(v.id)
        return at && onPath.has(v.nodeId)
          ? [
              {
                id: v.id,
                x: at.x,
                y: at.y,
                width: widths.get(v.id) ?? type.minWidth,
                height: type.height,
              },
            ]
          : []
      }),
      viewport,
      { width: frameWidth, height: frameHeight },
    )
  }, [
    laidOut,
    shown.path,
    visible,
    positions,
    widths,
    type,
    viewport,
    frameWidth,
    frameHeight,
  ])
  const lastShown = useRef<string | null>(null)
  const showNextHidden = () => {
    const next = nextAfter(hidden, lastShown.current)
    if (!next) return
    lastShown.current = next
    focusNode(next)
  }

  // Rebuilt only when what they draw changes: the library keeps what it has
  // measured of a node while the node object is the one it was given, and
  // this component renders for reasons that do not touch the drawing.
  const nodes = useMemo(
    (): GraphFlowNode[] =>
      visible.nodes.flatMap((v): GraphFlowNode[] => {
        const at = positions.get(v.id)
        const node = byId.get(v.nodeId)
        const cluster = clusterById.get(v.id)
        if (!at) return []
        const size: NodeSize = {
          width: widths.get(v.id) ?? type.minWidth,
          height: type.height,
          font: type.font,
        }
        const common = {
          id: v.id,
          position: at,
          initialWidth: size.width,
          initialHeight: size.height,
          style: {
            transition: reducedMotion ? 'none' : 'transform 240ms ease-out',
          },
          data: {
            size,
            strong,
            ontology: ONTOLOGY,
            dimmed: focusMode && !v.onPath,
            active: v.id === active,
            reducedMotion,
            onFocusNode: setActiveId,
          },
        }
        if (v.kind === 'entity' && node)
          return [{ ...common, type: 'entity', data: { ...common.data, node } }]
        if (cluster)
          return [
            { ...common, type: 'cluster', data: { ...common.data, cluster } },
          ]
        return []
      }),
    [
      visible,
      positions,
      byId,
      clusterById,
      widths,
      type,
      strong,
      focusMode,
      active,
      reducedMotion,
    ],
  )

  // The library draws an edge once it has measured both its nodes' handles. A
  // run of fast changes can leave it with none measured and no size change to
  // prompt it again, so the nodes are measured again whenever they change.
  const updateNodeInternals = useUpdateNodeInternals()
  useEffect(() => {
    if (nodes.length > 0) updateNodeInternals(nodes.map((n) => n.id))
  }, [nodes, updateNodeInternals])

  const edges = useMemo(
    (): RelationshipFlowEdge[] =>
      visible.edges.flatMap((edge) => {
        const route = routes.get(edge.id)
        return route
          ? [
              {
                id: edge.id,
                source: edge.source,
                target: edge.target,
                type: 'relationship' as const,
                focusable: false,
                selectable: false,
                data: {
                  label: tagText(edge),
                  state: edge.state,
                  onPath: edge.onPath,
                  addedByOntology: edge.added,
                  dimmed: focusMode && !edge.onPath,
                  points: route.points,
                  tag: route.tag,
                  route: route.kind,
                  font: type.font,
                  strong,
                  ontology: ONTOLOGY,
                  arrows,
                },
              },
            ]
          : []
      }),
    [visible, routes, focusMode, type, strong, arrows],
  )

  const focusNode = (id: string) => {
    setActiveId(id)
    drawing.current
      ?.querySelector<HTMLElement>(
        `.react-flow__node[data-id="${CSS.escape(id)}"] button`,
      )
      ?.focus({ preventScroll: true })
    const at = positions.get(id)
    const width = widths.get(id) ?? type.minWidth
    const box = drawing.current?.getBoundingClientRect()
    if (!at || !box) return
    const { x, y, zoom } = flow.getViewport()
    const left = at.x * zoom + x
    const top = at.y * zoom + y
    const margin = 24
    const inside =
      left >= margin &&
      top >= margin &&
      left + width * zoom <= box.width - margin &&
      top + type.height * zoom <= box.height - margin
    if (!inside)
      void flow.setCenter(at.x + width / 2, at.y + type.height / 2, {
        zoom,
        duration,
      })
  }

  const zoomIn = () => {
    autoFit.current = false
    void flow.zoomIn({ duration })
  }
  const zoomOut = () => {
    autoFit.current = false
    void flow.zoomOut({ duration })
  }
  // The fit button and the 0 key: the canvas's own fit, which keeps the type
  // legible, not the library's, which would zoom out as far as it can.
  const refit = () => {
    autoFit.current = true
    void fit()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const { key } = event
    if (key === 'Escape') {
      if (container.current) leave(container.current)
    } else if (key === '+' || key === '=') zoomIn()
    else if (key === '-') zoomOut()
    else if (key === '0') refit()
    else if (key.startsWith('Arrow') && active) {
      const next = neighbourToward(key, active, linked, positions)
      if (next) focusNode(next)
    } else return
    event.preventDefault()
  }

  if (view.nodes.length === 0) {
    return (
      <p className="rounded-card border border-dashed border-border p-6 text-center text-sm text-text-muted">
        No graph activity has been recorded yet.
      </p>
    )
  }

  return (
    <div
      ref={container}
      role="group"
      aria-label={label}
      aria-describedby={pathListId ? `${summaryId} ${pathListId}` : summaryId}
      aria-busy={!laidOut && failure === null}
      data-layout-ready={ready ? 'true' : 'false'}
      className="flex h-full min-h-64 w-full flex-col rounded-card border border-border bg-surface"
      onKeyDown={onKeyDown}
    >
      <div ref={drawing} className="relative min-h-0 flex-1">
        <ArrowDefinitions
          prefix={arrows}
          pathColor={strong}
          ontologyColor={ONTOLOGY.hue}
        />
        <ReactFlow<Node, RelationshipFlowEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          style={{ position: 'absolute', inset: 0 }}
          nodesDraggable={false}
          nodesConnectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          elementsSelectable={false}
          disableKeyboardA11y
          deleteKeyCode={null}
          selectionKeyCode={null}
          minZoom={0.1}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          onNodeClick={(_, node) =>
            onSelectNode(
              node.type === 'entity'
                ? (node.data as EntityNodeData).node.id
                : node.id,
            )
          }
          onMoveStart={(event) => {
            if (event) autoFit.current = false
          }}
        />
        {failure !== null ? (
          <p
            role="alert"
            className="absolute inset-x-4 top-4 rounded-card border border-error bg-surface p-3 text-sm text-error"
          >
            The graph could not be laid out: {failure}
          </p>
        ) : null}
      </div>
      <GraphSummary id={summaryId} view={shown} />
      {/* Last in the tab order, first on screen: Tab enters at a node. */}
      <div className="order-first flex shrink-0 items-center gap-3 border-b border-hairline px-2 py-1">
        <div role="toolbar" aria-label="Zoom" className="flex gap-1">
          <ToolButton name="Zoom in" icon={ZoomIn} onClick={zoomIn} />
          <ToolButton name="Zoom out" icon={ZoomOut} onClick={zoomOut} />
          <ToolButton
            name="Fit to the evidence"
            icon={Maximize}
            onClick={refit}
          />
        </div>
        <p aria-live="polite" className="text-sm text-text-primary">
          {outOfViewNote(hidden.length)}
        </p>
        {hidden.length > 0 ? (
          <button
            type="button"
            className="rounded-chip border border-border bg-surface px-3 py-1 text-sm text-text-primary hover:bg-surface-raised"
            onClick={showNextHidden}
          >
            Bring into view
          </button>
        ) : null}
      </div>
    </div>
  )
}

export function GraphCanvas(props: GraphCanvasProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  )
}
