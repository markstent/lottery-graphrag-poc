/**
 * The two maps of Data Model, drawn by one component: the warehouse tables
 * (links between tables) and the graph's kinds of record (relationships
 * between kinds). Positions and routes come from the shared graph layout
 * (elkjs); this file only draws them as an SVG, with a button per node and the
 * links listed in words for anyone who cannot see the picture.
 */

import { useId } from 'react'

import { useLoad } from '../../app/use-load'
import { Panel } from '../../components/panel'
import { pipeline } from '../../design/pipelines'
import { TOKENS } from '../../design/tokens'
import { roundedPath } from '../../graph/edge-path'
import { layoutGraph, type Layout, type Point } from '../../graph/layout'
import type { DiagramEdge, DiagramNode, EdgeLook } from './model'

/** Node height and label size at normal type; `scale` raises both for presentation. */
const NODE_HEIGHT = 56
const TITLE_FONT = 18
const DETAIL_FONT = 16
const TAG_FONT = 15
/**
 * The smallest size, in px on screen, a node title is shrunk to when the page
 * is narrower than the drawing; below it the drawing scrolls sideways.
 */
const MIN_TITLE_PX = 13
/** Space around the drawing, in px. */
const PAD = 16
/** Average glyph width as a share of the font size, for sizing tags. */
const GLYPH = 0.58

interface DiagramProps {
  nodes: DiagramNode[]
  edges: DiagramEdge[]
  /** The accessible name of the picture. */
  label: string
  /** The node shown as chosen; nodes are toggle buttons when this is given. */
  selected?: string | null
  onSelect: (id: string) => void
  /** Presentation mode raises type and node height by this factor. */
  scale: number
  /**
   * Draw the box titles at this many pixels, so maps side by side match; the
   * map then scrolls when it is wider than its panel. Without it, a map
   * shrinks to fit down to a readable title size.
   */
  titlePx?: number
}

/** Longest line of a tag's phrase, in characters, before it wraps. */
const TAG_WRAP = 12

/**
 * The lines of a tag: the phrase, wrapped so a long one does not push the
 * layers of the map apart, then the count after " · " on a line of its own.
 */
function tagLines(label: string): string[] {
  const [phrase, count] = label.split(' · ')
  const lines: string[] = []
  for (const word of phrase.split(' ')) {
    const last = lines[lines.length - 1]
    if (last !== undefined && last.length + 1 + word.length <= TAG_WRAP)
      lines[lines.length - 1] = `${last} ${word}`
    else lines.push(word)
  }
  return count === undefined ? lines : [...lines, count]
}

const tagSize = (label: string | undefined, scale: number) => {
  if (!label) return { width: 0, height: 0 }
  const lines = tagLines(label)
  return {
    width: Math.ceil(
      Math.max(...lines.map((line) => line.length)) * TAG_FONT * scale * GLYPH +
        16,
    ),
    height: Math.ceil(lines.length * TAG_FONT * scale * 1.15 + 8),
  }
}

function edgeStyle(look: EdgeLook | undefined): {
  color: string
  dash?: string
} {
  switch (look) {
    case 'b':
      return { color: pipeline('B').hue }
    case 'c':
      return { color: pipeline('C').hue }
    case 'outside':
      return { color: TOKENS['color-grey-500'], dash: '6 5' }
    default:
      return { color: TOKENS['color-grey-600'] }
  }
}

/** The box around every node, route and drawn tag, with `PAD` around it. */
function bounds(
  layout: Layout,
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  height: number,
  scale: number,
) {
  const points: Point[] = []
  for (const node of nodes) {
    const at = layout.positions.get(node.id)
    if (at) points.push(at, { x: at.x + node.width, y: at.y + height })
  }
  for (const route of layout.routes.values()) points.push(...route.points)
  // A tag can sit past the last node, on a route's outer stretch.
  for (const edge of edges) {
    const route = layout.routes.get(edge.id)
    if (!route || !edge.label || edge.tagged === false) continue
    const tag = tagSize(edge.label, scale)
    points.push(
      { x: route.tag.x - tag.width / 2, y: route.tag.y - tag.height / 2 },
      { x: route.tag.x + tag.width / 2, y: route.tag.y + tag.height / 2 },
    )
  }
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const left = Math.min(...xs) - PAD
  const top = Math.min(...ys) - PAD
  return {
    left,
    top,
    width: Math.max(...xs) + PAD - left,
    height: Math.max(...ys) + PAD - top,
  }
}

export function Diagram({
  nodes,
  edges,
  label,
  selected,
  onSelect,
  scale,
  titlePx,
}: DiagramProps) {
  const arrows = useId()
  const height = NODE_HEIGHT * scale
  // The layout depends on the structure only, so toggling what is shown
  // (hidden, dimmed, look) never moves a node.
  const structure = JSON.stringify([
    scale,
    nodes.map((n) => [n.id, n.width]),
    edges.map((e) => [e.id, e.source, e.target, e.label ?? '']),
  ])
  const load = useLoad(
    () =>
      layoutGraph(
        nodes.map(({ id, width }) => ({ id, width })),
        edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          tag: tagSize(e.label, scale),
        })),
        height,
        new Map(),
      ).catch((error: unknown) => {
        // The reader gets a sentence; the detail is for whoever debugs it.
        console.error('Map layout failed', error)
        throw error
      }),
    structure,
  )

  if (load.status !== 'ready')
    return (
      <Panel
        title={label}
        state={load.status}
        error={
          load.status === 'error'
            ? new Error('The map could not be drawn.')
            : undefined
        }
        action={{ label: 'Try again', onClick: load.retry }}
      />
    )
  const { data: layout } = load
  if (layout.positions.size === 0) return null
  const shown = edges.filter((e) => !e.hidden)
  const box = bounds(layout, nodes, shown, height, scale)
  const title = new Map(nodes.map((n) => [n.id, n.title]))

  return (
    <div className="relative overflow-x-auto">
      <svg
        role="img"
        aria-label={label}
        viewBox={`${box.left} ${box.top} ${box.width} ${box.height}`}
        style={{
          ...(titlePx === undefined
            ? {
                width: box.width,
                minWidth:
                  box.width * Math.min(1, MIN_TITLE_PX / (TITLE_FONT * scale)),
                maxWidth: '100%',
              }
            : { width: box.width * (titlePx / (TITLE_FONT * scale)) }),
          height: 'auto',
        }}
      >
        <defs>
          {(['plain', 'b', 'c', 'outside'] as const).map((look) => (
            <marker
              key={look}
              id={`${arrows}-${look}`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="8"
              markerHeight="8"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10 z" fill={edgeStyle(look).color} />
            </marker>
          ))}
        </defs>
        {shown.map((edge) => {
          const route = layout.routes.get(edge.id)
          if (!route) return null
          const { color, dash } = edgeStyle(edge.look)
          const tag = tagSize(edge.label, scale)
          const marker = `url(#${arrows}-${edge.look ?? 'plain'})`
          return (
            <g
              key={edge.id}
              data-edge-id={edge.id}
              opacity={edge.faint ? 0.2 : 1}
            >
              <path
                d={roundedPath(route.points)}
                fill="none"
                stroke={color}
                strokeWidth={1.5}
                strokeDasharray={dash}
                markerStart={edge.reversed ? marker : undefined}
                markerEnd={edge.reversed ? undefined : marker}
              />
              {edge.label && edge.tagged !== false && (
                <>
                  <rect
                    x={route.tag.x - tag.width / 2}
                    y={route.tag.y - tag.height / 2}
                    width={tag.width}
                    height={tag.height}
                    rx={4}
                    fill={TOKENS['color-surface']}
                    stroke={TOKENS['color-hairline']}
                  />
                  <text
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={TAG_FONT * scale}
                    fill={TOKENS['color-text-primary']}
                  >
                    {tagLines(edge.label).map((line, i, lines) => (
                      <tspan
                        key={line}
                        x={route.tag.x}
                        y={
                          route.tag.y +
                          (i - (lines.length - 1) / 2) * TAG_FONT * scale * 1.15
                        }
                      >
                        {line}
                      </tspan>
                    ))}
                  </text>
                </>
              )}
            </g>
          )
        })}
        {nodes.map((node) => {
          const at = layout.positions.get(node.id)
          if (!at) return null
          const chosen = selected === node.id
          return (
            <g
              key={node.id}
              role="button"
              tabIndex={0}
              aria-label={
                node.detail ? `${node.title}, ${node.detail}` : node.title
              }
              aria-pressed={selected === undefined ? undefined : chosen}
              data-node-id={node.id}
              className="map-node"
              style={{ cursor: 'pointer', opacity: node.dimmed ? 0.55 : 1 }}
              onClick={() => onSelect(node.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onSelect(node.id)
                }
              }}
            >
              <rect
                x={at.x}
                y={at.y}
                width={node.width}
                height={height}
                rx={8}
                fill={
                  chosen ? TOKENS['color-grey-100'] : TOKENS['color-surface']
                }
                stroke={
                  chosen ? TOKENS['color-grey-900'] : TOKENS['color-grey-600']
                }
                strokeWidth={chosen ? 3 : 1.5}
                strokeDasharray={node.dimmed ? '5 4' : undefined}
              />
              <text
                x={at.x + node.width / 2}
                y={at.y + height * (node.detail ? 0.36 : 0.5)}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={TITLE_FONT * scale}
                fontWeight={600}
                fill={TOKENS['color-text-primary']}
              >
                {node.title}
              </text>
              {node.detail && (
                <text
                  x={at.x + node.width / 2}
                  y={at.y + height * 0.71}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={DETAIL_FONT * scale}
                  fill={TOKENS['color-text-secondary']}
                >
                  {node.detail}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      <ul className="sr-only" aria-label={`${label}, in words`}>
        {shown.map((edge) => (
          <li key={edge.id}>
            {edge.reversed
              ? `${title.get(edge.target)} ${edge.label ?? 'links to'} ${title.get(edge.source)}`
              : `${title.get(edge.source)} ${edge.label ?? 'links to'} ${title.get(edge.target)}`}
          </li>
        ))}
      </ul>
    </div>
  )
}
