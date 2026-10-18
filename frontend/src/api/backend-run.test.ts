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

const RESULTS = {
  run_id: 'RUN-TEST',
  question: 'test question',
  status: 'completed',
  configurations: ['A', 'C'],
  error: null,
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
              id: 'DEMO-01',
              question: 'Saved question one',
              category: 'x',
              benchmark_question_id: 'Q30',
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

  it('omits the evaluation event without a published benchmark match', async () => {
    const run = await runBackendQuestion({
      id: 'X',
      question: 'test question',
      category: 'x',
    })
    expect(run.evaluation).toEqual([])
  })

  it('carries published benchmark scores when the question matches', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith('/queries'))
          return Promise.resolve(jsonResponse({ run_id: 'RUN-TEST' }))
        if (url.endsWith('/events'))
          return Promise.resolve(jsonResponse(EVENTS))
        if (url.endsWith('/benchmarks/latest'))
          return Promise.resolve(
            jsonResponse({
              questions: [
                {
                  question_id: 'Q25',
                  scores: {
                    A: {
                      answer_score: 0.0,
                      evidence_recall: 0.17,
                      evidence_precision: 0.06,
                    },
                    C: {
                      answer_score: 1.0,
                      evidence_recall: 0.83,
                      evidence_precision: 0.14,
                    },
                  },
                },
              ],
            }),
          )
        return Promise.resolve(jsonResponse(RESULTS))
      }),
    )
    const run = await runBackendQuestion({
      id: 'X',
      question: 'test question',
      category: 'x',
      benchmarkQuestionId: 'Q25',
    })
    expect(run.evaluation).toHaveLength(1)
    const scores =
      run.evaluation[0].kind === 'evaluation_completed'
        ? run.evaluation[0].scores
        : null
    expect(scores?.correctness).toEqual({ baseline: 0, graph: 1 })
    expect(scores?.evidenceRecall).toEqual({ baseline: 0.17, graph: 0.83 })
  })

  it('surfaces backend failures as errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith('/queries'))
          return Promise.resolve(jsonResponse({ run_id: 'RUN-TEST' }))
        if (url.endsWith('/events'))
          return Promise.resolve(jsonResponse(EVENTS))
        return Promise.resolve(
          jsonResponse({
            ...RESULTS,
            status: 'failed',
            error: {
              error_code: 'MODEL_ERROR',
              message: 'provider unreachable',
            },
          }),
        )
      }),
    )
    await expect(
      runBackendQuestion({ id: 'X', question: 'test question', category: 'x' }),
    ).rejects.toThrow('provider unreachable')
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
})

describe('fetchDemoQuestions', () => {
  it('maps the fixed demo configuration', async () => {
    const questions = await fetchDemoQuestions()
    expect(questions[0]).toMatchObject({
      id: 'DEMO-01',
      question: 'Saved question one',
      benchmarkQuestionId: 'Q30',
    })
  })
})
