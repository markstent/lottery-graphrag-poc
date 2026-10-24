/**
 * A deterministic stand-in for the backend, for the visual baselines: the
 * calls the shell, Settings and the evidence drawer make answer with fixed
 * data, and everything else is refused (and listed, for
 * expectNoUnmockedRequests).
 * The node ids `node-loading`, `node-error` and `node-orphan` give the
 * evidence drawer its loading, error and no-source states.
 */

import { expect, type Page } from '@playwright/test'

import {
  DATASET_ID,
  DICTIONARY,
  GRAPH_SCHEMA,
  GRAPH_STATS,
  graphNode,
  neighboursOf,
  recordOf,
  rowsOf,
} from './mock-data-model'
import scoredQuestions from './fixtures/benchmark-questions-scored.json' with { type: 'json' }
import unscoredQuestions from './fixtures/benchmark-questions-unscored.json' with { type: 'json' }
import { membersOf, ONTOLOGY, SCENARIOS } from './mock-ontology'
import world from './fixtures/world-shell.json' with { type: 'json' }

/** The captured bank: its instance count (Help shows it) and the repeats of an official run. */
const BANK_INSTANCES = scoredQuestions.length
const REPEATS = 3

/*
 * Everything the shell, Overview and Results show comes from a capture of the
 * real API (scripts/capture-shell.mjs): the demo questions, models, readiness,
 * datasets and the published runs. The one invented thing is FIXTURE_OFFICIAL,
 * an "official run" of the whole bank: no such run exists yet, so the screens
 * that show one are baselined with test values, named `fixture-official`.
 */
const SUMMARY = world.datasets[0]
const READY = world.ready
const RUNS = world.runs
const DEMO_QUESTIONS = world.demo_questions

const cell = (mean: number, repeats: number) => ({
  mean,
  n: BANK_INSTANCES,
  repeats,
})

/** Test values, not results: a whole-bank official run, so Overview draws its tiles. */
const FIXTURE_OFFICIAL = {
  run_id: 'fixture-official',
  run_kind: 'official',
  label: null,
  summary: {
    selection: { strata: null, limit: null },
    headlines: [
      'Fixture headline for the H1 comparison (test values).',
      'Fixture headline for the H2 comparison (test values).',
    ],
    metrics: {
      overall: {
        evidence_f1: {
          A: cell(0.31, BANK_INSTANCES * REPEATS),
          B: cell(0.43, BANK_INSTANCES * REPEATS),
          C: cell(0.46, BANK_INSTANCES * REPEATS),
        },
      },
    },
  },
}

/**
 * What GET /benchmarks/latest answers: the invented official run, the newest
 * smoke run, or the newest published run as captured (a subset run, so
 * Overview says there is no official run yet).
 */
const LATEST = {
  official: FIXTURE_OFFICIAL,
  smoke: world.latest_smoke,
  none: world.latest,
} as const

export type LatestRun = keyof typeof LATEST | 'unavailable' | 'pending'

const ROUTES: Record<string, unknown> = {
  '/api/v1/benchmarks': RUNS,
  '/api/v1/demo/questions': DEMO_QUESTIONS,
  '/api/v1/health/ready': READY,
  '/api/v1/datasets': [SUMMARY],
  [`/api/v1/datasets/${DATASET_ID}`]: world.dataset,
  '/api/v1/models': world.models,
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

/** The paths a page asked for that the mock has no answer for. */
const unmockedBy = new WeakMap<Page, string[]>()

/** Fails the test when the page asked for something the mock does not answer. */
export function expectNoUnmockedRequests(page: Page) {
  expect(unmockedBy.get(page) ?? [], 'unmocked API requests').toEqual([])
}

/** Fixes the clock and answers the API from the data above. */
export async function mockApi(
  page: Page,
  /** The run list the Results screen sees: as published, none, or failing. */
  runs: 'published' | 'none' | 'unavailable' | 'pending' = 'published',
  /** The newest run Overview sees: official, smoke only, none (404), failing or never answering. */
  latest: LatestRun = 'official',
  dataModel: DataModelState = 'normal',
) {
  const unmocked: string[] = []
  unmockedBy.set(page, unmocked)
  await page.clock.setFixedTime(new Date('2026-10-20T10:00:00Z'))
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/v1/benchmarks' && runs === 'pending')
      return new Promise<void>(() => undefined)
    if (path === '/api/v1/benchmarks' && runs !== 'published')
      return route.fulfill(
        runs === 'none'
          ? json([])
          : envelope('The run list is unavailable.', 503),
      )
    if (path === '/api/v1/benchmarks/latest') {
      if (latest === 'pending') return new Promise<void>(() => undefined)
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
    // Nothing may reach a backend that happens to run on this machine: an
    // unmocked call is refused and fails the test (see below).
    unmocked.push(path)
    return route.abort()
  })
}
