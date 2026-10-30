import { describe, expect, it } from 'vitest'

import { RECORDINGS } from '../../test/recordings'
import {
  initialRunState,
  reduceAll,
  type RunEvent,
  type RunState,
} from '../../run/reduce'
import cancelled from '../../run/fixtures/run-cancelled.json'
import runAbc from '../../run/fixtures/run-abc.json'
import oldMethod from '../../run/fixtures/run-old-method.json'
import {
  contextLine,
  evidenceRows,
  evidenceSummary,
  pipelineNotice,
  runStatusLine,
  stageRows,
  targetLine,
} from './columns'
import type { RunPhase, Timeline as TimelineView } from './use-live-run'

const h1 = RECORDINGS.find((run) => run.stratum === 'H1')!
const finished = reduceAll(h1.events)
const oldMethodState = reduceAll(oldMethod.events as unknown as RunEvent[])
const cancelledState = reduceAll(cancelled.events as unknown as RunEvent[])

const upTo = (events: RunEvent[], type: string): RunState => {
  const at = events.findIndex((event) => event.event_type === type)
  return reduceAll(events.slice(0, at + 1))
}

describe('stageRows', () => {
  it('lists the steps of each pipeline in order, all waiting at the start', () => {
    const start = initialRunState()
    expect(stageRows('A', start.pipelines.A).map((row) => row.label)).toEqual([
      'Embed the question',
      'Search passages',
      'Re-order and pick passages',
      'Build the context',
      'Write the answer',
    ])
    expect(stageRows('B', start.pipelines.B).map((row) => row.label)).toEqual([
      'Find starting points',
      'Follow relationships',
      'Re-order passages, take turns',
      'Build the context',
      'Write the answer',
    ])
    // The order of the Overview diagram's C lane, then the shared steps.
    expect(stageRows('C', start.pipelines.C).map((row) => row.label)).toEqual([
      'Find starting points',
      'Add ontology terms',
      'Follow relationships',
      'Add linked records',
      'Re-order passages, take turns',
      'Build the context',
      'Write the answer',
    ])
    expect(
      stageRows('A', start.pipelines.A).every(
        (row) => row.status === 'waiting',
      ),
    ).toBe(true)
  })

  it('marks the running step and the finished ones with their time', () => {
    const state = upTo(h1.events, 'rag.vector_search.started')
    const rows = stageRows('A', state.pipelines.A)
    expect(rows.map((row) => row.status)).toEqual([
      'done',
      'running',
      'waiting',
      'waiting',
      'waiting',
    ])
    expect(rows[0].durationMs).toBeGreaterThan(0)
    expect(rows[1].durationMs).toBeNull()
  })

  it('shows every step done once the pipeline has completed', () => {
    for (const id of ['A', 'B', 'C'] as const)
      expect(
        stageRows(id, finished.pipelines[id]).map((row) => row.status),
      ).toEqual(Array(id === 'C' ? 7 : 5).fill('done'))
  })

  it('shows where a cancelled run stopped and that the next pipeline never began', () => {
    const statuses = (id: 'A' | 'B' | 'C') =>
      stageRows(id, cancelledState.pipelines[id]).map((row) => row.status)
    expect(statuses('A')).toEqual(['done', 'done', 'done', 'done', 'done'])
    // B was cancelled while it followed the graph's relationships.
    expect(statuses('B')).toEqual([
      'done',
      'cancelled',
      'not-reached',
      'not-reached',
      'not-reached',
    ])
    expect(statuses('C')).toEqual(Array(7).fill('not-reached'))
  })
})

describe('stageRows, the re-rank step by method', () => {
  it('names what v0.3 does, and keeps the old name for a recording of the old method', () => {
    const start = initialRunState()
    const rerank = (id: 'A' | 'B', old: boolean) =>
      stageRows(id, start.pipelines[id], old).find(
        (row) => row.stage === 'rerank',
      )?.label
    expect(rerank('A', false)).toBe('Re-order and pick passages')
    expect(rerank('B', false)).toBe('Re-order passages, take turns')
    expect(rerank('B', true)).toBe('Re-order and pick')
  })
})

describe('stageRows, a step the pipeline never ran', () => {
  const h3 = RECORDINGS.find((run) => run.stratum === 'H3')!
  const state = reduceAll(h3.events)

  it('says "Not run" for a step a completed pipeline skipped, such as C with no ontology links', () => {
    expect(state.pipelines.C.status).toBe('completed')
    // The recording was made under the old method, so it keeps that step name.
    const rows = stageRows('C', state.pipelines.C, true)
    expect(rows.map((row) => [row.label, row.status])).toEqual([
      ['Find starting points', 'done'],
      ['Add ontology terms', 'done'],
      ['Follow relationships', 'done'],
      ['Add linked records', 'not-run'],
      ['Re-order and pick', 'done'],
      ['Build the context', 'done'],
      ['Write the answer', 'done'],
    ])
  })

  it('keeps "Not reached" for a pipeline that stopped early', () => {
    const rows = stageRows('C', {
      ...state.pipelines.C,
      status: 'cancelled',
      stages: {},
    })
    expect(rows.every((row) => row.status === 'not-reached')).toBe(true)
  })
})

describe('evidenceRows', () => {
  it('is empty before anything is retrieved', () => {
    expect(evidenceRows('A', initialRunState())).toEqual([])
  })

  it('puts used evidence first, then considered, then set aside', () => {
    const rows = evidenceRows('A', finished)
    const order = ['selected', 'candidate', 'discarded']
    expect(rows.map((row) => order.indexOf(row.state))).toEqual(
      [...rows.map((row) => order.indexOf(row.state))].sort((a, b) => a - b),
    )
    expect(rows.filter((row) => row.state === 'selected')).toHaveLength(
      finished.pipelines.A.selected.length,
    )
    expect(rows.filter((row) => row.state === 'discarded')).toHaveLength(
      finished.pipelines.A.discarded.length,
    )
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length)
  })

  it('shows retrieved passages as considered until they are judged', () => {
    const state = upTo(h1.events, 'rag.candidate.retrieved')
    const rows = evidenceRows('A', state)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ state: 'candidate', kind: 'passage' })
  })

  it('titles records from the run results and keeps the id as well', () => {
    const rows = evidenceRows('A', finished, h1.results)
    const row = rows.find((r) => r.id === 'REC_incidents_INC_037')!
    expect(row.title).toBe(
      'Incident INC_037 in United Kingdom: Identity service latency causing timeouts',
    )
    expect(evidenceRows('A', finished)[0].title).toBeNull()
  })

  it('names a graph node by its kind and id, and says why one was set aside', () => {
    const rows = evidenceRows(
      'B',
      reduceAll(runAbc.events as unknown as RunEvent[]),
    )
    const inc = rows.find((row) => row.id === 'INC_022')!
    expect(inc).toMatchObject({ kind: 'incident', state: 'selected' })
    const aside = rows.find((row) => row.state === 'discarded')!
    expect(aside.detail).toMatch(/^Set aside: /)
  })
})

describe('evidenceRows under method v0.3', () => {
  const v03 = reduceAll(runAbc.events as unknown as RunEvent[])
  const outcome = (sequence: number, type: string, payload: object): RunEvent =>
    ({
      event_id: `e${sequence}`,
      timestamp: '2026-01-01T10:00:00+00:00',
      run_id: 'RUN-TEST',
      pipeline: 'B',
      event_type: type,
      t_ms: sequence,
      payload,
      sequence,
    }) as unknown as RunEvent
  const node = (id: string, tier: string | null, rank: number | null) => ({
    node_id: id,
    score: 0.5,
    hops: 1,
    seed: tier === 'seed',
    tier,
    graph_rank: rank,
  })
  const built = reduceAll([
    outcome(1, 'graph.candidate.selected', {
      ...node('INC_1', 'seed', 1),
      weight_graph_distance: 1,
      weight_relationship_type: 1,
      weight_semantic_relevance: 1,
      weight_temporal_validity: 1,
    }),
    outcome(2, 'graph.candidate.discarded', {
      ...node('PLV_1', 'target', 2),
      reason: 'same_record',
    }),
    outcome(3, 'graph.candidate.discarded', {
      ...node('PLT_1', 'other', 3),
      reason: 'context_budget',
    }),
    outcome(4, 'graph.candidate.discarded', {
      ...node('MKT_1', null, null),
      reason: 'out_of_scope_market',
    }),
  ])
  const row = (id: string) =>
    evidenceRows('B', built).find((candidate) => candidate.id === id)!

  it('places each graph record by its tier and graph rank', () => {
    expect(row('INC_1').place).toBe('starting point · graph rank 1')
    expect(row('PLV_1').place).toBe("question's target · graph rank 2")
    expect(row('PLT_1').place).toBe('other · graph rank 3')
    // A record refused before the graph order has no place in it.
    expect(row('MKT_1').place).toBeNull()
  })

  it('says why a record was set aside, in the words of the v0.3 reasons', () => {
    expect(row('PLV_1').detail).toBe(
      'Set aside: the same record is already in the context',
    )
    expect(row('PLT_1').detail).toBe('Set aside: the context was full')
    expect(row('MKT_1').detail).toBe(
      'Set aside: outside the markets asked about',
    )
  })

  it('gives a document no place in the graph order', () => {
    const rows = evidenceRows('B', v03)
    const documents = rows.filter(
      (r) => r.kind === 'passage' || r.kind === 'source record',
    )
    expect(documents.length).toBeGreaterThan(0)
    expect(documents.every((r) => r.place === null)).toBe(true)
    expect(rows.find((r) => r.id === 'INC_021')?.place).toBe(
      'starting point · graph rank 1',
    )
    expect(rows.find((r) => r.id === 'INC_022')?.place).toBe(
      "question's target · graph rank 2",
    )
  })
})

describe('evidenceRows of an old-method recording', () => {
  it('says a record was set aside under the old method, with no graph rank', () => {
    const rows = evidenceRows('B', oldMethodState)
    const aside = rows.filter((row) => row.state === 'discarded')
    expect(aside.length).toBeGreaterThan(0)
    expect(
      aside.every((row) => row.detail === 'Set aside under the old method'),
    ).toBe(true)
    expect(rows.every((row) => row.place === null)).toBe(true)
  })
})

describe('targetLine', () => {
  it("names the question's target types in plain words", () => {
    expect(
      targetLine('C', reduceAll(runAbc.events as unknown as RunEvent[])),
    ).toBe(
      "Question's target: incident, incident type, market, platform version",
    )
  })

  it('says when the question named none, and is silent for A and old recordings', () => {
    const none = reduceAll([
      {
        event_id: 'e1',
        timestamp: '2026-01-01T10:00:00+00:00',
        run_id: 'RUN-TEST',
        pipeline: 'B',
        event_type: 'graph.target_types.resolved',
        t_ms: 1,
        payload: { labels: '' },
        sequence: 1,
      } as unknown as RunEvent,
    ])
    expect(targetLine('B', none)).toBe("Question's target: none named")
    expect(targetLine('A', none)).toBeNull()
    expect(targetLine('B', oldMethodState)).toBeNull()
  })
})

describe('contextLine', () => {
  it('gives the context size against its budget', () => {
    const v03 = reduceAll(runAbc.events as unknown as RunEvent[])
    expect(contextLine(v03.pipelines.B)).toBe('Context: 1,996 of 2,000 tokens')
  })

  it('is silent before the context is built and for an old recording, which had no budget', () => {
    expect(contextLine(initialRunState().pipelines.A)).toBeNull()
    expect(contextLine(oldMethodState.pipelines.A)).toBeNull()
  })
})

describe('evidenceSummary', () => {
  const rows = evidenceRows('A', upTo(h1.events, 'rag.candidate.reranked'))

  it('counts what was found, used and set aside', () => {
    expect(evidenceSummary(evidenceRows('A', finished), 'completed')).toBe(
      '40 found · 16 used · 24 set aside',
    )
  })

  it('adds what is still being weighed only while the pipeline runs', () => {
    expect(rows.length).toBeGreaterThan(0)
    expect(evidenceSummary(rows, 'running')).toBe(
      `${rows.length} found · 0 used · 0 set aside · ${rows.length} still being weighed`,
    )
    expect(evidenceSummary(rows, 'cancelled')).toBe(
      `${rows.length} found · 0 used · 0 set aside`,
    )
  })
})

describe('pipelineNotice', () => {
  it('has nothing to say about a healthy pipeline', () => {
    expect(pipelineNotice(finished.pipelines.A)).toBeNull()
    expect(pipelineNotice(initialRunState().pipelines.B)).toBeNull()
  })

  it('says in plain words when a pipeline was cancelled or never started', () => {
    expect(pipelineNotice(cancelledState.pipelines.B)).toBe(
      'Cancelled before it finished.',
    )
    expect(pipelineNotice(cancelledState.pipelines.C)).toBe(
      'Not started: the run ended first.',
    )
  })

  it('gives the failure message the pipeline recorded', () => {
    const failed = {
      ...initialRunState().pipelines.A,
      status: 'failed' as const,
      error: {
        error_code: 'MODEL_ERROR' as const,
        message: 'The answer model did not respond.',
        retryable: true,
      },
    }
    expect(pipelineNotice(failed)).toBe('The answer model did not respond.')
  })
})

describe('runStatusLine', () => {
  const idle = initialRunState()
  const view = (
    phase: RunPhase,
    source: 'recorded' | 'live' | null,
    state: RunState,
    timeline: Partial<TimelineView> = {},
  ) =>
    runStatusLine({
      phase,
      source,
      state,
      timeline: {
        cursor: 0,
        duration: 35600,
        playing: false,
        speed: 1,
        enabled: true,
        replaying: true,
        ...timeline,
      },
    })

  it('says where a live run stands', () => {
    expect(view('idle', null, idle)).toBe('Choose a question and press Run.')
    expect(view('starting', 'live', idle)).toBe('Starting the run.')
    expect(view('running', 'live', idle, { replaying: false })).toBe(
      'The run is in progress.',
    )
    expect(view('interrupted', 'live', idle, { replaying: false })).toBe(
      'The live connection stopped.',
    )
  })

  it('says a recording is playing, or paused at its position', () => {
    const mid = upTo(h1.events, 'rag.vector_search.started')
    expect(view('running', 'recorded', mid, { playing: true })).toBe(
      'Playing the recorded run.',
    )
    expect(view('running', 'recorded', mid, { cursor: 19600 })).toBe(
      'Paused at 19.6 s of 35.6 s.',
    )
    expect(view('running', 'recorded', idle)).toBe('Paused at 0 s of 35.6 s.')
  })

  it('says a finished live run is being replayed, and never calls a rewound one in progress', () => {
    expect(view('finished', 'live', idle, { playing: true })).toBe(
      'Replaying the run.',
    )
    expect(view('finished', 'live', idle)).toBe('Paused at 0 s of 35.6 s.')
    expect(view('finished', 'live', idle)).not.toMatch(/in progress/)
  })

  it('does not call a live run in progress when its stream ended without a final event', () => {
    const mid = upTo(h1.events, 'rag.vector_search.started')
    expect(view('finished', 'live', mid, { replaying: false })).toBe(
      'The live connection stopped.',
    )
  })

  it('says finished, cancelled or failed once the end is reached', () => {
    expect(view('finished', 'recorded', finished)).toBe('The run is complete.')
    expect(view('finished', 'live', cancelledState, { replaying: false })).toBe(
      'The run was cancelled.',
    )
    const failed: RunState = {
      ...initialRunState(),
      status: 'failed',
      error: {
        error_code: 'RUN_ERROR',
        message: 'The graph stopped.',
        retryable: false,
      },
    }
    expect(view('finished', 'live', failed, { replaying: false })).toBe(
      'The run failed: The graph stopped.',
    )
  })
})
