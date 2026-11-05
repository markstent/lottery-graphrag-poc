/**
 * The ontology and scenarios of the dev world, as the API answered them
 * (captured by `scripts/capture-data-model.mjs`), so the tests read the
 * concepts, labels and members the product really shows.
 */

import { vi } from 'vitest'

import type { Schemas } from '../../api/client'
import { failure, json } from '../../test/api-stub'
import captured from '../../../e2e/fixtures/ontology-world.json'

const world = captured as unknown as {
  ontology: Schemas['OntologyOut']
  members: Record<string, Record<string, Schemas['MemberOut'][]>>
  scenarios: Schemas['ScenarioOut'][]
}

export const ONTOLOGY = world.ontology
/** The captured scenarios predate `description`, so each gets a plain one. */
export const SCENARIOS: Schemas['ScenarioOut'][] = world.scenarios.map((s) => ({
  ...s,
  description: s.description ?? `What happens in ${s.title.toLowerCase()}.`,
}))
export const NATIONAL_DRAW = 'CONCEPT_NATIONAL_DRAW'

/** The members of a concept as the API gives them: all, or those of one market. */
export const membersOf = (concept: string, market: string | null) =>
  world.members[concept]?.[market ?? 'all'] ?? []

const MEMBERS_PATH = /^\/api\/v1\/ontology\/concepts\/([^/]+)\/members$/

/**
 * A fetch stand-in that answers the ontology, a concept's members (filtered
 * by the `market` parameter, as the backend does) and the scenarios. Other
 * routes can be added or replaced. Every requested path is recorded.
 */
export function stubOntology(extra: Record<string, unknown> = {}) {
  const requested: string[] = []
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost')
    requested.push(url.pathname + url.search)
    if (url.pathname in extra) return Promise.resolve(json(extra[url.pathname]))
    if (url.pathname === '/api/v1/ontology')
      return Promise.resolve(json(ONTOLOGY))
    if (url.pathname === '/api/v1/scenarios')
      return Promise.resolve(json(SCENARIOS))
    const concept = MEMBERS_PATH.exec(url.pathname)?.[1]
    if (concept)
      return Promise.resolve(
        json(membersOf(concept, url.searchParams.get('market'))),
      )
    return Promise.resolve(failure(`no stub for ${url.pathname}`, false, 404))
  })
  vi.stubGlobal('fetch', fetchMock)
  return { requested, fetchMock }
}
