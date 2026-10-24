/**
 * Answers for the ontology and scenario routes in the mock API, from a
 * capture of the dev world (`scripts/capture-data-model.mjs`): the concepts,
 * the members of each concept (all markets, and each market it is bound in)
 * and the scenarios, exactly as the API gave them.
 */

import captured from './fixtures/ontology-world.json' with { type: 'json' }
import type { Answer } from './mock-data-model'

const world = captured as unknown as {
  ontology: { version: string; concepts: { concept_id: string }[] }
  members: Record<string, Record<string, unknown[]>>
  scenarios: unknown[]
}

export const ONTOLOGY = world.ontology
export const SCENARIOS = world.scenarios

const MARKET_IDS = ['MKT_UK', 'MKT_GR', 'MKT_AT', 'MKT_CZ']

const failure = (status: number, code: string, message: string): Answer => ({
  status,
  body: { error: { error_code: code, message, retryable: false } },
})

/** `GET /ontology/concepts/{id}/members`, filtered by market as the backend does. */
export function membersOf(concept: string, market: string | null): Answer {
  const byMarket = world.members[concept]
  if (!byMarket) return failure(404, 'NOT_FOUND', `unknown concept: ${concept}`)
  if (market !== null && !MARKET_IDS.includes(market))
    return failure(422, 'VALIDATION_ERROR', `unknown market: ${market}`)
  // A market the concept is not bound in has no terms; the capture holds only the bound ones.
  return { status: 200, body: byMarket[market ?? 'all'] ?? [] }
}
