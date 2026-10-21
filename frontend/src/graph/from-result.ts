/**
 * What the run's results (GET /queries/{id}) add to the recorded events: the
 * evidence paths the backend returned and the nodes it backed with source
 * records. Both are read as recorded, never worked out.
 */

import type { components } from '../api/schema'

type GraphRunResult = components['schemas']['GraphRunResult']

/** The path of each selected node, seed first, in the order the backend returned them. */
export const pathsFromResult = (result: GraphRunResult): string[][] =>
  result.node_evidence.filter((n) => n.selected).map((n) => n.path)

/** The nodes that carry facts read from a structured source record. */
export const sourceRecordsFromResult = (
  result: GraphRunResult,
): ReadonlySet<string> =>
  new Set(
    result.node_evidence
      .filter((n) => n.authoritative?.source_record_id !== undefined)
      .map((n) => n.node_id),
  )
