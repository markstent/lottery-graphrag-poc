/**
 * The typed client over deterministic fetch stubs: the envelope becomes an
 * ApiError, anything else a plain one, and every route group sends the right
 * method, URL and query.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as client from './client'
import { ApiError, NO_ANSWER_MESSAGE, TIMEOUT_MESSAGE } from './http'

const fetchMock = vi.fn()

function reply(
  status: number,
  body: unknown,
  contentType = 'application/json',
) {
  fetchMock.mockResolvedValueOnce(
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': contentType },
    }),
  )
}

function lastCall(): {
  url: string
  method: string
  body: unknown
  signal: AbortSignal
} {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit]
  return {
    url,
    method: init.method ?? 'GET',
    body: init.body === undefined ? undefined : JSON.parse(init.body as string),
    signal: init.signal as AbortSignal,
  }
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('failures', () => {
  it('surfaces the envelope message and offers retry on a retryable conflict', async () => {
    const message =
      'a benchmark run is using the graph; try again when it finishes'
    reply(409, { error: { error_code: 'CONFLICT', message, retryable: true } })
    await expect(
      client.startQuery({ question: 'q', configurations: ['A'] }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      retryable: true,
      message,
      status: 409,
    })
  })

  it('a non-envelope failure becomes a plain message, never a raw body', async () => {
    reply(502, '<html><body>Bad Gateway nginx/1.25</body></html>', 'text/html')
    const failure = await client.getModels().catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(ApiError)
    expect(failure).toMatchObject({
      code: 'RUN_ERROR',
      message: NO_ANSWER_MESSAGE,
      status: 502,
    })
    expect((failure as ApiError).message).not.toContain('nginx')
  })

  it('a network failure is the same plain message', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(client.getModels()).rejects.toMatchObject({
      code: 'RUN_ERROR',
      message: NO_ANSWER_MESSAGE,
      status: 0,
    })
  })

  it('a JSON body that is not the envelope is not trusted either', async () => {
    reply(500, { detail: 'Traceback: secret' })
    await expect(client.getModels()).rejects.toMatchObject({
      message: NO_ANSWER_MESSAGE,
    })
  })
})

describe('timeouts and abort', () => {
  function hang() {
    fetchMock.mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          )
        }),
    )
  }

  it('a timeout aborts and reports it plainly', async () => {
    vi.useFakeTimers()
    hang()
    const result = client.getModels().catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await result).toMatchObject({
      code: 'RUN_ERROR',
      message: TIMEOUT_MESSAGE,
    })
    expect(lastCall().signal.aborted).toBe(true)
  })

  it('starting a run waits 15 seconds, not 10', async () => {
    vi.useFakeTimers()
    hang()
    const result = client
      .startQuery({ question: 'q', configurations: ['A'] })
      .catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(14_999)
    expect(lastCall().signal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await result).toMatchObject({ message: TIMEOUT_MESSAGE })
  })

  it('the caller aborting is not a server failure and rethrows the abort', async () => {
    hang()
    const controller = new AbortController()
    const result = client.getModels(controller.signal)
    controller.abort()
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('request encoding', () => {
  it('query parameters are encoded and bounded values pass through', async () => {
    reply(200, { table: 't', rows: [] })
    const page = await client.getRows('DS 1', 'players', {
      limit: 200,
      offset: 0,
      column: 'name',
      value: 'a&b',
    })
    expect(page.table).toBe('t')
    expect(lastCall()).toMatchObject({
      method: 'GET',
      url: '/api/v1/datasets/DS%201/tables/players/rows?limit=200&offset=0&column=name&value=a%26b',
    })
  })

  it('omits parameters that are undefined', async () => {
    reply(200, [])
    await client.getConceptMembers('C-1')
    expect(lastCall().url).toBe('/api/v1/ontology/concepts/C-1/members')
  })

  it('sends a JSON body with its content type', async () => {
    reply(202, { run_id: 'RUN-1' })
    await client.startQuery({ question: 'q', configurations: ['A', 'B'] })
    const [, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit]
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(lastCall()).toMatchObject({
      method: 'POST',
      url: '/api/v1/queries',
      body: { question: 'q', configurations: ['A', 'B'] },
    })
  })
})

describe('route groups', () => {
  const cases: [string, () => Promise<unknown>, string, string][] = [
    [
      'runs: list',
      () => client.listRuns({ limit: 5, status: 'completed' }),
      'GET',
      '/api/v1/queries?limit=5&status=completed',
    ],
    ['runs: get', () => client.getRun('RUN-1'), 'GET', '/api/v1/queries/RUN-1'],
    [
      'runs: cancel',
      () => client.cancelRun('RUN-1'),
      'POST',
      '/api/v1/queries/RUN-1/cancel',
    ],
    [
      'runs: events',
      () => client.getRunEvents('RUN-1'),
      'GET',
      '/api/v1/queries/RUN-1/events',
    ],
    [
      'runs: demo questions',
      () => client.getDemoQuestions(),
      'GET',
      '/api/v1/demo/questions',
    ],
    [
      'reference: ontology',
      () => client.getOntology(),
      'GET',
      '/api/v1/ontology',
    ],
    [
      'reference: members',
      () => client.getConceptMembers('C 1', 'UK'),
      'GET',
      '/api/v1/ontology/concepts/C%201/members?market=UK',
    ],
    [
      'reference: scenarios',
      () => client.getScenarios(),
      'GET',
      '/api/v1/scenarios',
    ],
    ['reference: models', () => client.getModels(), 'GET', '/api/v1/models'],
    ['health: health', () => client.getHealth(), 'GET', '/api/v1/health'],
    ['data: datasets', () => client.listDatasets(), 'GET', '/api/v1/datasets'],
    [
      'data: dataset',
      () => client.getDataset('DS'),
      'GET',
      '/api/v1/datasets/DS',
    ],
    [
      'data: dictionary',
      () => client.getDictionary('DS'),
      'GET',
      '/api/v1/datasets/DS/dictionary',
    ],
    [
      'data: record',
      () => client.getRecord('DS', 'players', 'P/1'),
      'GET',
      '/api/v1/datasets/DS/tables/players/rows/P%2F1',
    ],
    [
      'graph: schema',
      () => client.getGraphSchema(),
      'GET',
      '/api/v1/graph/schema',
    ],
    [
      'graph: stats',
      () => client.getGraphStats(),
      'GET',
      '/api/v1/graph/stats',
    ],
    [
      'graph: node',
      () => client.getNode('N-1'),
      'GET',
      '/api/v1/graph/nodes/N-1',
    ],
    [
      'graph: neighbours',
      () => client.getNeighbours('N-1', { limit: 25, type: 'OPERATES' }),
      'GET',
      '/api/v1/graph/nodes/N-1/neighbours?limit=25&type=OPERATES',
    ],
    [
      'benchmarks: list',
      () => client.listBenchmarks(),
      'GET',
      '/api/v1/benchmarks',
    ],
    [
      'benchmarks: latest',
      () => client.getLatestBenchmark(),
      'GET',
      '/api/v1/benchmarks/latest',
    ],
    [
      'benchmarks: one',
      () => client.getBenchmark('R-1'),
      'GET',
      '/api/v1/benchmarks/R-1',
    ],
    [
      'benchmarks: questions',
      () => client.getBenchmarkQuestions('R-1'),
      'GET',
      '/api/v1/benchmarks/questions?run_id=R-1',
    ],
    [
      'benchmarks: start',
      () => client.startBenchmark({ kind: 'smoke', repeats: 1, seeds: [1] }),
      'POST',
      '/api/v1/benchmarks',
    ],
    [
      'benchmarks: job',
      () => client.getJob('JOB-1'),
      'GET',
      '/api/v1/benchmarks/jobs/JOB-1',
    ],
    [
      'benchmarks: cancel job',
      () => client.cancelJob('JOB-1'),
      'POST',
      '/api/v1/benchmarks/jobs/JOB-1/cancel',
    ],
  ]

  it.each(cases)(
    '%s sends the method and URL the contract names',
    async (_name, run, method, url) => {
      reply(200, {})
      await run()
      expect(lastCall()).toMatchObject({ method, url })
    },
  )

  it('readiness treats 503 as its own answer, not an error', async () => {
    reply(503, { ready: false, checks: {} })
    await expect(client.getReadiness()).resolves.toMatchObject({ ready: false })
  })
})
