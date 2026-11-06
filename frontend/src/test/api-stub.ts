/**
 * A fetch stand-in for component tests: each route is a JSON body or a
 * function of the request's URL returning a Response. An unrouted request answers 404 in the
 * backend's error envelope, so a missing stub shows up as an error panel
 * rather than a hang.
 */

import { vi } from 'vitest'

export type Route = unknown | ((url: URL) => Response | Promise<Response>)

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export function failure(
  message: string,
  retryable: boolean,
  status = 503,
): Response {
  return json(
    { error: { error_code: 'RUN_ERROR', message, retryable } },
    status,
  )
}

export function stubApi(routes: Record<string, Route>) {
  const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost')
    const path = url.pathname
    if (!(path in routes))
      return Promise.resolve(failure(`no stub for ${path}`, false, 404))
    const route = routes[path]
    return Promise.resolve(
      typeof route === 'function' ? route(url) : json(route),
    )
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

export const READY = {
  ready: true,
  public_mode: false,
  checks: {
    lab: { ok: true, detail: 'built', stand_in: false },
    index: {
      ok: true,
      detail: '1,204 points, record version 2',
      stand_in: false,
    },
    graph: { ok: true, detail: 'answering', stand_in: false },
    model: { ok: true, detail: 'qwen3:8b is reachable', stand_in: false },
    embedding: { ok: true, detail: 'bge-m3 is reachable', stand_in: false },
  },
}

/** The public read-only site (D-117): no model runs, so only the world and the graph are checked. */
export const PUBLIC = {
  ready: true,
  public_mode: true,
  checks: {
    data: { ok: true, detail: 'world dev-seed2026', stand_in: false },
    graph: { ok: true, detail: 'Neo4j answered', stand_in: false },
  },
}

export const BUILDING = {
  ready: false,
  public_mode: false,
  checks: {
    ...READY.checks,
    lab: { ok: false, detail: 'building', stand_in: false },
  },
}

export const DOWN = {
  ready: false,
  public_mode: false,
  checks: {
    ...READY.checks,
    model: {
      ok: false,
      detail: 'qwen3:8b is not listed by the model server',
      stand_in: false,
    },
  },
}

export const SUMMARY = {
  dataset_id: 'dev-seed2026',
  generator_version: '0.2.0',
  world_seed: 2026,
  scenario_seed: 7,
  profile: 'dev',
  row_counts: { players: 1200 },
  active: true,
}

export const DATASETS = [
  { ...SUMMARY, dataset_id: 'dev-seed2027', world_seed: 2027, active: false },
  SUMMARY,
]

export const DATASET_DETAIL = {
  summary: SUMMARY,
  provenance: {},
  index_status: {
    built_at: '2026-10-19T09:00:00Z',
    collection: 'dev',
    points: 1204,
    serialiser_version: '2',
  },
}

const model = (provider: string, name: string, reachable: boolean | null) => ({
  provider,
  model: name,
  reachable,
  detail: reachable === false ? 'not listed' : 'listed',
})

export const MODELS = {
  generation: model('ollama', 'qwen3:8b', true),
  embedding: model('ollama', 'bge-m3', true),
  rerank: model('local', 'bge-reranker-v2-m3', null),
  sparse: model('local', 'bm25', true),
}

export const ONTOLOGY = { version: '2.0.0', concepts: [] }

export const SHELL_API = {
  '/api/v1/health/ready': READY,
  '/api/v1/datasets': DATASETS,
  '/api/v1/datasets/dev-seed2026': DATASET_DETAIL,
  '/api/v1/models': MODELS,
  '/api/v1/ontology': ONTOLOGY,
}
