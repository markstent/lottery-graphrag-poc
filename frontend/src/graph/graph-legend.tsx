/**
 * The key to the canvas: the seven states, each in its own shape and fill,
 * and in C what the ontology added.
 */

import { EVIDENCE_STATES, type EvidenceState } from '../design/evidence-states'
import { pipeline, type PipelineId } from '../design/pipelines'
import { TOKENS } from '../design/tokens'
import { Outline } from './node'

const STATES = Object.keys(EVIDENCE_STATES) as EvidenceState[]
const W = 30
const H = 18

export function GraphLegend({
  pipeline: id,
}: {
  pipeline: Exclude<PipelineId, 'A'>
}) {
  const ontology = pipeline('C')
  return (
    <ul
      aria-label="Key to the graph"
      className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-text-primary"
    >
      {STATES.map((state) => {
        const design = EVIDENCE_STATES[state]
        return (
          <li key={state} className="flex items-center gap-2">
            <svg aria-hidden="true" width={W} height={H}>
              <Outline
                shape={design.shape}
                w={W}
                h={H}
                fill={design.fill}
                stroke={design.stroke}
                strokeWidth={2}
                dashed={design.shape === 'dashed-circle'}
              />
            </svg>
            {design.label}
          </li>
        )
      })}
      <li className="flex items-center gap-2">
        <svg aria-hidden="true" width={W} height={4}>
          <line
            x1={0}
            x2={W}
            y1={2}
            y2={2}
            stroke={pipeline(id).strong}
            strokeWidth={4}
          />
        </svg>
        Evidence path
      </li>
      {id === 'C' ? (
        <li className="flex items-center gap-2">
          <svg aria-hidden="true" width={W} height={H}>
            <rect
              x={1}
              y={1}
              width={W - 2}
              height={H - 2}
              rx={4}
              fill={ontology.tint}
              stroke={ontology.hue}
              strokeWidth={2}
            />
          </svg>
          <span
            className="rounded-chip border px-1.5 font-semibold"
            style={{
              borderColor: ontology.hue,
              color: ontology.strong,
              background: TOKENS['color-surface'],
            }}
          >
            + ontology
          </span>
          Added by the ontology
        </li>
      ) : null}
    </ul>
  )
}
