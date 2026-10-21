/**
 * The two kinds of node on the canvas, both DOM buttons so they take focus
 * and read aloud: an evidence node drawn in its state's shape, icon and
 * colour, and a group node standing for several nodes the cap folded away.
 */

import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { Check, CircleMinus, Layers } from 'lucide-react'
import type { ReactElement } from 'react'

import { EVIDENCE_STATES, type EvidenceShape } from '../design/evidence-states'
import { countedLabel, nodeLabel } from '../design/node-labels'
import { TOKENS } from '../design/tokens'
import type { GraphCluster, GraphNodeView } from './model'
import type { NodeSize } from './node-size'

/** The share of the width a shape leaves for text. */
const TEXT_SPAN: Record<EvidenceShape, number> = {
  circle: 0.72,
  square: 0.92,
  diamond: 0.56,
  hexagon: 0.78,
  pill: 0.86,
  'dashed-circle': 0.72,
  document: 0.84,
}

const STROKE = 2
const PATH_STROKE = 4

interface CommonData extends Record<string, unknown> {
  size: NodeSize
  /** Dimmed to 25 percent by focus mode. */
  dimmed: boolean
  /** The node that takes Tab; every other node is reached with the arrow keys. */
  active: boolean
  reducedMotion: boolean
  onFocusNode: (id: string) => void
}

export interface EntityNodeData extends CommonData {
  node: GraphNodeView
}

export interface ClusterNodeData extends CommonData {
  cluster: GraphCluster
}

export type EntityFlowNode = Node<EntityNodeData, 'entity'>
export type ClusterFlowNode = Node<ClusterNodeData, 'cluster'>
export type GraphFlowNode = EntityFlowNode | ClusterFlowNode

/** The outline of a shape inside a `w` by `h` box, inset by half the stroke. */
function Outline({
  shape,
  w,
  h,
  fill,
  stroke,
  strokeWidth,
  dashed,
}: {
  shape: EvidenceShape
  w: number
  h: number
  fill: string
  stroke: string
  strokeWidth: number
  dashed: boolean
}): ReactElement {
  const i = strokeWidth / 2
  const paint = {
    fill,
    stroke,
    strokeWidth,
    strokeDasharray: dashed ? '7 5' : undefined,
    strokeLinejoin: 'round' as const,
  }
  const points = (list: [number, number][]) =>
    list.map(([x, y]) => `${x},${y}`).join(' ')
  switch (shape) {
    case 'circle':
    case 'dashed-circle':
      return (
        <ellipse
          cx={w / 2}
          cy={h / 2}
          rx={w / 2 - i}
          ry={h / 2 - i}
          {...paint}
        />
      )
    case 'square':
      return (
        <rect
          x={i}
          y={i}
          width={w - 2 * i}
          height={h - 2 * i}
          rx={6}
          {...paint}
        />
      )
    case 'pill':
      return (
        <rect
          x={i}
          y={i}
          width={w - 2 * i}
          height={h - 2 * i}
          rx={h / 2}
          {...paint}
        />
      )
    case 'diamond':
      return (
        <polygon
          points={points([
            [w / 2, i],
            [w - i, h / 2],
            [w / 2, h - i],
            [i, h / 2],
          ])}
          {...paint}
        />
      )
    case 'hexagon':
      return (
        <polygon
          points={points([
            [w * 0.14, i],
            [w * 0.86, i],
            [w - i, h / 2],
            [w * 0.86, h - i],
            [w * 0.14, h - i],
            [i, h / 2],
          ])}
          {...paint}
        />
      )
    case 'document': {
      const fold = Math.min(h * 0.34, 22)
      return (
        <>
          <polygon
            points={points([
              [i, i],
              [w - fold, i],
              [w - i, fold],
              [w - i, h - i],
              [i, h - i],
            ])}
            {...paint}
          />
          <polyline
            points={points([
              [w - fold, i],
              [w - fold, fold],
              [w - i, fold],
            ])}
            fill="none"
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinejoin="round"
          />
        </>
      )
    }
  }
}

const buttonStyle = (data: CommonData) =>
  ({
    width: data.size.width,
    height: data.size.height,
    opacity: data.dimmed ? 0.25 : 1,
    transition: data.reducedMotion ? 'none' : 'opacity 200ms ease-out',
  }) as const

const enterClass = (data: CommonData) =>
  data.reducedMotion ? '' : 'graph-node-enter'

function Handles() {
  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        className="!pointer-events-none !size-px !border-0 !bg-transparent"
      />
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        className="!pointer-events-none !size-px !border-0 !bg-transparent"
      />
    </>
  )
}

export function EntityNode({ data }: NodeProps<EntityFlowNode>) {
  const { node, size } = data
  const design = EVIDENCE_STATES[node.state]
  const Icon = design.icon
  const darkFill = node.state === 'selected'
  const ink = darkFill ? TOKENS['color-surface'] : TOKENS['color-text-primary']
  const quiet = darkFill
    ? TOKENS['color-grey-200']
    : TOKENS['color-text-secondary']
  const verdict =
    node.outcome === 'selected' || node.outcome === 'discarded'
      ? node.outcome
      : null
  const showVerdict = verdict !== null && node.state !== verdict
  const verdictText = verdict === 'selected' ? 'Used as evidence' : 'Set aside'
  const description = `${node.id}${showVerdict ? `, ${verdictText.toLowerCase()}` : ''}${node.onPath ? ', on an evidence path' : ''}`
  const words = nodeLabel(node.label)
  return (
    <>
      <Handles />
      <button
        type="button"
        className={`graph-node relative block ${enterClass(data)}`}
        style={buttonStyle(data)}
        tabIndex={data.active ? 0 : -1}
        aria-label={`${design.label}: ${words}`}
        aria-description={description}
        data-node-id={node.id}
        data-state={node.state}
        data-on-path={node.onPath}
        data-dimmed={data.dimmed}
        onFocus={() => data.onFocusNode(node.id)}
        title={`${words} ${node.id}`}
      >
        <svg
          aria-hidden="true"
          className="absolute inset-0"
          width={size.width}
          height={size.height}
          viewBox={`0 0 ${size.width} ${size.height}`}
        >
          <Outline
            shape={design.shape}
            w={size.width}
            h={size.height}
            fill={design.fill}
            stroke={design.stroke}
            strokeWidth={node.onPath ? PATH_STROKE : STROKE}
            dashed={design.shape === 'dashed-circle'}
          />
        </svg>
        <span
          className="relative mx-auto flex h-full flex-col justify-center text-left leading-tight"
          style={{
            width: `${TEXT_SPAN[design.shape] * 100}%`,
            fontSize: size.font,
            color: node.state === 'discarded' ? quiet : ink,
          }}
        >
          <span className="flex min-w-0 items-center gap-1.5 font-semibold">
            <Icon
              aria-hidden="true"
              className="shrink-0"
              size={size.font + 2}
            />
            <span className="truncate first-letter:uppercase">{words}</span>
          </span>
          <span className="truncate" style={{ color: quiet }}>
            {node.id}
          </span>
        </span>
        {showVerdict ? (
          <span
            aria-hidden="true"
            className="absolute -top-2 -right-2 grid size-6 place-items-center rounded-full border-2"
            style={{
              background:
                verdict === 'selected'
                  ? TOKENS['color-grey-900']
                  : TOKENS['color-surface'],
              borderColor: TOKENS['color-grey-900'],
              color:
                verdict === 'selected'
                  ? TOKENS['color-surface']
                  : TOKENS['color-grey-900'],
            }}
            title={verdictText}
          >
            {verdict === 'selected' ? (
              <Check size={14} />
            ) : (
              <CircleMinus size={14} />
            )}
          </span>
        ) : null}
      </button>
    </>
  )
}

export function ClusterNode({ data }: NodeProps<ClusterFlowNode>) {
  const { cluster, size } = data
  const counted = countedLabel(cluster.count, cluster.label)
  const offset = 5
  const w = size.width - 2 * offset
  const h = size.height - 2 * offset
  return (
    <>
      <Handles />
      <button
        type="button"
        className={`graph-node relative block ${enterClass(data)}`}
        style={buttonStyle(data)}
        tabIndex={data.active ? 0 : -1}
        aria-label={`Group: ${counted}`}
        aria-description={`${cluster.count} nodes folded into one, ${cluster.hop} ${cluster.hop === 1 ? 'step' : 'steps'} from the starting point`}
        data-node-id={cluster.id}
        data-state="cluster"
        data-dimmed={data.dimmed}
        onFocus={() => data.onFocusNode(cluster.id)}
        title={counted}
      >
        <svg
          aria-hidden="true"
          className="absolute inset-0"
          width={size.width}
          height={size.height}
          viewBox={`0 0 ${size.width} ${size.height}`}
        >
          {[2 * offset, offset, 0].map((shift) => (
            <rect
              key={shift}
              x={shift + STROKE / 2}
              y={2 * offset - shift + STROKE / 2}
              width={w - STROKE}
              height={h - STROKE}
              rx={8}
              fill={TOKENS['color-surface']}
              stroke={TOKENS['color-grey-600']}
              strokeWidth={STROKE}
            />
          ))}
        </svg>
        <span
          className="absolute flex items-center gap-1.5 px-3 font-semibold"
          style={{
            left: 0,
            top: 2 * offset,
            width: w,
            height: h,
            fontSize: size.font,
            color: TOKENS['color-text-primary'],
          }}
        >
          <Layers
            aria-hidden="true"
            className="shrink-0"
            size={size.font + 2}
          />
          <span className="truncate first-letter:uppercase">{counted}</span>
        </span>
      </button>
    </>
  )
}
