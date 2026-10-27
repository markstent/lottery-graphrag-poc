/**
 * The run reducer over a recorded A, B, C run (fixtures/run-abc.json, captured
 * from the API with the fake generator) and small hand-built streams for the
 * terminal, failure and unknown-event cases.
 */

import { describe, expect, it } from 'vitest'

import fixture from './fixtures/run-abc.json'
import { initialRunState, reduce, reduceAll, type RunEvent } from './reduce'
import type { RunState } from './reduce'

const recorded = fixture.events as unknown as RunEvent[]

function event(
  sequence: number,
  event_type: string,
  pipeline: string,
  payload: object = {},
  t_ms = sequence,
): RunEvent {
  return {
    event_id: `e${sequence}`,
    timestamp: '2026-01-01T10:00:00+00:00',
    run_id: 'RUN-TEST',
    pipeline,
    event_type,
    t_ms,
    payload,
    sequence,
  } as unknown as RunEvent
}

const CANCELLED = {
  error_code: 'CANCELLED',
  message: 'The run was cancelled.',
  retryable: true,
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}

type Payloads = { [E in RunEvent as E['event_type']]: E['payload'] }

function firstPayload<T extends keyof Payloads>(type: T): Payloads[T] {
  const found = recorded.find((e) => e.event_type === type)
  if (found === undefined) throw new Error(`the fixture has no ${type}`)
  return found.payload as Payloads[T]
}

const count = (type: string, pipeline?: string) =>
  recorded.filter(
    (e) => e.event_type === type && (pipeline ? e.pipeline === pipeline : true),
  ).length

describe('the recorded run', () => {
  const state = reduceAll(recorded)

  it('completes every pipeline and the run', () => {
    expect(state.status).toBe('completed')
    expect(state.error).toBeNull()
    expect(state.lastSequence).toBe(recorded.at(-1)?.sequence)
    for (const id of ['A', 'B', 'C'] as const) {
      expect(state.pipelines[id].status).toBe('completed')
      expect(state.pipelines[id].error).toBeNull()
    }
    expect(state.unknown).toEqual({ count: 0, events: [] })
  })

  it('keeps pipeline A candidates, selection and discards as the events gave them', () => {
    const a = state.pipelines.A
    expect(a.candidates).toHaveLength(count('rag.candidate.retrieved'))
    expect(a.selected).toHaveLength(count('rag.evidence.selected'))
    expect(a.discarded).toHaveLength(count('rag.evidence.discarded'))
    expect(a.candidates.every((c) => c.rerankScore !== null)).toBe(true)
    const first = firstPayload('rag.candidate.retrieved')
    expect(a.candidates[0]).toMatchObject({
      id: first.chunk_id,
      similarity: first.similarity,
    })
  })

  it('walks the stages of A and of the graph pipelines in order', () => {
    expect(Object.keys(state.pipelines.A.stages)).toEqual([
      'embedding',
      'search',
      'rerank',
      'context',
      'generation',
    ])
    expect(Object.keys(state.pipelines.B.stages)).toEqual([
      'resolution',
      'traversal',
      'rerank',
      'context',
      'generation',
    ])
    // C also records the query expansion and the ontology's linked records.
    expect(Object.keys(state.pipelines.C.stages)).toEqual([
      'resolution',
      'expansion',
      'traversal',
      'linking',
      'rerank',
      'context',
      'generation',
    ])
    for (const id of ['A', 'B', 'C'] as const) {
      for (const stage of Object.values(state.pipelines[id].stages)) {
        expect(stage?.status).toBe('completed')
        expect(stage?.endedMs).toBeGreaterThanOrEqual(
          stage?.startedMs ?? Infinity,
        )
      }
    }
  })

  it('records each answer from its generation event', () => {
    const first = firstPayload('rag.generation.completed')
    expect(state.pipelines.A.answer).toEqual({
      model: first.model,
      latencyMs: first.latency_ms,
      contextTokens: first.context_tokens,
      verdict: first.verdict,
      citedBlocks: first.cited_blocks,
    })
    expect(state.pipelines.B.answer).not.toBeNull()
    expect(state.pipelines.C.answer).not.toBeNull()
  })

  it('gives B and C a graph with every discovered node, edge and outcome', () => {
    for (const id of ['B', 'C'] as const) {
      const graph = state.graph[id]
      const discovered = new Set(
        recorded
          .filter(
            (e) =>
              e.pipeline === id && e.event_type === 'graph.node.discovered',
          )
          .map((e) =>
            e.event_type === 'graph.node.discovered' ? e.payload.node_id : '',
          ),
      )
      const seeds = recorded.filter(
        (e) => e.pipeline === id && e.event_type === 'graph.seed.selected',
      )
      expect(graph.relationships).toHaveLength(
        count('graph.relationship.traversed', id),
      )
      expect(graph.entities).toHaveLength(count('graph.entity.resolved', id))
      expect(graph.concepts).toHaveLength(count('graph.ontology.expanded', id))
      expect(graph.nodes.filter((n) => n.seed)).toHaveLength(seeds.length)
      for (const node of graph.nodes) {
        if (!node.seed) expect(discovered.has(node.id)).toBe(true)
      }
      const nodeOutcome = (type: string) =>
        recorded.filter(
          (e) =>
            e.pipeline === id &&
            e.event_type === type &&
            'node_id' in (e.payload as object),
        ).length
      expect(graph.nodes.filter((n) => n.outcome === 'selected')).toHaveLength(
        nodeOutcome('graph.candidate.selected'),
      )
      expect(graph.nodes.filter((n) => n.outcome === 'discarded')).toHaveLength(
        nodeOutcome('graph.candidate.discarded'),
      )
    }
    expect(state.graph.B.concepts).toEqual([])
    expect(state.graph.C.concepts.length).toBeGreaterThan(0)
  })

  it('keeps what the evidence path event recorded, per graph pipeline', () => {
    for (const id of ['B', 'C'] as const) {
      const recordedPath = recorded.find(
        (e) =>
          e.pipeline === id && e.event_type === 'graph.evidence_path.completed',
      )
      expect(recordedPath).toBeDefined()
      const payload = recordedPath?.payload as {
        paths: number
        max_hops: number
      }
      expect(state.graph[id].evidencePath).toEqual({
        paths: payload.paths,
        maxHops: payload.max_hops,
      })
    }
    expect(reduceAll([]).graph.B.evidencePath).toBeNull()
  })

  it('keeps document outcomes of the graph pipelines beside the node outcomes', () => {
    const c = state.pipelines.C
    const chunkEvents = (type: string) =>
      recorded.filter(
        (e) =>
          e.pipeline === 'C' &&
          e.event_type === type &&
          'chunk_id' in (e.payload as object),
      ).length
    const nodeEvents = (type: string) => count(type, 'C') - chunkEvents(type)
    expect(c.selected).toHaveLength(count('graph.candidate.selected', 'C'))
    expect(c.discarded).toHaveLength(count('graph.candidate.discarded', 'C'))
    expect(c.selected.filter((s) => s.kind === 'node')).toHaveLength(
      nodeEvents('graph.candidate.selected'),
    )
    expect(c.candidates).toHaveLength(count('graph.candidate.reranked', 'C'))
  })
})

describe('resuming', () => {
  it('a resumed stream state equals the uninterrupted one', () => {
    const cut = 7
    const resumed = reduceAll([
      ...recorded.slice(0, cut),
      ...recorded.slice(cut - 2),
    ])
    expect(resumed).toEqual(reduceAll(recorded))
  })

  it('ignores an event at or below the last sequence, returning the same state', () => {
    const state = reduceAll(recorded.slice(0, 20))
    expect(reduce(state, recorded[19])).toBe(state)
    expect(reduce(state, recorded[3])).toBe(state)
  })

  it('never mutates the state it is given', () => {
    const state = deepFreeze(reduceAll(recorded.slice(0, 30)))
    expect(() => recorded.slice(30).reduce(reduce, state)).not.toThrow()
  })
})

describe('lifecycle events', () => {
  it('a terminal event ends the run: a cancelled pipeline stays cancelled and unstarted ones are skipped', () => {
    const state = reduceAll([
      event(1, 'run.started', 'run'),
      event(2, 'pipeline.started', 'A'),
      event(3, 'pipeline.completed', 'A'),
      event(4, 'pipeline.started', 'B'),
      event(5, 'pipeline.cancelled', 'B', CANCELLED),
      event(6, 'run.cancelled', 'run', CANCELLED),
    ])
    expect(state.status).toBe('cancelled')
    expect(state.error).toEqual(CANCELLED)
    expect(state.pipelines.A.status).toBe('completed')
    expect(state.pipelines.B.status).toBe('cancelled')
    expect(state.pipelines.B.error).toEqual(CANCELLED)
    expect(state.pipelines.C.status).toBe('skipped')
  })

  it('a failure marks the pipeline and the run failed with the envelope', () => {
    const failure = {
      error_code: 'MODEL_ERROR',
      message: 'The language model could not produce an answer.',
      retryable: true,
    }
    const state = reduceAll([
      event(1, 'run.started', 'run'),
      event(2, 'pipeline.started', 'A'),
      event(3, 'pipeline.failed', 'A', failure),
      event(4, 'run.failed', 'run', failure),
    ])
    expect(state.status).toBe('failed')
    expect(state.error).toEqual(failure)
    expect(state.pipelines.A).toMatchObject({
      status: 'failed',
      error: failure,
    })
    expect(state.pipelines.B.status).toBe('skipped')
    expect(state.pipelines.C.status).toBe('skipped')
  })

  it('an interrupted run fails the pipelines that never started', () => {
    const interrupted = {
      error_code: 'INTERRUPTED',
      message: 'The server stopped during this run.',
      retryable: true,
    }
    const state = reduceAll([
      event(1, 'run.started', 'run'),
      event(2, 'pipeline.started', 'A'),
      event(3, 'pipeline.completed', 'A'),
      event(4, 'pipeline.started', 'B'),
      event(5, 'pipeline.failed', 'B', interrupted),
      event(6, 'run.failed', 'run', interrupted),
    ])
    expect(state.pipelines.A.status).toBe('completed')
    expect(state.pipelines.B.status).toBe('failed')
    expect(state.pipelines.C.status).toBe('failed')
  })

  it('stages still running end with the terminal event and its status', () => {
    const running = (end: string, payload: object, status: string) => {
      const state = reduceAll([
        event(1, 'run.started', 'run'),
        event(2, 'pipeline.started', 'A', {}, 10),
        event(3, 'rag.embedding.started', 'A', { model: 'm' }, 20),
        event(
          4,
          'rag.embedding.completed',
          'A',
          { model: 'm', dimensions: 4 },
          30,
        ),
        event(5, 'rag.vector_search.started', 'A', { top_k: 4 }, 40),
        event(6, end, 'run', payload, 90),
      ])
      expect(state.pipelines.A.stages.embedding).toEqual({
        status: 'completed',
        startedMs: 20,
        endedMs: 30,
      })
      expect(state.pipelines.A.stages.search).toEqual({
        status,
        startedMs: 40,
        endedMs: 90,
      })
    }
    running('run.cancelled', CANCELLED, 'cancelled')
    running('run.failed', { ...CANCELLED, error_code: 'MODEL_ERROR' }, 'failed')
    running('run.completed', {}, 'completed')
  })

  it('a pipeline end ends its own running stages', () => {
    const state = reduceAll([
      event(1, 'pipeline.started', 'A', {}, 10),
      event(2, 'rag.embedding.started', 'A', { model: 'm' }, 20),
      event(3, 'pipeline.cancelled', 'A', CANCELLED, 55),
    ])
    expect(state.pipelines.A.stages.embedding).toEqual({
      status: 'cancelled',
      startedMs: 20,
      endedMs: 55,
    })
  })

  it('starts pending and running before any pipeline event', () => {
    expect(initialRunState().status).toBe('pending')
    expect(
      reduce(initialRunState(), event(1, 'run.started', 'run')).status,
    ).toBe('running')
  })
})

describe('unknown events', () => {
  it('are kept, counted and listed, and still advance the sequence', () => {
    const odd = event(2, 'rag.invented.event', 'A', { note: 'x' })
    const state = reduceAll([
      event(1, 'run.started', 'run'),
      odd,
      event(3, 'pipeline.started', 'A'),
    ])
    expect(state.unknown.count).toBe(1)
    expect(state.unknown.events).toEqual([
      {
        sequence: 2,
        event_type: 'rag.invented.event',
        pipeline: 'A',
        payload: { note: 'x' },
      },
    ])
    expect(state.lastSequence).toBe(3)
    expect(state.pipelines.A.status).toBe('running')
  })

  it('include a known type sent under a pipeline it cannot belong to', () => {
    const state = reduce(
      initialRunState(),
      event(1, 'graph.seed.selected', 'A', { node_id: 'X' }),
    )
    expect(state.unknown.count).toBe(1)
    expect(state.graph.B.nodes).toEqual([])
  })
})

describe('graph outcomes', () => {
  const state: RunState = reduceAll([
    event(1, 'graph.entity.resolved', 'B', {
      entity_id: 'INC_1',
      node_label: 'Incident',
      origin: 'id',
      matched_text: 'INC_1',
      via_concept: null,
      confidence: 1,
    }),
    event(2, 'graph.seed.selected', 'B', { node_id: 'INC_1' }),
    event(3, 'graph.node.discovered', 'B', {
      node_id: 'PLT_1',
      node_label: 'Platform',
      hop: 1,
    }),
    event(4, 'graph.node.discovered', 'B', {
      node_id: 'PLT_1',
      node_label: 'Platform',
      hop: 2,
    }),
    event(5, 'graph.candidate.selected', 'B', {
      node_id: 'INC_1',
      score: 0.9,
      rerank_score: 0.8,
      hops: 0,
      seed: true,
      weight_graph_distance: 1,
      weight_relationship_type: 1,
      weight_semantic_relevance: 1,
      weight_temporal_validity: 1,
    }),
    event(6, 'graph.candidate.discarded', 'B', {
      node_id: 'PLT_1',
      score: 0.2,
      rerank_score: null,
      hops: 1,
      seed: false,
      reason: 'out_of_scope_market',
    }),
  ])

  it('mark a seed, keep a node once at its first hop, and record the outcome', () => {
    expect(state.graph.B.nodes).toEqual([
      {
        id: 'INC_1',
        label: 'Incident',
        hop: 0,
        seed: true,
        viaConcept: null,
        outcome: 'selected',
        reason: null,
        score: 0.9,
        rerankScore: 0.8,
      },
      {
        id: 'PLT_1',
        label: 'Platform',
        hop: 1,
        seed: false,
        viaConcept: null,
        outcome: 'discarded',
        reason: 'out_of_scope_market',
        score: 0.2,
        rerankScore: null,
      },
    ])
  })
})

describe('a node an outcome event names before any discovery', () => {
  it('has no known hop and no label, not hop 0', () => {
    const state = reduceAll([
      event(1, 'graph.candidate.discarded', 'B', {
        node_id: 'GHOST',
        score: 0.2,
        rerank_score: null,
        hops: 1,
        seed: false,
        reason: 'context_budget',
      }),
    ])
    expect(state.graph.B.nodes).toMatchObject([
      { id: 'GHOST', label: null, hop: null, outcome: 'discarded' },
    ])
  })

  it('keeps the hop of a node discovered first', () => {
    const state = reduceAll([
      event(1, 'graph.node.discovered', 'B', {
        node_id: 'PLT_1',
        node_label: 'Platform',
        hop: 2,
      }),
      event(2, 'graph.candidate.discarded', 'B', {
        node_id: 'PLT_1',
        score: 0.2,
        rerank_score: null,
        hops: 2,
        seed: false,
        reason: 'context_budget',
      }),
    ])
    expect(state.graph.B.nodes[0].hop).toBe(2)
  })
})

describe('graph node outcome before the verdict', () => {
  const stream = (withRerank: boolean): RunEvent[] => [
    event(1, 'graph.node.discovered', 'B', {
      node_id: 'PLT_1',
      node_label: 'Platform',
      hop: 1,
    }),
    ...(withRerank
      ? [
          event(2, 'graph.candidate.reranked', 'B', {
            candidate_id: 'PLT_1',
            kind: 'node',
            rank: 1,
            rerank_score: 0.4,
          }),
        ]
      : []),
  ]

  it('a node is only discovered until the reranker has judged it', () => {
    expect(reduceAll(stream(false)).graph.B.nodes[0].outcome).toBe('discovered')
    expect(reduceAll(stream(true)).graph.B.nodes[0].outcome).toBe('candidate')
  })

  it('a reranked node the graph never discovered is not invented', () => {
    const state = reduceAll([
      event(1, 'graph.candidate.reranked', 'B', {
        candidate_id: 'GHOST',
        kind: 'node',
        rank: 1,
        rerank_score: 0.4,
      }),
    ])
    expect(state.graph.B.nodes).toEqual([])
  })
})

describe('method v0.3 graph outcomes', () => {
  const state: RunState = reduceAll([
    event(1, 'graph.target_types.resolved', 'B', {
      labels: 'Incident,PlatformVersion',
    }),
    event(2, 'graph.target_types.resolved', 'C', { labels: '' }),
    event(3, 'graph.candidate.selected', 'B', {
      node_id: 'INC_1',
      score: 0.9,
      hops: 0,
      seed: true,
      tier: 'seed',
      graph_rank: 1,
      weight_graph_distance: 1,
      weight_relationship_type: 1,
      weight_semantic_relevance: 1,
      weight_temporal_validity: 1,
    }),
    event(4, 'graph.candidate.discarded', 'B', {
      node_id: 'PLV_1',
      score: 0.6,
      hops: 1,
      seed: false,
      tier: 'target',
      graph_rank: 2,
      reason: 'same_record',
    }),
    event(5, 'graph.candidate.discarded', 'B', {
      node_id: 'MKT_1',
      score: 0.2,
      hops: 1,
      seed: false,
      tier: null,
      graph_rank: null,
      reason: 'out_of_scope_market',
    }),
    event(6, 'graph.candidate.selected', 'B', {
      chunk_id: 'DOC_1',
      rank: 1,
      rerank_score: 0.7,
    }),
    event(7, 'graph.context.assembled', 'B', {
      structured_nodes: 1,
      document_chunks: 1,
      context_tokens: 1840,
      budget_tokens: 2000,
      stated_links: 12,
    }),
    event(8, 'rag.context.assembled', 'A', {
      selected: 3,
      discarded: 1,
      context_tokens: 900,
      budget_tokens: 2000,
    }),
  ])

  it('keeps the tier and graph rank of each node outcome, and no re-rank score', () => {
    expect(state.pipelines.B.selected[0]).toEqual({
      id: 'INC_1',
      kind: 'node',
      rank: null,
      rerankScore: null,
      tier: 'seed',
      graphRank: 1,
    })
    expect(state.pipelines.B.discarded).toEqual([
      {
        id: 'PLV_1',
        reason: 'same_record',
        rerankScore: null,
        tier: 'target',
        graphRank: 2,
      },
      {
        id: 'MKT_1',
        reason: 'out_of_scope_market',
        rerankScore: null,
        tier: null,
        graphRank: null,
      },
    ])
  })

  it('keeps the re-rank score of a document and gives it no tier', () => {
    expect(state.pipelines.B.selected[1]).toEqual({
      id: 'DOC_1',
      kind: 'chunk',
      rank: 1,
      rerankScore: 0.7,
      tier: null,
      graphRank: null,
    })
  })

  it('keeps the target types the question named, none when it named none', () => {
    expect(state.graph.B.targetTypes).toEqual(['Incident', 'PlatformVersion'])
    expect(state.graph.C.targetTypes).toEqual([])
    expect(initialRunState().graph.B.targetTypes).toBeNull()
  })

  it('keeps the context size and its budget', () => {
    expect(state.pipelines.B.context).toEqual({
      tokens: 1840,
      budgetTokens: 2000,
    })
    expect(state.pipelines.A.context).toEqual({
      tokens: 900,
      budgetTokens: 2000,
    })
    expect(initialRunState().pipelines.A.context).toBeNull()
  })

  it('reads an old-method context, which had no budget, as tokens alone', () => {
    const old = reduceAll([
      event(1, 'rag.context.assembled', 'A', {
        selected: 12,
        discarded: 28,
        context_tokens: 1444,
        evidence_slots: 12,
      }),
    ])
    expect(old.pipelines.A.context).toEqual({
      tokens: 1444,
      budgetTokens: null,
    })
  })
})
