/**
 * The graph a pipeline has drawn so far, from the run state and the stored
 * results. Used by the canvas and by the path strip, so both read the same
 * rules: the ontology comparison against B at the same point of the run, the
 * recorded evidence paths once their event has arrived, and the other
 * pipeline's path only once that pipeline has recorded it.
 */

import type { Schemas } from '../../api/client'
import {
  pathsFromResult,
  recordedPathsFromResult,
  sourceRecordsFromResult,
} from '../../graph/from-result'
import { graphView, type GraphView } from '../../graph/model'
import type { RunState } from '../../run/reduce'

export type GraphPipeline = 'B' | 'C'

export const otherOf = (id: GraphPipeline): GraphPipeline =>
  id === 'B' ? 'C' : 'B'

const graphResult = (
  results: Schemas['QueryResults'] | null,
  id: GraphPipeline,
): Schemas['GraphRunResult'] | null => {
  const result = results?.results?.[id]
  return result && 'node_evidence' in result ? result : null
}

export function pipelineView({
  state,
  results,
  id,
  cap,
  focus,
  showOther = false,
}: {
  state: RunState
  results: Schemas['QueryResults'] | null
  id: GraphPipeline
  cap: number
  focus: boolean
  /** Mark the other pipeline's evidence path on this graph. */
  showOther?: boolean
}): GraphView {
  const own = graphResult(results, id)
  const other = graphResult(results, otherOf(id))
  return graphView(state.graph[id], {
    cap,
    focus,
    overlay: id === 'C' ? state.graph.B : undefined,
    paths: own ? recordedPathsFromResult(own) : undefined,
    sourceRecordIds: own ? sourceRecordsFromResult(own) : undefined,
    otherPaths:
      showOther && other && state.graph[otherOf(id)].evidencePath !== null
        ? pathsFromResult(other)
        : undefined,
  })
}
