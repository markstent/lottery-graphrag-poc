/**
 * A deterministic stand-in for the backend, for the visual baselines: the
 * calls the shell, Settings and the evidence drawer make answer with fixed
 * data, and everything else answers 404 in the backend's error envelope.
 * The node ids `node-loading`, `node-error` and `node-orphan` give the
 * evidence drawer its loading, error and no-source states.
 */

import type { Page } from '@playwright/test'

const SUMMARY = {
  dataset_id: 'dev-seed2026',
  generator_version: '0.2.0',
  world_seed: 2026,
  scenario_seed: 7,
  profile: 'dev',
  row_counts: { players: 1200 },
  active: true,
}

const model = (provider: string, name: string, reachable: boolean | null) => ({
  provider,
  model: name,
  reachable,
  detail: reachable === false ? 'not listed' : 'listed',
})

const READY = {
  ready: true,
  checks: {
    lab: { ok: true, detail: 'built' },
    index: { ok: true, detail: '1,204 points, record version 2' },
    graph: { ok: true, detail: 'answering' },
    model: { ok: true, detail: 'qwen3:8b is reachable' },
    embedding: { ok: true, detail: 'bge-m3 is reachable' },
  },
}

const ROUTES: Record<string, unknown> = {
  '/api/v1/health/ready': READY,
  '/api/v1/datasets': [SUMMARY],
  '/api/v1/datasets/dev-seed2026': {
    summary: SUMMARY,
    provenance: {},
    index_status: {
      built_at: '2026-10-19T09:00:00Z',
      collection: 'dev',
      points: 1204,
      serialiser_version: '2',
    },
  },
  '/api/v1/models': {
    generation: model('ollama', 'qwen3:8b', true),
    embedding: model('ollama', 'bge-m3', true),
    rerank: model('local', 'bge-reranker-v2-m3', null),
    sparse: model('local', 'bm25', true),
  },
  '/api/v1/ontology': { version: '2.0.0', concepts: [] },
}

const json = (body: unknown, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
})

const envelope = (message: string, status: number) =>
  json({ error: { error_code: 'RUN_ERROR', message, retryable: true } }, status)

const NODE_PREFIX = '/api/v1/graph/nodes/'

function node(id: string) {
  return {
    node_id: id,
    labels: ['Incident'],
    properties: {
      title: 'Payment outage',
      market: 'GR',
      severity: 3,
      affected_systems: ['checkout', 'wallet'],
    },
    provenance:
      id === 'node-orphan'
        ? null
        : { dataset_id: 'dev-seed2026', table: 'incidents', row_id: id },
  }
}

/** Fixes the clock and answers the API from the data above. */
export async function mockApi(page: Page) {
  await page.clock.setFixedTime(new Date('2026-10-20T10:00:00Z'))
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path in ROUTES) return route.fulfill(json(ROUTES[path]))
    if (path.startsWith(NODE_PREFIX)) {
      const id = decodeURIComponent(path.slice(NODE_PREFIX.length))
      // Never answers, so the drawer stays in its loading state.
      if (id === 'node-loading') return new Promise<void>(() => undefined)
      if (id === 'node-error')
        return route.fulfill(envelope('The graph is not answering.', 503))
      return route.fulfill(json(node(id)))
    }
    return route.fulfill(envelope(`no mock for ${path}`, 404))
  })
}
