/**
 * Which markets each pipeline reached, worked out from the run's stored
 * results and nothing else.
 *
 * A market counts for a pipeline when an item it USED as evidence carries that
 * market in a field of its own: a passage or record's `market_id`, or the
 * `market_id` among a graph node's authoritative facts. Evidence set aside does
 * not count. An item with no market, or one that is not among the four
 * markets, does not count either. The rule never reads the question, the
 * market scope or the wording of an answer, and never parses a market out of
 * an id such as `GAME_AT_04`: if the results carry no market for an item, the
 * item reaches none.
 *
 * A pipeline with no stored result is left out of the answer, so "reached
 * none" (an empty list) differs from "did not run" (absent).
 */

import type { Schemas } from '../api/client'
import type { PipelineId } from '../design/pipelines'

export const MARKETS = [
  { id: 'MKT_UK', name: 'United Kingdom' },
  { id: 'MKT_GR', name: 'Greece' },
  { id: 'MKT_AT', name: 'Austria' },
  { id: 'MKT_CZ', name: 'Czech Republic' },
] as const

export type Coverage = Partial<Record<PipelineId, string[]>>

export function coverage(results: Schemas['QueryResults'] | null): Coverage {
  const found: Coverage = {}
  for (const [id, result] of Object.entries(results?.results ?? {})) {
    const reached = new Set<string>()
    const passages =
      'evidence' in result ? result.evidence : result.document_evidence
    for (const item of passages) if (item.selected) reached.add(item.market_id)
    if ('node_evidence' in result)
      for (const node of result.node_evidence)
        if (node.selected && node.authoritative?.market_id)
          reached.add(node.authoritative.market_id)
    found[id as PipelineId] = MARKETS.filter(({ id: market }) =>
      reached.has(market),
    ).map(({ id: market }) => market)
  }
  return found
}
