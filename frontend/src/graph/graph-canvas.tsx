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
 * Edges are routed orthogonally by elk, which also places each edge's tag
 * (layout.ts). Evidence paths and selected evidence are drawn in the strong
 * tone of the pipeline the canvas shows; in C, what the ontology added is
 * tinted in C's colour and badged.
 */

import '@xyflow/react/dist/style.css'

import {
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Node,
} from '@xyflow/react'
import {
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'

import { SettingsContext } from '../app/use-settings'
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
import type { GraphView } from './model'
import { ClusterNode, EntityNode, type GraphFlowNode } from './node'
import {
  groupWidth,
  nodeWidth,
  PRESENTATION_TYPE_SIZE,
  TYPE_SIZE,
  type NodeSize,
} from './node-size'

/** Space left around the framed path, in px. */
const FIT_MARGIN = 32

/** The smallest label size on screen that fit view allows when it frames a path. */
export const MIN_TYPE_PX = 14

const nodeTypes = { entity: EntityNode, cluster: ClusterNode }
const edgeTypes = { relationship: RelationshipEdge }

export interface GraphCanvasProps {
  view: GraphView
  /** Called with a node id, or a group id for a group node. */
  onSelectNode: (id: string) => void
  /** Dim everything off the evidence path to 25 percent. */
  focusMode: boolean
  /** Larger type and nodes for a presentation screen. */
  presentation: boolean
  /** The pipeline the view belongs to; sets the colour of evidence paths. */
  pipeline: Exclude<PipelineId, 'A'>
  /** The accessible name of the canvas. */
  label?: string
}

interface Placed {
  id: string
  kind: 'entity' | 'cluster'
  state: EvidenceState
  onPath: boolean
}

/** What the canvas draws: the nodes the cap left standing and one node per group. */
function visibleGraph(view: GraphView) {
  const clusters = new Map(view.clusters.map((c) => [c.id, c]))
  const nodes: (Placed & { index: number })[] = []
  const seenClusters = new Set<string>()
  view.nodes.forEach((node, index) => {
    if (node.clusterId === undefined) {
      nodes.push({
        id: node.id,
        kind: 'entity',
        state: node.state,
        onPath: node.onPath,
        index,
      })
    } else if (!seenClusters.has(node.clusterId)) {
      seenClusters.add(node.clusterId)
      nodes.push({
        id: node.clusterId,
        kind: 'cluster',
        state: 'traversed',
        onPath: false,
        index,
      })
    }
  })
  const clusterOf = new Map(view.nodes.map((n) => [n.id, n.clusterId]))
  const represent = (id: string) => clusterOf.get(id) ?? id

  const edges = new Map<
    string,
    {
      id: string
      source: string
      target: string
      phrases: Set<string>
      count: number
      onPath: boolean
      added: boolean
      state: EvidenceState
    }
  >()
  const added = new Map(view.nodes.map((n) => [n.id, n.addedByOntology]))
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

function Canvas({
  view,
  onSelectNode,
  focusMode,
  presentation,
  pipeline: pipelineId,
  label = 'Evidence graph',
}: GraphCanvasProps) {
  const reducedMotion = useContext(SettingsContext)?.reducedMotion ?? false
  const summaryId = useId()
  const type = presentation ? PRESENTATION_TYPE_SIZE : TYPE_SIZE
  const strong = pipeline(pipelineId).strong
  const ontology = pipeline('C')
  const arrows = `arrow-${useId().replaceAll(':', '')}`
  const flow = useReactFlow()
  const container = useRef<HTMLDivElement>(null)
  const autoFit = useRef(true)

  const visible = useMemo(() => visibleGraph(view), [view])
  const byId = useMemo(() => new Map(view.nodes.map((n) => [n.id, n])), [view])
  const clusterById = useMemo(
    () => new Map(view.clusters.map((c) => [c.id, c])),
    [view],
  )
  const ids = useMemo(() => visible.nodes.map((n) => n.id), [visible])
  const widths = useMemo(
    () =>
      new Map(
        visible.nodes.map((v) => {
          const node = byId.get(v.id)
          const group = clusterById.get(v.id)
          return [
            v.id,
            node ? nodeWidth(node, type) : group ? groupWidth(group, type) : 0,
          ]
        }),
      ),
    [visible, byId, clusterById, type],
  )
  const tagText = (edge: { phrases: Set<string>; count: number }): string =>
    `${[...edge.phrases].join(', ')}${edge.count > 1 ? ` \u00d7${edge.count}` : ''}`
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
  const fontRef = useRef(type.font)
  const [failure, setFailure] = useState<string | null>(null)
  const [laidOut, setLaidOut] = useState(false)

  // The layout reruns when the nodes, their widths, the edges, their tags or
  // the type size change, not when the view is rebuilt with the same shape.
  const tagged = visible.edges.map((e) => ({ ...e, text: tagText(e) }))
  const structure = `${type.font}|${ids.map((id) => `${id}:${widths.get(id)}`).join(',')}|${tagged.map((e) => `${e.id}:${e.text}`).join(',')}`
  const latest = useRef({ ids, widths, tagged, type })
  useEffect(() => {
    latest.current = { ids, widths, tagged, type }
  })
  useEffect(() => {
    const { ids, widths, tagged, type } = latest.current
    let current = true
    // A change of type size starts the layout afresh.
    if (fontRef.current !== type.font) {
      fontRef.current = type.font
      placed.current = new Map()
    }
    const present = new Set(ids)
    const kept = new Map([...placed.current].filter(([id]) => present.has(id)))
    layoutGraph(
      ids.map((id) => ({ id, width: widths.get(id) ?? type.minWidth })),
      tagged.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        tag: tagSize(e.text, type.font),
      })),
      type.height,
      kept,
    )
      .then((next) => {
        if (!current) return
        placed.current = next.positions
        setLayout(next)
        setFailure(null)
        setLaidOut(true)
      })
      .catch((error: unknown) => {
        if (current)
          setFailure(error instanceof Error ? error.message : String(error))
      })
    return () => {
      current = false
    }
  }, [structure])

  const duration = reducedMotion ? 0 : 240
  // Fit frames the evidence path when there is one, and never zooms out far
  // enough to take the type below MIN_TYPE_PX on screen. The path sits against
  // the left edge so the graph it leads into shows beside it, centred
  // vertically. A path taller than the screen at the smallest size is framed
  // from its start, the seed, and the rest is reached by panning or by zooming
  // out. With no path yet, fit frames every node.
  const pathIds = useMemo(
    () => visible.nodes.filter((n) => n.onPath).map((n) => n.id),
    [visible],
  )
  const fit = useCallback(() => {
    const box = container.current?.getBoundingClientRect()
    const framed = pathIds.flatMap((id) => {
      const at = positions.get(id)
      return at ? [{ id, at, width: widths.get(id) ?? type.minWidth }] : []
    })
    if (!box || framed.length === 0) {
      void flow.fitView({ padding: 0.15, maxZoom: 1, minZoom: 0.1, duration })
      return
    }
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
      Math.min(1, MIN_TYPE_PX / type.font),
    )
    // Centre on the path, or on its start when the path is taller than the screen.
    const seed = positions.get(view.path[0])
    const middle =
      (bottom - top) * zoom <= room.height || !seed
        ? (top + bottom) / 2
        : seed.y + type.height / 2
    void flow.setViewport(
      {
        x: FIT_MARGIN - left * zoom,
        y: box.height / 2 - middle * zoom,
        zoom,
      },
      { duration },
    )
  }, [flow, duration, pathIds, positions, widths, type, view.path])
  useEffect(() => {
    if (!laidOut || !autoFit.current) return
    const frame = requestAnimationFrame(fit)
    return () => cancelAnimationFrame(frame)
  }, [layout, laidOut, fit])

  const [activeId, setActive] = useState<string | null>(null)
  const active =
    activeId !== null && ids.includes(activeId)
      ? activeId
      : (visible.nodes.find((n) => n.onPath) ?? visible.nodes[0])?.id

  const nodes: GraphFlowNode[] = visible.nodes.flatMap((v): GraphFlowNode[] => {
    const at = positions.get(v.id)
    const node = byId.get(v.id)
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
        ontology: {
          hue: ontology.hue,
          tint: ontology.tint,
          strong: ontology.strong,
        },
        dimmed: focusMode && !v.onPath,
        active: v.id === active,
        reducedMotion,
        onFocusNode: setActive,
      },
    }
    if (v.kind === 'entity' && node)
      return [{ ...common, type: 'entity', data: { ...common.data, node } }]
    if (cluster)
      return [{ ...common, type: 'cluster', data: { ...common.data, cluster } }]
    return []
  })

  const edges: RelationshipFlowEdge[] = tagged.flatMap((edge) => {
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
              label: edge.text,
              state: edge.state,
              onPath: edge.onPath,
              addedByOntology: edge.added,
              dimmed: focusMode && !edge.onPath,
              points: route.points,
              tag: route.tag,
              font: type.font,
              strong,
              ontology: {
                hue: ontology.hue,
                tint: ontology.tint,
                strong: ontology.strong,
              },
              arrows,
            },
          },
        ]
      : []
  })

  const focusNode = (id: string) => {
    setActive(id)
    container.current
      ?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`)
      ?.focus({ preventScroll: true })
    const at = positions.get(id)
    const width = widths.get(id) ?? type.minWidth
    const box = container.current?.getBoundingClientRect()
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

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const { key } = event
    if (key === 'Escape') {
      if (container.current) leave(container.current)
    } else if (key === '+' || key === '=') {
      autoFit.current = false
      void flow.zoomIn({ duration })
    } else if (key === '-') {
      autoFit.current = false
      void flow.zoomOut({ duration })
    } else if (key === '0') {
      autoFit.current = true
      fit()
    } else if (key.startsWith('Arrow') && active) {
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
      aria-describedby={summaryId}
      aria-busy={!laidOut && failure === null}
      className="relative h-full min-h-64 w-full rounded-card border border-border bg-surface"
      onKeyDown={onKeyDown}
    >
      <ArrowDefinitions
        prefix={arrows}
        pathColor={strong}
        ontologyColor={ontology.hue}
      />
      <ReactFlow<Node, RelationshipFlowEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
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
        onNodeClick={(_, node) => onSelectNode(node.id)}
        onMoveStart={(event) => {
          if (event) autoFit.current = false
        }}
      >
        <Controls showInteractive={false} position="bottom-left" />
      </ReactFlow>
      <GraphSummary id={summaryId} view={view} />
      {failure !== null ? (
        <p
          role="alert"
          className="absolute inset-x-4 top-4 rounded-card border border-error bg-surface p-3 text-sm text-error"
        >
          The graph could not be laid out: {failure}
        </p>
      ) : null}
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
