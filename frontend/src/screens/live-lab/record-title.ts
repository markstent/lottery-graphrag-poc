/**
 * A plain title for a record in the evidence list, read from the run's
 * results as recorded. Nothing is invented: a record the results do not
 * describe has no title, and the list shows its id and kind instead.
 */

import type { Schemas } from '../../api/client'
import type { PipelineId } from '../../design/pipelines'

type Results = Schemas['QueryResults']

/** Text up to the end of its first sentence. */
const firstClause = (text: string): string =>
  text.split(/\.(?:\s|$)/, 1)[0].trim()

export function recordTitle(
  run: Results | null,
  pipeline: PipelineId,
  id: string,
): string | null {
  const result = run?.results?.[pipeline]
  if (!result) return null
  const chunks =
    'evidence' in result ? result.evidence : result.document_evidence
  const chunk = chunks.find((c) => c.chunk_id === id)
  if (chunk) return firstClause(chunk.text) || chunk.title || null
  if ('node_evidence' in result) {
    const summary = result.node_evidence.find((n) => n.node_id === id)
      ?.authoritative?.summary
    return summary ? firstClause(summary) || null : null
  }
  return null
}
