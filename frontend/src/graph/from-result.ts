/**
 * What the run's results (GET /queries/{id}) add to the recorded events: the
 * evidence paths the backend returned and the nodes it backed with source
 * records. Both are read as recorded, never worked out.
 */

import type { components } from '../api/schema'
import type { RecordedPath } from './model'

type GraphRunResult = components['schemas']['GraphRunResult']

/**
 * The path of each selected node, seed first, in the order the backend
 * returned them, with the relationship that reached the node. The result
 * names no direction, and a node with no step to reach (`SEED`) has no type.
 */
export const recordedPathsFromResult = (
  result: GraphRunResult,
): RecordedPath[] =>
  result.node_evidence
    .filter((n) => n.selected)
    .map((n) => ({
      ids: n.path,
      ...(n.path.length > 1 && n.rel_type !== 'SEED'
        ? { lastRelationship: n.rel_type }
        : {}),
    }))

/** Only the ids of `recordedPathsFromResult`. */
export const pathsFromResult = (result: GraphRunResult): string[][] =>
  recordedPathsFromResult(result).map((p) => p.ids)

/** The nodes that carry facts read from a structured source record. */
export const sourceRecordsFromResult = (
  result: GraphRunResult,
): ReadonlySet<string> =>
  new Set(
    result.node_evidence
      .filter((n) => n.authoritative?.source_record_id !== undefined)
      .map((n) => n.node_id),
  )
