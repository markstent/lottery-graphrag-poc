/** The steps of each pipeline, which the flow diagram draws and describes. */

import type { PipelineId } from '../design/pipelines'
import type { Stage } from './reduce'

export interface Lane {
  /** The lane's label, naming the pipelines that take its steps. */
  label: string
  steps: string[]
  /** The pipeline whose colours the lane draws in; the shared lane has none. */
  pipeline?: PipelineId
}

/** The names of the steps, shared with the Live Lab step lists. Not in run order: STEPS and LANES give that. */
export const STEP = {
  searchPassages: 'Search passages',
  addOntologyTerms: 'Add ontology terms',
  findStartingPoints: 'Find starting points',
  followRelationships: 'Follow relationships',
  addLinkedRecords: 'Add linked records',
  reorderPassages: 'Re-order passages',
  rankByGraph: 'Rank by the graph',
} as const

/**
 * Question, then these lanes, then the shared steps after them, as method
 * v0.3 works: only passages are re-ordered; B and C put their graph records in
 * the graph's own order, and the two lists take turns filling one budget. Each
 * lane's steps before its ranking are in the order its first events arrive
 * (lanes.test.ts checks this against the recordings).
 */
export const LANES: Lane[] = [
  { label: 'A, B and C', steps: [STEP.searchPassages, STEP.reorderPassages] },
  {
    label: 'B · Graph',
    pipeline: 'B',
    steps: [
      STEP.findStartingPoints,
      STEP.followRelationships,
      STEP.rankByGraph,
    ],
  },
  {
    label: 'C · Graph + Ontology',
    pipeline: 'C',
    steps: [
      STEP.findStartingPoints,
      STEP.addOntologyTerms,
      STEP.followRelationships,
      STEP.addLinkedRecords,
      STEP.rankByGraph,
    ],
  },
]

/** The name of each stage that does the same work in every pipeline. */
export const STAGE_LABELS: Record<Exclude<Stage, 'rerank'>, string> = {
  embedding: 'Embed the question',
  search: STEP.searchPassages,
  expansion: STEP.addOntologyTerms,
  resolution: STEP.findStartingPoints,
  traversal: STEP.followRelationships,
  linking: STEP.addLinkedRecords,
  context: 'Build the context',
  generation: 'Write the answer',
}

/**
 * The re-rank stage does different work by pipeline under method v0.3. A
 * re-orders its passages and picks them within the budget. B and C re-order
 * only their passages (the graph has already ordered its own records), then
 * the two lists take turns filling the budget.
 */
const RERANK_LABELS: Record<PipelineId, string> = {
  A: 'Re-order and pick passages',
  B: 'Re-order passages, take turns',
  C: 'Re-order passages, take turns',
}

/** The name of a stage of a pipeline, as the step list and the timeline give it. */
export const stageLabel = (id: PipelineId, stage: Stage): string =>
  stage === 'rerank' ? RERANK_LABELS[id] : STAGE_LABELS[stage]

/** Each pipeline's stages in the order the first event of each one arrives. */
export const STEPS: Record<PipelineId, readonly Stage[]> = {
  A: ['embedding', 'search', 'rerank', 'context', 'generation'],
  B: ['resolution', 'traversal', 'rerank', 'context', 'generation'],
  C: [
    'resolution',
    'expansion',
    'traversal',
    'linking',
    'rerank',
    'context',
    'generation',
  ],
}

export const SHARED_BEFORE = 'Question'
export const SHARED_AFTER = ['Fill one budget', 'Answer with sources']

/** Said under the picture: how B and C fill the budget. */
export const TURNS_LINE = 'B and C take turns: a passage, then a graph record.'

/** The same diagram in words, built from the lanes so the two cannot differ. */
export const STEP_LINES = [
  `${SHARED_BEFORE}: it goes to every lane.`,
  ...LANES.map(({ label, steps }) => `${label}: ${steps.join(', then ')}.`),
  'B and C also take passages from the same search.',
  `All three then ${SHARED_AFTER.join(', then ').toLowerCase()}.`,
  TURNS_LINE,
]
