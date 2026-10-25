/**
 * What opens in the evidence drawer for an id a pipeline cites or lists, and
 * where that id sits on the pipeline's recorded evidence path. Both read the
 * run's stored results only; an id they do not hold opens nothing.
 */

import type { Schemas } from '../../api/client'
import { datasetName } from '../../app/plain-words'
import type { EvidenceSource } from '../../components/evidence-drawer'
import type { PipelineId } from '../../design/pipelines'
import { pathsFromResult } from '../../graph/from-result'
import { MARKETS } from '../../run/coverage'

type Results = Schemas['QueryResults']

export interface PathPosition {
  path: number
  step: number
  of: number
}

/**
 * Why a record of a recording cannot be opened: the active dataset is not the
 * world the run was captured on, so the row or node would be another world's.
 * Null for a live run or when they match. While the active dataset is not yet
 * known, a recording's record waits rather than risk another world's row.
 */
export function otherWorldNotice(
  recorded: string | null,
  active: string | null,
): string | null {
  if (recorded === null || recorded === active) return null
  if (active === null) return 'The dataset is still loading.'
  return `Recorded on ${datasetName(recorded)}; the active dataset is ${datasetName(active)}, so these records cannot be opened.`
}

export function sourceFor(
  results: Results | null,
  pipeline: PipelineId,
  id: string,
  datasetId: string | null,
): EvidenceSource | null {
  const result = results?.results?.[pipeline]
  if (!result) return null
  if (
    'node_evidence' in result &&
    result.node_evidence.some((n) => n.node_id === id)
  )
    return { kind: 'node', nodeId: id }
  const passages =
    'evidence' in result ? result.evidence : result.document_evidence
  const item = passages.find((c) => c.chunk_id === id)
  if (!item) return null
  if (item.kind === 'record' && item.record_table && datasetId !== null)
    return {
      kind: 'record',
      datasetId,
      table: item.record_table,
      rowId: item.document_id,
    }
  const market = MARKETS.find((m) => m.id === item.market_id)?.name
  return {
    kind: 'passage',
    title: item.title,
    text: item.text,
    facts: [
      ['Document', item.document_id],
      ['Kind of document', item.document_type],
      ...(market ? [['Market', market] as [string, string]] : []),
      ['Language', item.language_code],
      ['Source system', item.source_system],
    ],
  }
}

/**
 * The first recorded evidence path holding `id`. Null before the pipeline has
 * recorded its paths (`recorded`), for pipeline A, and for a node on no path.
 */
export function pathPosition(
  results: Results | null,
  pipeline: PipelineId,
  id: string,
  recorded: boolean,
): PathPosition | null {
  const result = results?.results?.[pipeline]
  if (!recorded || !result || !('node_evidence' in result)) return null
  const paths = pathsFromResult(result)
  const path = paths.findIndex((ids) => ids.includes(id))
  if (path < 0) return null
  return {
    path: path + 1,
    step: paths[path].indexOf(id) + 1,
    of: paths[path].length,
  }
}
