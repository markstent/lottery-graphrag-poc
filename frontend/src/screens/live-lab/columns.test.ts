import { describe, expect, it } from 'vitest'

import { RECORDINGS } from '../../test/recordings'
import {
  initialRunState,
  reduceAll,
  type RunEvent,
  type RunState,
} from '../../run/reduce'
import cancelled from '../../run/fixtures/run-cancelled.json'
import {
  evidenceRows,
  evidenceSummary,
  pipelineNotice,
  runStatusLine,
  stageRows,
} from './columns'
import type { RunPhase, Timeline as TimelineView } from './use-live-run'

const h1 = RECORDINGS.find((run) => run.stratum === 'H1')!
const finished = reduceAll(h1.events)
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
      'Re-order and pick',
      'Build the context',
      'Write the answer',
    ])
    expect(stageRows('B', start.pipelines.B).map((row) => row.label)).toEqual([
      'Find starting points',
      'Follow relationships',
      'Re-order and pick',
      'Build the context',
      'Write the answer',
    ])
    // The order of the Overview diagram's C lane, then the shared steps.
    expect(stageRows('C', start.pipelines.C).map((row) => row.label)).toEqual([
      'Find starting points',
      'Add ontology terms',
      'Follow relationships',
      'Add linked records',
      'Re-order and pick',
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
    expect(statuses('B')).toEqual([
      'done',
      'done',
      'cancelled',
      'not-reached',
      'not-reached',
    ])
    expect(statuses('C')).toEqual(Array(7).fill('not-reached'))
  })
})

describe('stageRows, a step the pipeline never ran', () => {
  const h3 = RECORDINGS.find((run) => run.stratum === 'H3')!
  const state = reduceAll(h3.events)

  it('says "Not run" for a step a completed pipeline skipped, such as C with no ontology links', () => {
    expect(state.pipelines.C.status).toBe('completed')
    const rows = stageRows('C', state.pipelines.C)
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
    const rows = evidenceRows('B', finished)
    const inc = rows.find((row) => row.id === 'INC_037')!
    expect(inc).toMatchObject({ kind: 'incident', state: 'selected' })
    const aside = rows.find((row) => row.state === 'discarded')!
    expect(aside.detail).toMatch(/^Set aside: /)
  })
})

describe('evidenceSummary', () => {
  const rows = evidenceRows('A', upTo(h1.events, 'rag.candidate.reranked'))

  it('counts what was found, used and set aside', () => {
    expect(evidenceSummary(evidenceRows('A', finished), 'completed')).toBe(
      '40 found · 12 used · 28 set aside',
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
      'The live connection stopped before the run ended.',
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
      'The live connection stopped before the run ended.',
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
