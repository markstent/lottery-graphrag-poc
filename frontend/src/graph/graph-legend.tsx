/**
 * The key to the canvas: the seven states, each in its own shape and fill,
 * and in C what the ontology added.
 */

import { EVIDENCE_STATES, type EvidenceState } from '../design/evidence-states'
import { pipeline, type PipelineId } from '../design/pipelines'
import { TOKENS } from '../design/tokens'
import { ONTOLOGY_DASH, OTHER_PATH_DASH } from './edge-path'
import { Outline } from './node'

const STATES = Object.keys(EVIDENCE_STATES) as EvidenceState[]
const W = 30
const H = 18

export function GraphLegend({
  pipeline: id,
  ontologyAdded = false,
  otherPath,
}: {
  pipeline: Exclude<PipelineId, 'A'>
  /** The other pipeline, when the canvas marks its evidence path as well. */
  otherPath?: Exclude<PipelineId, 'A'>
  /** True when the canvas marks what the ontology added (it has a B to compare with). */
  ontologyAdded?: boolean
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
      {otherPath ? (
        <li className="flex items-center gap-2">
          <svg aria-hidden="true" width={W} height={4}>
            <line
              x1={0}
              x2={W}
              y1={2}
              y2={2}
              stroke={pipeline(otherPath).strong}
              strokeWidth={4}
              strokeDasharray={OTHER_PATH_DASH}
            />
          </svg>
          {otherPath}&apos;s evidence path
        </li>
      ) : null}
      {id === 'C' && ontologyAdded ? (
        <li className="flex items-center gap-2">
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
          <svg aria-hidden="true" width={W} height={4}>
            <line
              x1={2}
              x2={W - 2}
              y1={2}
              y2={2}
              stroke={ontology.hue}
              strokeWidth={3}
              strokeLinecap="round"
              strokeDasharray={ONTOLOGY_DASH}
            />
          </svg>
          Added by the ontology
        </li>
      ) : null}
    </ul>
  )
}
