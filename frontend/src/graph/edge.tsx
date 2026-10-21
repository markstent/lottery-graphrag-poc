/**
 * A relationship edge: the orthogonal route elk worked out, drawn with rounded
 * corners, with its relationship in plain words on a tag where elk left room
 * for it. Evidence-path edges are thick and in the pipeline's strong tone;
 * edges into a set-aside node are dashed and grey; edges the ontology added
 * are in the ontology pipeline's colour.
 */

import {
  BaseEdge,
  EdgeLabelRenderer,
  type Edge,
  type EdgeProps,
} from '@xyflow/react'

import type { EvidenceState } from '../design/evidence-states'
import { TOKENS } from '../design/tokens'
import { roundedPath } from './edge-path'
import type { Point } from './layout'

export interface RelationshipEdgeData extends Record<string, unknown> {
  /** The relationship in plain words; several for edges folded into one. */
  label: string
  state: EvidenceState
  onPath: boolean
  /** True for an edge the ontology added (configuration C only). */
  addedByOntology: boolean
  dimmed: boolean
  /** The elk route, from the source node's right side to the target node's left. */
  points: Point[]
  /** The centre of the tag. */
  tag: Point
  /** Label size in px. */
  font: number
  /** The strong tone of the canvas's pipeline, for evidence-path edges. */
  strong: string
  /** The pipeline colours of the ontology, for edges it added. */
  ontology: { hue: string; tint: string; strong: string }
  /** Prefix of this canvas's arrow head ids, so two canvases never share one. */
  arrows: string
}

export type RelationshipFlowEdge = Edge<RelationshipEdgeData, 'relationship'>

function look(data: RelationshipEdgeData): {
  color: string
  width: number
  dash?: string
} {
  if (data.onPath) return { color: data.strong, width: 4 }
  if (data.addedByOntology) return { color: data.ontology.hue, width: 2.5 }
  if (data.state === 'discarded')
    return { color: TOKENS['color-grey-500'], width: 1.5, dash: '6 5' }
  if (data.state === 'selected')
    return { color: TOKENS['color-grey-800'], width: 2.5 }
  return { color: TOKENS['color-grey-600'], width: 1.5 }
}

export function RelationshipEdge({
  id,
  data,
}: EdgeProps<RelationshipFlowEdge>) {
  if (!data) return null
  const { color, width, dash } = look(data)
  const opacity = data.dimmed ? 0.25 : 1
  const marker = data.onPath
    ? 'path'
    : data.addedByOntology
      ? 'ontology'
      : 'plain'
  return (
    <>
      <BaseEdge
        id={id}
        path={roundedPath(data.points)}
        markerEnd={`url(#${data.arrows}-${marker})`}
        style={{
          stroke: color,
          strokeWidth: width,
          strokeDasharray: dash,
          opacity,
        }}
      />
      <EdgeLabelRenderer>
        <span
          className="nodrag nopan pointer-events-none absolute rounded-chip border px-1.5 leading-tight whitespace-nowrap"
          data-edge-id={id}
          style={{
            transform: `translate(-50%, -50%) translate(${data.tag.x}px, ${data.tag.y}px)`,
            fontSize: data.font,
            fontWeight: data.onPath ? 600 : 400,
            color: data.addedByOntology
              ? data.ontology.strong
              : TOKENS['color-text-primary'],
            background: data.addedByOntology
              ? data.ontology.tint
              : TOKENS['color-surface'],
            borderColor: data.addedByOntology
              ? data.ontology.hue
              : TOKENS['color-hairline'],
            opacity,
          }}
        >
          {data.label}
        </span>
      </EdgeLabelRenderer>
    </>
  )
}

/** The arrow heads the edges point to; drawn once inside the canvas. */
export function ArrowDefinitions({
  prefix,
  pathColor,
  ontologyColor,
}: {
  prefix: string
  pathColor: string
  ontologyColor: string
}) {
  const arrow = (name: string, color: string) => (
    <marker
      id={`${prefix}-${name}`}
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
        {arrow('plain', TOKENS['color-grey-600'])}
        {arrow('path', pathColor)}
        {arrow('ontology', ontologyColor)}
      </defs>
    </svg>
  )
}
