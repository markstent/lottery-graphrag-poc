/**
 * What one pipeline column shows, worked out from the run state: its steps
 * with their status and time, its evidence list, and a sentence when the
 * pipeline did not finish. Pure functions of the reducer's state.
 */

import type { Schemas } from '../../api/client'
import { nodeLabel } from '../../design/node-labels'
import type { PipelineId } from '../../design/pipelines'
import { STAGE_LABELS, STEPS } from '../../run/lanes'
import { formatDuration } from './format'
import { recordTitle } from './record-title'
import type { RunPhase, Timeline } from './use-live-run'
import type {
  CandidateKind,
  DiscardReason,
  PipelineState,
  RunState,
  Stage,
} from '../../run/reduce'

export type StageRowStatus =
  | 'waiting'
  | 'running'
  | 'done'
  | 'failed'
  | 'cancelled'
  /** A step the pipeline finished without taking. */
  | 'not-run'
  /** A step the pipeline stopped before reaching. */
  | 'not-reached'

export interface StageRow {
  stage: Stage
  label: string
  status: StageRowStatus
  /** Null until the step has ended. */
  durationMs: number | null
}

/** What a step the reducer never saw means, by how its pipeline ended. */
function unseen(status: PipelineState['status']): StageRowStatus {
  if (status === 'pending' || status === 'running') return 'waiting'
  return status === 'completed' ? 'not-run' : 'not-reached'
}

export function stageRows(id: PipelineId, pipeline: PipelineState): StageRow[] {
  return STEPS[id].map((stage) => {
    const recorded = pipeline.stages[stage]
    const label = STAGE_LABELS[stage]
    if (recorded === undefined)
      return {
        stage,
        label,
        status: unseen(pipeline.status),
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
  /** From the run's results once they exist; null before, or when they hold none. */
  title: string | null
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
  slot_limit: 'no slot left',
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
export function evidenceRows(
  id: PipelineId,
  run: RunState,
  results: Schemas['QueryResults'] | null = null,
): EvidenceRow[] {
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
      title: recordTitle(results, id, recordId),
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

/** "N found · M used · K set aside", with what is still being weighed while it runs. */
export function evidenceSummary(
  rows: EvidenceRow[],
  status: PipelineState['status'],
): string {
  const count = (state: EvidenceRowState) =>
    rows.filter((row) => row.state === state).length
  const text = `${rows.length} found · ${count('selected')} used · ${count('discarded')} set aside`
  return status === 'running'
    ? `${text} · ${count('candidate')} still being weighed`
    : text
}

const CONNECTION_LOST = 'The live connection stopped.'

/** One sentence on where the run stands and, for a replay, its position. */
export function runStatusLine({
  phase,
  source,
  state,
  timeline,
}: {
  phase: RunPhase
  source: 'recorded' | 'live' | null
  state: RunState
  timeline: Timeline
}): string {
  if (state.status === 'failed')
    return `The run failed: ${state.error?.message ?? 'no reason was recorded.'}`
  if (state.status === 'cancelled') return 'The run was cancelled.'
  if (state.status === 'completed') return 'The run is complete.'
  if (phase === 'idle') return 'Choose a question and press Run.'
  if (phase === 'starting')
    return source === null ? 'Loading the recorded run.' : 'Starting the run.'
  if (phase === 'interrupted') return CONNECTION_LOST
  if (!timeline.replaying)
    return phase === 'finished' ? CONNECTION_LOST : 'The run is in progress.'
  if (timeline.playing)
    return source === 'recorded'
      ? 'Playing the recorded run.'
      : 'Replaying the run.'
  return `Paused at ${formatDuration(timeline.cursor)} of ${formatDuration(timeline.duration)}.`
}
