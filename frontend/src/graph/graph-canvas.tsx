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
 * Edge tags: each edge's relationship is tagged where a free spot exists
 * (label-placement.ts). A crowded view leaves some edges untagged, evidence
 * paths first; the text summary still names every relationship.
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
import { relationshipPhrase } from '../design/relationships'
import {
  ArrowDefinitions,
  RelationshipEdge,
  type RelationshipFlowEdge,
} from './edge'
import { GraphSummary } from './graph-summary'
import { layoutGraph, type Positions } from './layout'
import { placeTags } from './label-placement'
import type { GraphView } from './model'
import { ClusterNode, EntityNode, type GraphFlowNode } from './node'
import { NODE_SIZE, PRESENTATION_NODE_SIZE } from './node-size'

/**
 * The visible-node cap that keeps labels readable on a 1920 by 1080 screen:
 * about a dozen nodes stand in a column at full size, so two columns. Above
 * about 40 the picture has to shrink until the 14 px labels are unreadable.
 */
export const LEGIBLE_NODE_CAP = 24

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
      state: EvidenceState
    }
  >()
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
      state: clusters.has(target) ? ('traversed' as const) : edge.state,
    }
    folded.phrases.add(relationshipPhrase(edge.relationship))
    folded.count += 1
    folded.onPath ||= edge.onPath
    edges.set(key, folded)
  }
  return { nodes, edges: [...edges.values()] }
}

/** An edge's tag: its relationships in plain words, and how many edges it stands for. */
const tagText = (edge: { phrases: Set<string>; count: number }): string =>
  `${[...edge.phrases].join(', ')}${edge.count > 1 ? ` \u00d7${edge.count}` : ''}`

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
  label = 'Evidence graph',
}: GraphCanvasProps) {
  const reducedMotion = useContext(SettingsContext)?.reducedMotion ?? false
  const summaryId = useId()
  const size = presentation ? PRESENTATION_NODE_SIZE : NODE_SIZE
  const flow = useReactFlow()
  const container = useRef<HTMLDivElement>(null)
  const autoFit = useRef(true)

  const visible = useMemo(() => visibleGraph(view), [view])
  const ids = useMemo(() => visible.nodes.map((n) => n.id), [visible])
  const linked = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const edge of visible.edges) {
      map.set(edge.source, (map.get(edge.source) ?? new Set()).add(edge.target))
      map.set(edge.target, (map.get(edge.target) ?? new Set()).add(edge.source))
    }
    return map
  }, [visible])

  const [positions, setPositions] = useState<Positions>(new Map())
  const placed = useRef<Positions>(new Map())
  const sizeRef = useRef(size.width)
  const [failure, setFailure] = useState<string | null>(null)
  const [laidOut, setLaidOut] = useState(false)

  // The layout reruns when the nodes, the edges or the node size change, not
  // when the view is rebuilt with the same shape.
  const structure = `${size.width}|${ids.join(',')}|${visible.edges.map((e) => e.id).join(',')}`
  const latest = useRef({ ids, edges: visible.edges, size })
  useEffect(() => {
    latest.current = { ids, edges: visible.edges, size }
  })
  useEffect(() => {
    const { ids, edges, size } = latest.current
    let current = true
    // A change of node size starts the layout afresh.
    if (sizeRef.current !== size.width) {
      sizeRef.current = size.width
      placed.current = new Map()
    }
    const present = new Set(ids)
    const kept = new Map([...placed.current].filter(([id]) => present.has(id)))
    layoutGraph(ids, edges, size, kept)
      .then((next) => {
        if (!current) return
        placed.current = next
        setPositions(next)
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
  const fit = useCallback(() => {
    void flow.fitView({ padding: 0.1, maxZoom: 1, minZoom: 0.1, duration })
  }, [flow, duration])
  useEffect(() => {
    if (!laidOut || !autoFit.current) return
    const frame = requestAnimationFrame(fit)
    return () => cancelAnimationFrame(frame)
  }, [positions, laidOut, fit])

  const [activeId, setActive] = useState<string | null>(null)
  const active =
    activeId !== null && ids.includes(activeId)
      ? activeId
      : (visible.nodes.find((n) => n.onPath) ?? visible.nodes[0])?.id

  const byId = useMemo(() => new Map(view.nodes.map((n) => [n.id, n])), [view])
  const clusterById = useMemo(
    () => new Map(view.clusters.map((c) => [c.id, c])),
    [view],
  )

  const nodes: GraphFlowNode[] = visible.nodes.flatMap((v): GraphFlowNode[] => {
    const at = positions.get(v.id)
    const node = byId.get(v.id)
    const cluster = clusterById.get(v.id)
    if (!at) return []
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

  const tags = useMemo(
    () =>
      placeTags(
        visible.edges.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          text: tagText(edge),
          onPath: edge.onPath,
        })),
        positions,
        size,
        size.font,
        active,
      ),
    [visible, positions, size, active],
  )
  const edges: RelationshipFlowEdge[] = visible.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: 'relationship',
    focusable: false,
    selectable: false,
    data: {
      label: tagText(edge),
      state: edge.state,
      onPath: edge.onPath,
      dimmed: focusMode && !edge.onPath,
      tagAt: tags.get(edge.id) ?? null,
      font: size.font,
    },
  }))

  const focusNode = (id: string) => {
    setActive(id)
    container.current
      ?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`)
      ?.focus({ preventScroll: true })
    const at = positions.get(id)
    const box = container.current?.getBoundingClientRect()
    if (!at || !box) return
    const { x, y, zoom } = flow.getViewport()
    const left = at.x * zoom + x
    const top = at.y * zoom + y
    const margin = 24
    const inside =
      left >= margin &&
      top >= margin &&
      left + size.width * zoom <= box.width - margin &&
      top + size.height * zoom <= box.height - margin
    if (!inside)
      void flow.setCenter(at.x + size.width / 2, at.y + size.height / 2, {
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
      <ArrowDefinitions />
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
