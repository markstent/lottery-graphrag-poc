/** The steps of each pipeline, which the flow diagram draws and describes. */

import type { PipelineId } from '../../design/pipelines'

export interface Lane {
  /** The lane's label, naming the pipelines that take its steps. */
  label: string
  steps: string[]
  /** The pipeline whose colours the lane draws in; the shared lane has none. */
  pipeline?: PipelineId
}

/** The names of the steps, shared with the Live Lab step lists. */
export const STEP = {
  searchPassages: 'Search passages',
  addOntologyTerms: 'Add ontology terms',
  findStartingPoints: 'Find starting points',
  followRelationships: 'Follow relationships',
  addLinkedRecords: 'Add linked records',
  reorderAndPick: 'Re-order and pick',
} as const

/** Question, then these lanes, then the shared steps after them. */
export const LANES: Lane[] = [
  { label: 'A, B and C', steps: [STEP.searchPassages] },
  {
    label: 'B · Graph',
    pipeline: 'B',
    steps: [STEP.findStartingPoints, STEP.followRelationships],
  },
  {
    label: 'C · Graph + Ontology',
    pipeline: 'C',
    steps: [
      STEP.addOntologyTerms,
      STEP.findStartingPoints,
      STEP.followRelationships,
      STEP.addLinkedRecords,
    ],
  },
]

export const SHARED_BEFORE = 'Question'
export const SHARED_AFTER = [STEP.reorderAndPick, 'Answer with sources']

/** The same diagram in words, built from the lanes so the two cannot differ. */
export const STEP_LINES = [
  `${SHARED_BEFORE}: it goes to every lane.`,
  ...LANES.map(({ label, steps }) => `${label}: ${steps.join(', then ')}.`),
  'B and C also take passages from the same search.',
  `All three then ${SHARED_AFTER.join(', then ').toLowerCase()}.`,
]
