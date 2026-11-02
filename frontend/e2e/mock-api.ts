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
import officialInstances from './fixtures/results-official-instances.json' with { type: 'json' }
import officialSummary from './fixtures/results-official-summary.json' with { type: 'json' }
import pilotInstances from './fixtures/results-pilot-instances.json' with { type: 'json' }
import pilotSummary from './fixtures/results-pilot-summary.json' with { type: 'json' }
import runsFixture from './fixtures/results-runs.json' with { type: 'json' }
import smokeSummary from './fixtures/results-smoke-summary.json' with { type: 'json' }
import v03Instances from './fixtures/results-v03-instances.json' with { type: 'json' }
import secondJudge from './fixtures/results-v03-second-judge.json' with { type: 'json' }
import v03Summary from './fixtures/results-v03-summary.json' with { type: 'json' }
import world from './fixtures/world-shell.json' with { type: 'json' }
import settingsFixture from '../src/test/settings.fixture.json' with { type: 'json' }

/** The captured bank: its instance count (Help shows it) and the repeats of an official run. */
const BANK_INSTANCES = scoredQuestions.length
const REPEATS = 3

/*
 * The shell's demo questions, models, readiness and datasets are a capture of
 * the API (scripts/capture-shell.mjs). The runs are generated with test
 * values (backend/scripts/fixture_official.py and the report tests), and
 * FIXTURE_OFFICIAL below is the whole-bank run Overview's tiles read, so no
 * screenshot shows a result.
 */
const SUMMARY = world.datasets[0]
const READY = world.ready
const RUNS = runsFixture
const DEMO_QUESTIONS = world.demo_questions

/**
 * What GET /settings answers: the API's own answer for a fixed test
 * environment (src/test/settings.fixture.json, written by
 * backend/tests/test_settings_fixture.py), not a capture of the system.
 */
const SETTINGS = settingsFixture

const cell = (mean: number, repeats: number) => ({
  mean,
  n: BANK_INSTANCES,
  repeats,
})

const FIXTURE_SCORE = 0.4

/**
 * Test values, not results: a whole-bank official run, so Overview draws its
 * tiles. The three scores are equal so no screenshot can suggest a result.
 */
/** The same test values for each kind of question, so the Overview chart draws its groups. */
const FIXTURE_KIND = {
  evidence_recall: {
    A: cell(FIXTURE_SCORE, BANK_INSTANCES),
    B: cell(FIXTURE_SCORE, BANK_INSTANCES),
    C: cell(FIXTURE_SCORE, BANK_INSTANCES),
  },
  answer: {
    A: cell(FIXTURE_SCORE, BANK_INSTANCES),
    B: cell(FIXTURE_SCORE, BANK_INSTANCES),
    C: cell(FIXTURE_SCORE, BANK_INSTANCES),
  },
}

const FIXTURE_OFFICIAL = {
  run_id: 'fixture-official',
  run_kind: 'official',
  label: null,
  method_version: '0.3.0',
  summary: {
    bank_version: 'fixture-bank (test value)',
    selection: { strata: null, limit: null },
    headlines: [
      'Fixture headline for the H1 comparison (test values).',
      'Fixture headline for the H2 comparison (test values).',
    ],
    metrics: {
      overall: {
        evidence_recall: {
          A: cell(FIXTURE_SCORE, BANK_INSTANCES * REPEATS),
          B: cell(FIXTURE_SCORE, BANK_INSTANCES * REPEATS),
          C: cell(FIXTURE_SCORE, BANK_INSTANCES * REPEATS),
        },
        answer: {
          A: cell(FIXTURE_SCORE, BANK_INSTANCES * REPEATS),
          B: cell(FIXTURE_SCORE, BANK_INSTANCES * REPEATS),
          C: cell(FIXTURE_SCORE, BANK_INSTANCES * REPEATS),
        },
      },
      H1: FIXTURE_KIND,
      H2: FIXTURE_KIND,
      H5: FIXTURE_KIND,
    },
    // One tested comparison with no difference, so the plain summary line draws.
    comparisons: [
      {
        stratum: 'H1',
        metric: 'evidence_recall',
        comparison: 'B_vs_A',
        n: BANK_INSTANCES,
        clusters: 24,
        mean: 0,
        low: -0.1,
        high: 0.1,
        p: 1,
        p_holm: 1,
        in_family: true,
        reason: 'tested',
      },
    ],
    instances: { total: { overall: BANK_INSTANCES }, per_world: {} },
  },
}

/**
 * What GET /benchmarks/latest answers: the whole-bank official run, the
 * quick check, or the subset run (so Overview says there is no official run yet).
 */
const LATEST = {
  official: FIXTURE_OFFICIAL,
  smoke: smokeSummary,
  none: pilotSummary,
} as const

/**
 * The run list Results sees: as published, with the generated whole-bank run
 * too, with the report tests' whole-bank run as well, with a newer
 * development run on top of those, none, or failing.
 */
export type RunsMode =
  'published' | 'official' | 'v03' | 'dev' | 'none' | 'unavailable' | 'pending'

export type LatestRun = keyof typeof LATEST | 'unavailable' | 'pending'

/**
 * A development run: the report tests' run's numbers under
 * kind "dev" with the label and fixed headline the harness gives that kind
 * (backend/app/evaluation/runner.py, report.py).
 */
const DEV_LABEL = 'development run on seed 2026, not a result'
const DEV_SUMMARY = {
  ...v03Summary,
  run_id: 'fixture-dev',
  run_kind: 'dev',
  label: DEV_LABEL,
  summary: {
    ...v03Summary.summary,
    run_kind: 'dev',
    label: DEV_LABEL,
    headlines: [
      'Development run on seed 2026, not a result: the tables are descriptive and no claim is made.',
    ],
  },
}

/**
 * The runs Results can open, by id: the subset run, the quick check and the
 * whole-bank "Fixture run (test values)" runs. Overview's own official run
 * stays FIXTURE_OFFICIAL above.
 */
const RUN_SUMMARIES: Record<string, unknown> = {
  [pilotSummary.run_id]: pilotSummary,
  [smokeSummary.run_id]: smokeSummary,
  [officialSummary.run_id]: officialSummary,
  [v03Summary.run_id]: v03Summary,
  [DEV_SUMMARY.run_id]: DEV_SUMMARY,
}
const RUN_INSTANCES: Record<string, unknown> = {
  [pilotSummary.run_id]: pilotInstances,
  [officialSummary.run_id]: officialInstances,
  [v03Summary.run_id]: v03Instances,
  [DEV_SUMMARY.run_id]: v03Instances,
}

/** The generated whole-bank run as the run list shows it, newest of all. */
const OFFICIAL_RUN = {
  run_id: officialSummary.run_id,
  run_kind: officialSummary.run_kind,
  label: officialSummary.label,
  method_version: officialSummary.method_version,
  started_at: '2026-10-20T09:00:00+00:00',
  selection: officialSummary.summary.selection,
  worlds: [2026],
  headlines: officialSummary.summary.headlines,
}

/** The report tests' whole-bank run as the run list shows it, newest of all. */
const V03_RUN = {
  run_id: v03Summary.run_id,
  run_kind: v03Summary.run_kind,
  label: v03Summary.label,
  method_version: v03Summary.method_version,
  started_at: '2026-10-20T09:30:00+00:00',
  selection: v03Summary.summary.selection,
  worlds: v03Summary.summary.worlds,
  headlines: v03Summary.summary.headlines,
}

/** The development run as the run list shows it, newest of all. */
const DEV_RUN = {
  ...V03_RUN,
  run_id: DEV_SUMMARY.run_id,
  run_kind: DEV_SUMMARY.run_kind,
  label: DEV_LABEL,
  started_at: '2026-10-20T09:45:00+00:00',
  headlines: DEV_SUMMARY.summary.headlines,
}

/** The models as captured, with a judge, which the capture ran without. */
const MODELS = {
  ...world.models,
  judge: {
    provider: 'fake',
    model: 'fake-judge-v1',
    reachable: true,
    detail: 'fake judge (offline)',
  },
}

const RUN_PREFIX = '/api/v1/benchmarks/'

const ROUTES: Record<string, unknown> = {
  '/api/v1/benchmarks/jobs': [],
  '/api/v1/benchmarks': RUNS,
  '/api/v1/demo/questions': DEMO_QUESTIONS,
  '/api/v1/health/ready': READY,
  '/api/v1/datasets': [SUMMARY],
  [`/api/v1/datasets/${DATASET_ID}`]: world.dataset,
  '/api/v1/models': MODELS,
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
  /** The run list the Results screen sees. */
  runs: RunsMode = 'published',
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
    if (path === '/api/v1/benchmarks' && runs === 'official')
      return route.fulfill(json([OFFICIAL_RUN, ...RUNS]))
    if (path === '/api/v1/benchmarks' && runs === 'v03')
      return route.fulfill(json([V03_RUN, OFFICIAL_RUN, ...RUNS]))
    if (path === '/api/v1/benchmarks' && runs === 'dev')
      return route.fulfill(json([DEV_RUN, V03_RUN, OFFICIAL_RUN, ...RUNS]))
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
    if (path === '/api/v1/settings') return route.fulfill(json(SETTINGS))
    // The bank is scored only when the newest run is a whole-bank official run, as the backend does.
    if (path === '/api/v1/benchmarks/questions')
      return route.fulfill(
        json(latest === 'official' ? scoredQuestions : unscoredQuestions),
      )
    if (path.startsWith(RUN_PREFIX) && path !== '/api/v1/benchmarks/jobs') {
      const [id, part] = path.slice(RUN_PREFIX.length).split('/')
      // No run has a second judge unless a test calls mockSecondJudge.
      if (part === 'second-judge')
        return route.fulfill(
          json(
            {
              error: {
                error_code: 'NOT_FOUND',
                message: 'This run has no second judge.',
                retryable: false,
              },
            },
            404,
          ),
        )
      const table = part === 'instances' ? RUN_INSTANCES : RUN_SUMMARIES
      if (part === undefined || part === 'instances') {
        const answer = table[decodeURIComponent(id)]
        return route.fulfill(
          answer === undefined ? envelope('No such run.', 404) : json(answer),
        )
      }
    }
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

/** The progress a running job reports in the scripts below. */
export const JOB_PROGRESS = {
  world_seed: 2027,
  worlds_done: 1,
  worlds_total: 3,
  instances_done: 12,
  instances_total: 40,
}

type JobState = {
  job_id: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  run_id: string | null
  error: { error_code: string; message: string; retryable: boolean } | null
  progress: typeof JOB_PROGRESS | null
}

/** A running job, as it answers while it works. */
export const RUNNING_JOB: JobState = {
  job_id: 'job-e2e',
  status: 'running',
  run_id: null,
  error: null,
  progress: JOB_PROGRESS,
}

/** The job the script ends with: it published a run the mock already serves. */
export const COMPLETED_JOB: JobState = {
  ...RUNNING_JOB,
  status: 'completed',
  run_id: pilotSummary.run_id,
  progress: null,
}

/**
 * Scripted benchmark jobs, on top of mockApi. `starts` answers each poll in
 * turn (the last one repeats), so a test can walk a job from running to
 * completed. `attached` has the job already running when the screen loads, as
 * after a reload; otherwise POST /benchmarks starts it. The request bodies
 * and the cancel calls are kept for the test to read.
 */
/** What the second-judge route answers for every run: the fixture's second judge, a failing server, or never an answer. */
export type SecondJudgeState = 'ready' | 'error' | 'pending'

/** Answers GET /benchmarks/{run_id}/second-judge, after mockApi, with the fixture's second judge (test values). */
export async function mockSecondJudge(page: Page, state: SecondJudgeState) {
  await page.route('**/api/v1/benchmarks/*/second-judge', async (route) => {
    if (state === 'pending') return new Promise<void>(() => undefined)
    if (state === 'error')
      return route.fulfill(envelope('The second judge is unavailable.', 503))
    return route.fulfill(json(secondJudge))
  })
}

export async function mockJobs(
  page: Page,
  { script, attached = false }: { script: JobState[]; attached?: boolean },
) {
  const seen = { started: [] as unknown[], cancels: 0, polls: 0 }
  await page.route('**/api/v1/benchmarks/jobs**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/v1/benchmarks/jobs')
      return route.fulfill(json(attached ? [script[0]] : []))
    if (path.endsWith('/cancel')) {
      seen.cancels += 1
      return route.fulfill(json(script[0], 202))
    }
    seen.polls += 1
    return route.fulfill(json(script[Math.min(seen.polls, script.length - 1)]))
  })
  await page.route(
    (url) => url.pathname === '/api/v1/benchmarks',
    async (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      seen.started.push(route.request().postDataJSON())
      return route.fulfill(json(script[0], 202))
    },
  )
  return seen
}
