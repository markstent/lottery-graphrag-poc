/**
 * Backend run mapper tests: a recorded backend run (docs/07 events plus
 * result DTOs) maps onto the MockRun playback shape with correct ordering,
 * answer attachment and honest evaluation handling.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

import {
  fetchBenchmarkResults,
  fetchDemoQuestions,
  mapBenchmarkResults,
  runBackendQuestion,
} from './backend-run'
import { projectRag } from '../mock/telemetry'

const EVENTS = {
  run_id: 'RUN-TEST',
  status: 'completed',
  events: [
    {
      sequence: 1,
      event_type: 'rag.query.received',
      pipeline: 'A',
      t_ms: 0,
      payload: {},
    },
    {
      sequence: 2,
      event_type: 'rag.embedding.completed',
      pipeline: 'A',
      t_ms: 40,
      payload: { model: 'hashing-256', dimensions: 256 },
    },
    {
      sequence: 3,
      event_type: 'rag.candidate.retrieved',
      pipeline: 'A',
      t_ms: 80,
      payload: {
        chunk_id: 'CHNK_1',
        document_id: 'DOC_1',
        similarity: 0.71,
        rank: 1,
      },
    },
    {
      sequence: 4,
      event_type: 'rag.evidence.selected',
      pipeline: 'A',
      t_ms: 90,
      payload: { chunk_id: 'CHNK_1', rank: 1 },
    },
    {
      sequence: 5,
      event_type: 'rag.context.assembled',
      pipeline: 'A',
      t_ms: 95,
      payload: { selected: 1, discarded: 0, context_tokens: 120 },
    },
    {
      sequence: 6,
      event_type: 'rag.generation.completed',
      pipeline: 'A',
      t_ms: 140,
      payload: { model: 'fake-answer-v1' },
    },
    {
      sequence: 7,
      event_type: 'graph.entity.resolved',
      pipeline: 'C',
      t_ms: 10,
      payload: {
        entity_id: 'GAME_UK_01',
        node_label: 'Game',
        origin: 'id',
        matched_text: 'GAME_UK_01',
      },
    },
    {
      sequence: 8,
      event_type: 'graph.relationship.traversed',
      pipeline: 'C',
      t_ms: 60,
      payload: {
        from_id: 'GAME_UK_01',
        relationship_type: 'RUNS_ON',
        to_id: 'PLAT_UK',
        to_label: 'Platform UK',
        hop: 1,
      },
    },
    {
      sequence: 9,
      event_type: 'graph.context.assembled',
      pipeline: 'C',
      t_ms: 150,
      payload: { selected: 1, context_tokens: 300 },
    },
  ],
}

const LIVE_SCORE = {
  instance_id: 'L05-2026-INC_S007_GR',
  label: 'scored against the answer key',
  per_pipeline: {
    A: {
      answer: 0,
      evidence_f1: 0.5,
      anchor_resolution: 1,
      failure_class: 'generation_failure',
    },
    C: {
      answer: 1,
      evidence_f1: null,
      anchor_resolution: 1,
      failure_class: null,
    },
  },
}

const FAILURE = {
  error_code: 'MODEL_ERROR',
  message: 'The language model could not produce an answer.',
  retryable: true,
}

const RESULTS = {
  run_id: 'RUN-TEST',
  question: 'test question',
  status: 'completed',
  configurations: ['A', 'C'],
  pipeline_status: { A: 'completed', C: 'completed' },
  error: null,
  answer_key: 'none',
  score_status: 'not_applicable',
  score_failure: null,
  score: null,
  results: {
    A: {
      answer: {
        text: 'The sources do not state this.',
        model: 'fake-answer-v1',
        latency_ms: 140,
        context_tokens: 120,
        citations: [],
      },
      evidence: [
        {
          chunk_id: 'CHNK_1',
          document_id: 'DOC_1',
          title: 'Game Rules: draw times and prize tiers',
          similarity: 0.71,
          selected: true,
          source_system: 'document_store',
        },
      ],
    },
    C: {
      answer: {
        text: 'GAME_UK_01 runs on PLAT_UK.',
        model: 'fake-answer-v1',
        latency_ms: 300,
        context_tokens: 300,
        citations: [
          {
            chunk_id: 'CHNK_1',
            document_id: 'DOC_1',
            title: 'Game Rules',
            source_system: 'document_store',
            source_record_id: 'DOC_1',
            market_id: 'UK',
            language_code: 'en',
          },
        ],
      },
      node_evidence: [
        {
          node_id: 'GAME_UK_01',
          node_label: 'Aegean Gold UK',
          hops: 0,
          rel_type: 'SEED',
          selected: true,
        },
        {
          node_id: 'PLAT_UK',
          node_label: 'Platform UK',
          hops: 1,
          rel_type: 'RUNS_ON',
          selected: true,
        },
      ],
    },
  },
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/queries')) {
        return Promise.resolve(jsonResponse({ run_id: 'RUN-TEST' }))
      }
      if (url.endsWith('/events')) return Promise.resolve(jsonResponse(EVENTS))
      if (url.endsWith('/benchmarks/latest'))
        return Promise.resolve(jsonResponse({ questions: [] }))
      if (url.endsWith('/demo/questions'))
        return Promise.resolve(
          jsonResponse([
            {
              instance_id: 'L05-2026-INC_S007_GR',
              question_id: 'L05',
              text: 'Saved question one',
              stratum: 'H1',
              market_scope: [],
            },
          ]),
        )
      return Promise.resolve(jsonResponse(RESULTS))
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('runBackendQuestion', () => {
  it('sends the market scope with the query request', async () => {
    await runBackendQuestion(
      { id: 'X', question: 'test question', category: 'x' },
      ['MKT_GR', 'MKT_AT'],
    )
    const fetchMock = vi.mocked(fetch)
    const post = fetchMock.mock.calls.find(([input]) =>
      String(input).endsWith('/queries'),
    )
    const init = post?.[1] as RequestInit | undefined
    expect(JSON.parse(String(init?.body)).market_scope).toEqual([
      'MKT_GR',
      'MKT_AT',
    ])
  })

  it('never sends the retired profile field', async () => {
    await runBackendQuestion({
      id: 'X',
      question: 'test question',
      category: 'x',
    })
    const post = vi
      .mocked(fetch)
      .mock.calls.find(([input]) => String(input).endsWith('/queries'))
    const init = post?.[1] as RequestInit | undefined
    expect(JSON.parse(String(init?.body))).not.toHaveProperty('profile')
  })

  it('reads the events only once the run is final', async () => {
    let polls = 0
    const order: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith('/queries'))
          return Promise.resolve(jsonResponse({ run_id: 'RUN-TEST' }))
        if (url.endsWith('/events')) {
          order.push('events')
          return Promise.resolve(jsonResponse(EVENTS))
        }
        if (url.endsWith('/benchmarks/latest'))
          return Promise.resolve(jsonResponse({ questions: [] }))
        polls += 1
        order.push(polls === 1 ? 'running' : 'completed')
        return Promise.resolve(
          jsonResponse(
            polls === 1
              ? { ...RESULTS, status: 'running', results: {} }
              : RESULTS,
          ),
        )
      }),
    )
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    try {
      const pending = runBackendQuestion({
        id: 'X',
        question: 'test question',
        category: 'x',
      })
      await vi.runAllTimersAsync()
      await pending
    } finally {
      vi.useRealTimers()
    }
    expect(order).toEqual(['running', 'completed', 'events'])
  })

  it('maps a recorded run into the playback shape', async () => {
    const run = await runBackendQuestion({
      id: 'X',
      question: 'test question',
      category: 'x',
    })
    expect(run.runId).toBe('RUN-TEST')
    expect(run.rag[0]).toEqual({ kind: 'query_received', t: 0 })
    const candidates = run.rag.find(
      (event) => event.kind === 'candidates_retrieved',
    )
    expect(
      candidates &&
        candidates.kind === 'candidates_retrieved' &&
        candidates.chunks[0],
    ).toMatchObject({
      id: 'CHNK_1',
      title: 'Game Rules: draw times and prize tiers',
      selected: true,
    })
    expect(run.rag.at(-1)?.kind).toBe('answer_completed')
    expect(
      run.graph.some((event) => event.kind === 'relationship_traversed'),
    ).toBe(true)
    // Graph pane projector must accept the mapped stream.
    expect(() => projectRag(run.rag)).not.toThrow()
  })

  it('uses the graph answer for the shared answer block', async () => {
    const run = await runBackendQuestion({
      id: 'X',
      question: 'test question',
      category: 'x',
    })
    const completed = run.rag.at(-1)
    expect(
      completed &&
        completed.kind === 'answer_completed' &&
        completed.answer.text,
    ).toBe('GAME_UK_01 runs on PLAT_UK.')
    expect(
      completed &&
        completed.kind === 'answer_completed' &&
        completed.answer.citations[0]?.label,
    ).toBe('Game Rules')
  })

  it('asks a bank question by its instance id', async () => {
    await runBackendQuestion({
      id: 'L05',
      question: 'Saved question one',
      category: 'H1',
      instanceId: 'L05-2026-INC_S007_GR',
    })
    const post = vi
      .mocked(fetch)
      .mock.calls.find(([input]) => String(input).endsWith('/queries'))
    const init = post?.[1] as RequestInit | undefined
    expect(JSON.parse(String(init?.body))).toMatchObject({
      question: 'Saved question one',
      benchmark_instance_id: 'L05-2026-INC_S007_GR',
    })
  })

  it('does not wait for a score that failed', async () => {
    let polls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith('/queries'))
          return Promise.resolve(jsonResponse({ run_id: 'RUN-TEST' }))
        if (url.endsWith('/events'))
          return Promise.resolve(jsonResponse(EVENTS))
        polls += 1
        return Promise.resolve(
          jsonResponse({
            ...RESULTS,
            answer_key: 'available',
            score_status: 'failed',
            score: null,
          }),
        )
      }),
    )
    const run = await runBackendQuestion({
      id: 'L05',
      question: 'Saved question one',
      category: 'H1',
      instanceId: 'L05-2026-INC_S007_GR',
    })
    expect(polls).toBe(1)
    expect(run.scoreStatus).toBe('failed')
  })

  it('runs a bank question with its own scope, not the selected markets', async () => {
    await runBackendQuestion(
      {
        id: 'L05',
        question: 'Saved question one',
        category: 'H1',
        instanceId: 'L05-2026-INC_S007_GR',
        marketScope: [],
      },
      ['MKT_GR'],
    )
    const post = vi
      .mocked(fetch)
      .mock.calls.find(([input]) => String(input).endsWith('/queries'))
    const init = post?.[1] as RequestInit | undefined
    expect(JSON.parse(String(init?.body)).market_scope).toEqual([])
  })

  it('states that an ad hoc question has no answer key and no score', async () => {
    const run = await runBackendQuestion({
      id: 'X',
      question: 'test question',
      category: 'x',
    })
    const post = vi
      .mocked(fetch)
      .mock.calls.find(([input]) => String(input).endsWith('/queries'))
    const init = post?.[1] as RequestInit | undefined
    expect(JSON.parse(String(init?.body))).not.toHaveProperty(
      'benchmark_instance_id',
    )
    expect(run.answerKey).toBe('none')
    expect(run.scoreStatus).toBe('not_applicable')
    expect(run.liveScore).toBeNull()
    expect(run.evaluation).toEqual([])
  })

  it('waits for the score a bank question gets after it completes', async () => {
    let polls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith('/queries'))
          return Promise.resolve(jsonResponse({ run_id: 'RUN-TEST' }))
        if (url.endsWith('/events'))
          return Promise.resolve(jsonResponse(EVENTS))
        polls += 1
        return Promise.resolve(
          jsonResponse({
            ...RESULTS,
            answer_key: 'available',
            score_status: polls === 1 ? 'pending' : 'scored',
            score: polls === 1 ? null : LIVE_SCORE,
          }),
        )
      }),
    )
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    try {
      const pending = runBackendQuestion({
        id: 'L05',
        question: 'Saved question one',
        category: 'H1',
        instanceId: 'L05-2026-INC_S007_GR',
      })
      await vi.runAllTimersAsync()
      const run = await pending
      expect(polls).toBe(2)
      expect(run.answerKey).toBe('available')
      expect(run.scoreStatus).toBe('scored')
      expect(run.liveScore).toEqual(LIVE_SCORE)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops waiting for a score still pending after the cap', async () => {
    let polls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith('/queries'))
          return Promise.resolve(jsonResponse({ run_id: 'RUN-TEST' }))
        if (url.endsWith('/events'))
          return Promise.resolve(jsonResponse(EVENTS))
        polls += 1
        return Promise.resolve(
          jsonResponse({
            ...RESULTS,
            answer_key: 'available',
            score_status: 'pending',
            score: null,
          }),
        )
      }),
    )
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    try {
      const pending = runBackendQuestion({
        id: 'L05',
        question: 'Saved question one',
        category: 'H1',
        instanceId: 'L05-2026-INC_S007_GR',
      })
      await vi.runAllTimersAsync()
      const run = await pending
      // The final poll plus eight more, 250 ms apart: a 2 s cap.
      expect(polls).toBe(9)
      expect(run.scoreStatus).toBe('pending')
      expect(run.liveScore).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('surfaces backend failures as errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith('/queries'))
          return Promise.resolve(jsonResponse({ run_id: 'RUN-TEST' }))
        if (url.endsWith('/events'))
          return Promise.resolve(
            jsonResponse({
              ...EVENTS,
              status: 'failed',
              events: [
                ...EVENTS.events,
                {
                  sequence: 10,
                  run_id: 'RUN-TEST',
                  event_type: 'run.failed',
                  pipeline: 'run',
                  t_ms: 160,
                  payload: FAILURE,
                },
              ],
            }),
          )
        return Promise.resolve(
          jsonResponse({
            ...RESULTS,
            status: 'failed',
            // A different message: the thrown one must come from run.failed.
            error: { ...FAILURE, message: 'results envelope message' },
          }),
        )
      }),
    )
    await expect(
      runBackendQuestion({ id: 'X', question: 'test question', category: 'x' }),
    ).rejects.toThrow('The language model could not produce an answer.')
  })

  it('surfaces the envelope message of a rejected query', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              error: {
                error_code: 'CONFLICT',
                message:
                  'a benchmark run is using the graph; try again when it finishes',
                retryable: true,
              },
            }),
            { status: 409, headers: { 'content-type': 'application/json' } },
          ),
        ),
      ),
    )
    await expect(
      runBackendQuestion({ id: 'X', question: 'test question', category: 'x' }),
    ).rejects.toThrow(
      'a benchmark run is using the graph; try again when it finishes',
    )
  })

  it('falls back to the status when a rejection has no envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response('gateway down', { status: 502 })),
      ),
    )
    await expect(
      runBackendQuestion({ id: 'X', question: 'test question', category: 'x' }),
    ).rejects.toThrow('query rejected (502)')
  })

  it('surfaces a cancelled run as an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith('/queries'))
          return Promise.resolve(jsonResponse({ run_id: 'RUN-TEST' }))
        if (url.endsWith('/events'))
          return Promise.resolve(jsonResponse(EVENTS))
        return Promise.resolve(
          jsonResponse({ ...RESULTS, status: 'cancelled' }),
        )
      }),
    )
    await expect(
      runBackendQuestion({ id: 'X', question: 'test question', category: 'x' }),
    ).rejects.toThrow('backend run was cancelled')
  })
})

describe('mapBenchmarkResults', () => {
  const PAYLOAD = {
    run_id: 'run-2026-10-09',
    reproducibility: {},
    questions: [],
    summary: {
      total: 30,
      scored: 22,
      pipelines: {
        A: {
          n: 22,
          answer: 0.41,
          recall: 0.04,
          precision: 0.09,
          latency_ms: 1200,
          context_tokens: 1800,
        },
        B: {
          n: 22,
          answer: 0.64,
          recall: 0.62,
          precision: 0.31,
          latency_ms: 2100,
          context_tokens: 2600,
        },
        C: {
          n: 22,
          answer: 0.66,
          recall: 0.65,
          precision: 0.33,
          latency_ms: 2300,
          context_tokens: 2800,
        },
      },
      categories: [
        {
          category: 'CROSS_MARKET',
          difficulty: 6,
          n: 4,
          answer: { A: 0.25, B: 0.5, C: 0.75 },
          recall: { A: 0.05, B: 0.6, C: 0.7 },
        },
      ],
      failures: [
        {
          question_id: 'Q06',
          category: 'ONTOLOGY',
          pipeline: 'A',
          failure_class: 'not_grounded_answer',
        },
      ],
      unscored: [
        {
          question_id: 'Q17',
          category: 'CROSS_DOMAIN',
          status: 'not_planted',
          note: 'scenario SCN-002 not planted',
        },
      ],
    },
  }

  it('maps the published summary onto the dashboard shape', () => {
    const results = mapBenchmarkResults(PAYLOAD)
    expect(results.benchmarkRunId).toBe('run-2026-10-09')
    expect(results.questions).toBe(30)
    expect(results.overview.correctness).toEqual([0.41, 0.64, 0.66])
    expect(results.overview.evidenceRecall).toEqual([0.04, 0.62, 0.65])
    expect(results.overview.grounding).toEqual([0.09, 0.31, 0.33])
    expect(results.byComplexity[0]).toEqual({
      level: 'D6',
      label: 'cross market',
      baseline: 0.25,
      graphRelationships: 0.5,
      graphOntology: 0.75,
    })
    expect(results.efficiency.latencyMs).toEqual([1200, 2100, 2300])
    // Scored failures carry their pipeline; unscored questions are listed
    // as not scored rather than attributed to a pipeline.
    expect(results.failures[0]).toMatchObject({
      questionId: 'Q06',
      pipeline: 'A',
    })
    expect(results.failures[1]).toMatchObject({
      questionId: 'Q17',
      note: 'scenario SCN-002 not planted',
    })
    expect(results.failures[1].pipeline).toBeUndefined()
    expect(results.byMarket).toEqual([])
  })

  it('rejects runs without a published summary', () => {
    expect(() => mapBenchmarkResults({ ...PAYLOAD, summary: null })).toThrow(
      'no published summary',
    )
  })
})

describe('fetchBenchmarkResults', () => {
  it('returns null when no benchmark run is published', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('not found', { status: 404 }))),
    )
    expect(await fetchBenchmarkResults()).toBeNull()
  })

  it('maps a v1 run onto the dashboard shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse({
            run_id: 'run-v1',
            summary: {
              total: 0,
              scored: 0,
              pipelines: {},
              categories: [],
              failures: [],
              unscored: [],
            },
          }),
        ),
      ),
    )
    const published = await fetchBenchmarkResults()
    expect(published?.schema).toBe('v1')
  })

  it('returns a v2 run as a notice with its kind, label and headlines', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse({
            run_id: 'official-1',
            run_kind: 'official',
            label: null,
            summary: { schema_version: '2', headlines: ['One line.'] },
          }),
        ),
      ),
    )
    expect(await fetchBenchmarkResults()).toEqual({
      schema: 'v2',
      notice: {
        runId: 'official-1',
        runKind: 'official',
        label: null,
        headlines: ['One line.'],
      },
    })
  })
})

describe('fetchDemoQuestions', () => {
  it('maps the bank instances the backend serves', async () => {
    const questions = await fetchDemoQuestions()
    expect(questions).toEqual([
      {
        id: 'L05',
        question: 'Saved question one',
        category: 'H1',
        instanceId: 'L05-2026-INC_S007_GR',
        marketScope: [],
      },
    ])
  })
})
