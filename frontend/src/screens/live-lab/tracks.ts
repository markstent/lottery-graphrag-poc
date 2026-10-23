/**
 * The timeline's three tracks: each pipeline's steps as bars between their
 * recorded start and end times, in milliseconds from the first event.
 */

import type { PipelineId } from '../../design/pipelines'
import type { RunState, Stage, StageState } from '../../run/reduce'

export interface Segment {
  stage: Stage
  from: number
  to: number
  status: StageState['status']
}

const IDS: readonly PipelineId[] = ['A', 'B', 'C']

/**
 * A step still running ends at `cursor`, the position the run has reached,
 * so the bar grows as the run plays. Steps are in the order they began.
 */
export function trackSegments(
  state: RunState,
  originMs: number,
  cursor: number,
): Record<PipelineId, Segment[]> {
  const tracks = { A: [], B: [], C: [] } as Record<PipelineId, Segment[]>
  for (const id of IDS)
    tracks[id] = (
      Object.entries(state.pipelines[id].stages) as [Stage, StageState][]
    )
      .map(([stage, { status, startedMs, endedMs }]) => ({
        stage,
        from: startedMs - originMs,
        to: endedMs === null ? cursor : endedMs - originMs,
        status,
      }))
      .sort((a, b) => a.from - b.from)
  return tracks
}
