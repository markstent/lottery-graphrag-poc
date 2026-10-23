import { describe, expect, it } from 'vitest'

import { RECORDED_RUNS } from '../../run/recorded'
import {
  initialRunState,
  reduceAll,
  type RunEvent,
  type RunState,
} from '../../run/reduce'
import cancelled from '../../run/fixtures/run-cancelled.json'
import {
  evidenceRows,
  pipelineNotice,
  runStatusLine,
  stageRows,
} from './columns'

const h1 = RECORDED_RUNS.find((run) => run.stratum === 'H1')!
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
    for (const id of ['B', 'C'] as const)
      expect(
        stageRows(id, start.pipelines[id]).map((row) => row.label),
      ).toEqual([
        'Find starting points',
        'Follow relationships',
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
      ).toEqual(Array(5).fill('done'))
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
    expect(statuses('C')).toEqual(Array(5).fill('not-reached'))
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

  it('names a graph node by its kind and id, and says why one was set aside', () => {
    const rows = evidenceRows('B', finished)
    const inc = rows.find((row) => row.id === 'INC_037')!
    expect(inc).toMatchObject({ kind: 'incident', state: 'selected' })
    const aside = rows.find((row) => row.state === 'discarded')!
    expect(aside.detail).toMatch(/^Set aside: /)
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
  it('says where the run stands in one sentence', () => {
    const idle = initialRunState()
    expect(runStatusLine('idle', null, idle)).toBe(
      'Choose a question and press Run.',
    )
    expect(runStatusLine('starting', 'live', idle)).toBe('Starting the run.')
    expect(runStatusLine('running', 'recorded', idle)).toBe(
      'Playing the recorded run.',
    )
    expect(runStatusLine('running', 'live', idle)).toBe(
      'The run is in progress.',
    )
    expect(runStatusLine('interrupted', 'live', idle)).toBe(
      'The live connection stopped before the run ended.',
    )
    expect(runStatusLine('finished', 'recorded', finished)).toBe(
      'The run is complete.',
    )
    expect(runStatusLine('finished', 'recorded', cancelledState)).toBe(
      'The run was cancelled.',
    )
  })

  it('gives the recorded reason when a run failed', () => {
    const failed: RunState = {
      ...initialRunState(),
      status: 'failed',
      error: {
        error_code: 'RUN_ERROR',
        message: 'The graph stopped.',
        retryable: false,
      },
    }
    expect(runStatusLine('finished', 'live', failed)).toBe(
      'The run failed: The graph stopped.',
    )
  })
})
