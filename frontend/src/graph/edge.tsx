/**
 * A relationship edge: a curve from source to target with its relationship in
 * plain words on a white tag. Evidence-path edges are thick and dark; edges
 * into a set-aside node are dashed and grey.
 */

import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type Edge,
  type EdgeProps,
} from '@xyflow/react'

import type { EvidenceState } from '../design/evidence-states'
import { TOKENS } from '../design/tokens'
import { bezierPoint } from './label-placement'

export interface RelationshipEdgeData extends Record<string, unknown> {
  /** The relationship in plain words; several for edges folded into one. */
  label: string
  state: EvidenceState
  onPath: boolean
  dimmed: boolean
  /** Where along the curve the tag sits (0 to 1), or null when it has no free spot. */
  tagAt: number | null
  /** Label size in px. */
  font: number
}

export type RelationshipFlowEdge = Edge<RelationshipEdgeData, 'relationship'>

function look(data: RelationshipEdgeData): {
  color: string
  width: number
  dash?: string
} {
  if (data.onPath) return { color: TOKENS['color-grey-900'], width: 4 }
  if (data.state === 'discarded')
    return { color: TOKENS['color-grey-500'], width: 1.5, dash: '6 5' }
  if (data.state === 'selected')
    return { color: TOKENS['color-grey-800'], width: 2.5 }
  return { color: TOKENS['color-grey-600'], width: 1.5 }
}

export function RelationshipEdge(props: EdgeProps<RelationshipFlowEdge>) {
  const { data } = props
  if (!data) return null
  const [path] = getBezierPath(props)
  const tag =
    data.tagAt === null
      ? null
      : bezierPoint(
          { x: props.sourceX, y: props.sourceY },
          { x: props.targetX, y: props.targetY },
          data.tagAt,
        )
  const { color, width, dash } = look(data)
  const opacity = data.dimmed ? 0.25 : 1
  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        markerEnd={`url(#graph-arrow-${data.onPath ? 'path' : 'plain'})`}
        style={{
          stroke: color,
          strokeWidth: width,
          strokeDasharray: dash,
          opacity,
        }}
      />
      {tag ? (
        <EdgeLabelRenderer>
          <span
            className="nodrag nopan pointer-events-none absolute rounded-chip border border-hairline bg-surface px-1.5 leading-tight whitespace-nowrap"
            data-edge-id={props.id}
            style={{
              transform: `translate(-50%, -50%) translate(${tag.x}px, ${tag.y}px)`,
              fontSize: data.font,
              fontWeight: data.onPath ? 600 : 400,
              color: TOKENS['color-text-primary'],
              opacity,
            }}
          >
            {data.label}
          </span>
        </EdgeLabelRenderer>
      ) : null}
    </>
  )
}

/** The two arrow heads the edges point to; drawn once inside the canvas. */
export function ArrowDefinitions() {
  const arrow = (id: string, color: string) => (
    <marker
      id={id}
      viewBox="0 0 10 10"
      refX="9"
      refY="5"
      markerWidth="9"
      markerHeight="9"
      markerUnits="userSpaceOnUse"
      orient="auto-start-reverse"
    >
      <path d="M0,1 L9,5 L0,9 z" fill={color} />
    </marker>
  )
  return (
    <svg aria-hidden="true" className="absolute size-0">
      <defs>
        {arrow('graph-arrow-plain', TOKENS['color-grey-600'])}
        {arrow('graph-arrow-path', TOKENS['color-grey-900'])}
      </defs>
    </svg>
  )
}
