/**
 * What one pipeline column shows, worked out from the run state: its steps
 * with their status and time, its evidence list, and a sentence when the
 * pipeline did not finish. Pure functions of the reducer's state.
 */

import { nodeLabel } from '../../design/node-labels'
import type { PipelineId } from '../../design/pipelines'
import type {
  CandidateKind,
  DiscardReason,
  PipelineState,
  RunState,
  Stage,
} from '../../run/reduce'

export type StageRowStatus =
  'waiting' | 'running' | 'done' | 'failed' | 'cancelled' | 'not-reached'

export interface StageRow {
  stage: Stage
  label: string
  status: StageRowStatus
  /** Null until the step has ended. */
  durationMs: number | null
}

export const STAGE_LABELS: Record<Stage, string> = {
  embedding: 'Embed the question',
  search: 'Search passages',
  resolution: 'Find starting points',
  traversal: 'Follow relationships',
  rerank: 'Re-order and pick',
  context: 'Build the context',
  generation: 'Write the answer',
}

/** Each pipeline's steps in the order they run. */
const STEPS: Record<PipelineId, readonly Stage[]> = {
  A: ['embedding', 'search', 'rerank', 'context', 'generation'],
  B: ['resolution', 'traversal', 'rerank', 'context', 'generation'],
  C: ['resolution', 'traversal', 'rerank', 'context', 'generation'],
}

const IN_PROGRESS: readonly PipelineState['status'][] = ['pending', 'running']

export function stageRows(id: PipelineId, pipeline: PipelineState): StageRow[] {
  return STEPS[id].map((stage) => {
    const recorded = pipeline.stages[stage]
    const label = STAGE_LABELS[stage]
    if (recorded === undefined)
      return {
        stage,
        label,
        status: IN_PROGRESS.includes(pipeline.status)
          ? 'waiting'
          : 'not-reached',
        durationMs: null,
      }
    return {
      stage,
      label,
      status: recorded.status === 'completed' ? 'done' : recorded.status,
      durationMs:
        recorded.endedMs === null
          ? null
          : recorded.endedMs - recorded.startedMs,
    }
  })
}

export type EvidenceRowState = 'selected' | 'candidate' | 'discarded'

export interface EvidenceRow {
  id: string
  /** What the record is: "passage", "incident" and so on. */
  kind: string
  state: EvidenceRowState
  /** Why it was set aside; null for the other states. */
  detail: string | null
}

const DISCARD_WORDS: Record<DiscardReason, string> = {
  excluded_label: 'a kind of record this question does not use',
  out_of_scope_market: 'outside the markets asked about',
  superseded_by_structured_fact: 'a table value already answers it',
  context_budget: 'the context was full',
  slot_limit: 'too many better-ranked records',
  duplicate: 'a duplicate',
}

const ORDER: Record<EvidenceRowState, number> = {
  selected: 0,
  candidate: 1,
  discarded: 2,
}

/**
 * Every record the pipeline has met so far: used first, then those still
 * considered, then those set aside. Within a group the order of arrival holds.
 */
export function evidenceRows(id: PipelineId, run: RunState): EvidenceRow[] {
  const pipeline = run.pipelines[id]
  const nodes = id === 'A' ? [] : run.graph[id].nodes
  const rows = new Map<string, EvidenceRow>()
  const kindOf = (recordId: string, kind: CandidateKind): string => {
    if (kind === 'chunk') return 'passage'
    if (kind === 'record') return 'source record'
    const label = nodes.find((node) => node.id === recordId)?.label
    return label ? nodeLabel(label) : 'graph record'
  }
  const put = (
    recordId: string,
    kind: CandidateKind,
    state: EvidenceRowState,
    detail: string | null,
  ) =>
    rows.set(recordId, {
      id: recordId,
      kind: kindOf(recordId, kind),
      state,
      detail,
    })

  for (const { id: recordId, kind } of pipeline.candidates)
    put(recordId, kind, 'candidate', null)
  for (const { id: recordId, kind } of pipeline.selected)
    put(recordId, kind, 'selected', null)
  for (const { id: recordId, reason } of pipeline.discarded) {
    const kind: CandidateKind =
      pipeline.candidates.find((c) => c.id === recordId)?.kind ??
      (nodes.some((node) => node.id === recordId) ? 'node' : 'chunk')
    put(recordId, kind, 'discarded', `Set aside: ${DISCARD_WORDS[reason]}`)
  }
  return [...rows.values()].sort((a, b) => ORDER[a.state] - ORDER[b.state])
}

/** One sentence when the pipeline did not finish, or null. */
export function pipelineNotice(pipeline: PipelineState): string | null {
  switch (pipeline.status) {
    case 'cancelled':
      return 'Cancelled before it finished.'
    case 'skipped':
      return 'Not started: the run ended first.'
    case 'failed':
      return pipeline.error?.message ?? 'This pipeline failed.'
    default:
      return null
  }
}

/** One sentence on where the run stands. */
export function runStatusLine(
  phase: 'idle' | 'starting' | 'running' | 'interrupted' | 'finished',
  source: 'recorded' | 'live' | null,
  run: RunState,
): string {
  if (run.status === 'failed')
    return `The run failed: ${run.error?.message ?? 'no reason was recorded.'}`
  if (run.status === 'cancelled') return 'The run was cancelled.'
  if (run.status === 'completed') return 'The run is complete.'
  switch (phase) {
    case 'idle':
      return 'Choose a question and press Run.'
    case 'starting':
      return 'Starting the run.'
    case 'interrupted':
      return 'The live connection stopped before the run ended.'
    default:
      return source === 'recorded'
        ? 'Playing the recorded run.'
        : 'The run is in progress.'
  }
}
