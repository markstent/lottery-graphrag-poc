/**
 * A deterministic stand-in for the backend, for the visual baselines: the
 * calls the shell, Settings and the evidence drawer make answer with fixed
 * data, and everything else answers 404 in the backend's error envelope.
 * The node ids `node-loading`, `node-error` and `node-orphan` give the
 * evidence drawer its loading, error and no-source states.
 */

import type { Page } from '@playwright/test'

import {
  DATASET_ID,
  DICTIONARY,
  GRAPH_SCHEMA,
  GRAPH_STATS,
  graphNode,
  neighboursOf,
  recordOf,
  ROW_COUNTS,
  rowsOf,
} from './mock-data-model'
import scoredQuestions from './fixtures/benchmark-questions-scored.json' with { type: 'json' }
import unscoredQuestions from './fixtures/benchmark-questions-unscored.json' with { type: 'json' }
import { membersOf, ONTOLOGY, SCENARIOS } from './mock-ontology'

const SUMMARY = {
  dataset_id: 'dev-seed2026',
  generator_version: '0.2.0',
  world_seed: 2026,
  scenario_seed: 7,
  profile: 'dev',
  row_counts: ROW_COUNTS,
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

const RUNS = [
  {
    run_id: 'official-2026-10-20',
    run_kind: 'official',
    label: null,
    started_at: '2026-10-20T09:00:00Z',
    selection: { strata: null, limit: null },
    worlds: [2026],
    headlines: [
      'Graph and ontology answered more questions correctly than the current approach.',
    ],
  },
  {
    run_id: 'smoke-2026-10-18',
    run_kind: 'smoke',
    label: 'Pilot check',
    started_at: '2026-10-18T09:00:00Z',
    selection: { strata: ['depth'], limit: 3 },
    worlds: [2026],
    headlines: ['Three instances per question on the depth stratum only.'],
  },
]

const cell = (mean: number, n: number, repeats: number) => ({
  mean,
  n,
  repeats,
})

const FULL_BANK = { strata: null, limit: null }

const LATEST_SUMMARY = {
  selection: FULL_BANK,
  headlines: [
    'Graph found 0.12 more evidence than text search on multi-hop questions (95% interval 0.05 to 0.19, 36 pairs in 12 groups).',
    'Graph + Ontology found 0.03 more evidence than Graph on questions anchored by id (95% interval -0.02 to 0.08, 36 pairs in 12 groups).',
  ],
  metrics: {
    overall: {
      evidence_f1: {
        A: cell(0.31, 114, 342),
        B: cell(0.43, 114, 342),
        C: cell(0.46, 114, 342),
      },
    },
  },
}

/** What GET /benchmarks/latest answers: the official run, a smoke-only state, or a 404. */
const LATEST = {
  official: {
    run_id: 'official-2026-10-20',
    run_kind: 'official',
    label: null,
    summary: LATEST_SUMMARY,
  },
  smoke: {
    run_id: 'smoke-2026-10-18',
    run_kind: 'smoke',
    label: 'scorer smoke test',
    summary: { ...LATEST_SUMMARY, headlines: ['Scorer smoke test.'] },
  },
} as const

export type LatestRun = keyof typeof LATEST | 'none' | 'unavailable' | 'pending'

const DEMO_QUESTIONS = [
  [
    'L05-2026-INC_S007_GR',
    'L05',
    'Why did digital conversion fall in Greece?',
    'H1',
  ],
  ['L07-2026-X', 'L07', 'Which markets share a payment provider?', 'H2'],
  ['L11-2026-X', 'L11', 'Which incidents touched the checkout system?', 'H1'],
  ['L14-2026-X', 'L14', 'What was the weekly sales total in Austria?', 'H3'],
].map(([instance_id, question_id, text, stratum]) => ({
  instance_id,
  question_id,
  text,
  stratum,
  market_scope: [],
}))

const ROUTES: Record<string, unknown> = {
  '/api/v1/benchmarks': RUNS,
  '/api/v1/demo/questions': DEMO_QUESTIONS,
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
  '/api/v1/ontology': ONTOLOGY,
  '/api/v1/scenarios': SCENARIOS,
  [`/api/v1/datasets/${DATASET_ID}/dictionary`]: DICTIONARY,
  '/api/v1/graph/schema': GRAPH_SCHEMA,
  '/api/v1/graph/stats': GRAPH_STATS,
}

const TABLES_PREFIX = `/api/v1/datasets/${DATASET_ID}/tables/`

/** What the Data Model screen sees: its data, no tables or kinds, a failing server, or never an answer. */
export type DataModelState = 'normal' | 'empty' | 'error' | 'pending'

const json = (body: unknown, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
})

const envelope = (message: string, status: number) =>
  json({ error: { error_code: 'RUN_ERROR', message, retryable: true } }, status)

const NODE_PREFIX = '/api/v1/graph/nodes/'

/** The routes whose answer the Data Model states replace (not the dataset list the header reads). */
const DATA_MODEL_PATHS = [
  `/api/v1/datasets/${DATASET_ID}/dictionary`,
  '/api/v1/graph/schema',
  '/api/v1/ontology',
  '/api/v1/scenarios',
]

/** What each Data Model route answers when the world has none. */
const NONE: Record<string, unknown> = {
  '/api/v1/graph/schema': { ...GRAPH_SCHEMA, labels: [] },
  '/api/v1/ontology': { ...ONTOLOGY, concepts: [] },
}

const MEMBERS = /^\/api\/v1\/ontology\/concepts\/([^/]+)\/members$/

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
export async function mockApi(
  page: Page,
  /** The run list the Results screen sees: as published, none, or failing. */
  runs: 'published' | 'none' | 'unavailable' = 'published',
  /** The newest run Overview sees: official, smoke only, none (404), failing or never answering. */
  latest: LatestRun = 'official',
  dataModel: DataModelState = 'normal',
) {
  await page.clock.setFixedTime(new Date('2026-10-20T10:00:00Z'))
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/v1/benchmarks' && runs !== 'published')
      return route.fulfill(
        runs === 'none'
          ? json([])
          : envelope('The run list is unavailable.', 503),
      )
    if (path === '/api/v1/benchmarks/latest') {
      if (latest === 'pending') return new Promise<void>(() => undefined)
      if (latest === 'none')
        return route.fulfill(
          json(
            {
              error: {
                error_code: 'NOT_FOUND',
                message: 'no published benchmark run',
                retryable: false,
              },
            },
            404,
          ),
        )
      if (latest === 'unavailable')
        return route.fulfill(envelope('The latest run is unavailable.', 503))
      return route.fulfill(json(LATEST[latest]))
    }
    // The bank is scored only when the newest run is a whole-bank official run, as the backend does.
    if (path === '/api/v1/benchmarks/questions')
      return route.fulfill(
        json(latest === 'official' ? scoredQuestions : unscoredQuestions),
      )
    if (dataModel !== 'normal' && DATA_MODEL_PATHS.includes(path)) {
      if (dataModel === 'pending') return new Promise<void>(() => undefined)
      if (dataModel === 'error')
        return route.fulfill(envelope('The data is unavailable.', 503))
      return route.fulfill(json(NONE[path] ?? []))
    }
    const members = MEMBERS.exec(path)
    if (members) {
      const answer = membersOf(
        decodeURIComponent(members[1]),
        new URL(route.request().url()).searchParams.get('market'),
      )
      return route.fulfill(json(answer.body, answer.status))
    }
    if (path in ROUTES) return route.fulfill(json(ROUTES[path]))
    if (path.startsWith(TABLES_PREFIX)) {
      const [table, , id] = path.slice(TABLES_PREFIX.length).split('/')
      const answer =
        id === undefined
          ? rowsOf(table, new URL(route.request().url()).searchParams)
          : recordOf(table, decodeURIComponent(id))
      return route.fulfill(json(answer.body, answer.status))
    }
    if (path.startsWith(NODE_PREFIX) && path.endsWith('/neighbours')) {
      const id = decodeURIComponent(
        path.slice(NODE_PREFIX.length, -'/neighbours'.length),
      )
      const limit = Number(
        new URL(route.request().url()).searchParams.get('limit') ?? 25,
      )
      const answer = neighboursOf(id, limit)
      return route.fulfill(json(answer.body, answer.status))
    }
    if (path.startsWith(NODE_PREFIX)) {
      const id = decodeURIComponent(path.slice(NODE_PREFIX.length))
      // Never answers, so the drawer stays in its loading state.
      if (id === 'node-loading') return new Promise<void>(() => undefined)
      if (id === 'node-error')
        return route.fulfill(envelope('The graph is not answering.', 503))
      return route.fulfill(json(graphNode(id) ?? node(id)))
    }
    return route.fulfill(envelope(`no mock for ${path}`, 404))
  })
}
