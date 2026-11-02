import { describe, expect, it } from 'vitest'

import type { Schemas } from '../../api/client'
import { RECORDINGS } from '../../test/recordings'
import { delta, deltaWords, scorecard } from './score'

type Results = Schemas['QueryResults']

const h1 = RECORDINGS.find((run) => run.stratum === 'H1')!.results
const h3 = RECORDINGS.find((run) => run.stratum === 'H3')!.results

describe('scorecard', () => {
  it('takes the score from the run score and the measures from the results', () => {
    const card = scorecard(h3)
    expect(card.scored).toBe(true)
    expect(card.label).toBe('scored against the answer key')
    const a = card.columns.A!
    const result = h3.results!.A
    expect(a.answer).toBe(1)
    expect(a.evidence).toBeNull()
    expect(a.anchorResolution).toBe(1)
    expect(a.latencyMs).toBe(result.answer.latency_ms)
    expect(a.contextTokens).toBe(result.answer.context_tokens)
  })

  it('carries a failure class and its plain words', () => {
    const card = scorecard(h1)
    expect(card.columns.A!.failureClass).toBe('retrieval_failure')
    expect(card.columns.A!.failure).toBe(
      'the needed evidence was not retrieved',
    )
    expect(card.columns.B!.failureClass).toBe('generation_failure')
    expect(card.columns.B!.failure).toBe(
      'the evidence was retrieved but the answer was wrong',
    )
  })

  it('is not scored for an ad hoc run, and then holds only the measurable items', () => {
    const adhoc = {
      ...h1,
      benchmark_instance_id: null,
      answer_key: 'none',
      score_status: 'not_applicable',
      score: null,
    } as unknown as Results
    const card = scorecard(adhoc)
    expect(card.scored).toBe(false)
    for (const id of ['A', 'B', 'C'] as const) {
      const column = card.columns[id]!
      expect(column.answer).toBeNull()
      expect(column.evidence).toBeNull()
      expect(column.failure).toBeNull()
      expect(column.latencyMs).toBe(h1.results![id].answer.latency_ms)
    }
  })

  it('is not scored while the score is pending or failed, even with a key', () => {
    for (const status of ['pending', 'failed'] as const)
      expect(scorecard({ ...h1, score_status: status } as Results).scored).toBe(
        false,
      )
  })

  it('is not scored when the run holds no score even if it says scored', () => {
    expect(scorecard({ ...h1, score: null } as Results).scored).toBe(false)
  })

  it('leaves a pipeline with no result out', () => {
    const only = {
      ...h1,
      results: { A: h1.results!.A },
    } as unknown as Results
    const card = scorecard(only)
    expect(card.columns.B).toBeNull()
    expect(card.columns.A).not.toBeNull()
  })

  it('counts the markets reached from the coverage rule', () => {
    expect(scorecard(h1).columns.A!.markets).toBeGreaterThan(0)
  })
})

describe('delta', () => {
  it('is the value less the baseline', () => {
    expect(delta(0.75, 0.5)).toBeCloseTo(0.25)
    expect(delta(2, 5)).toBe(-3)
  })
  it('is missing when either side is missing, never 0', () => {
    expect(delta(null, 1)).toBeNull()
    expect(delta(1, null)).toBeNull()
    expect(delta(null, null)).toBeNull()
  })
  it('keeps a real zero', () => {
    expect(delta(0, 0)).toBe(0)
  })
})

describe('deltaWords', () => {
  it('says how a score moved against A as a signed figure', () => {
    expect(deltaWords('score', 0.4)).toBe('+0.40 vs A')
    expect(deltaWords('score', -0.5)).toBe('-0.50 vs A')
    expect(deltaWords('score', 0)).toBe('same as A')
  })
  it('says how the answer writing time moved, signed', () => {
    expect(deltaWords('time', -2100)).toBe('-2.1 s vs A')
    expect(deltaWords('time', 450)).toBe('+450 ms vs A')
    expect(deltaWords('time', 0)).toBe('same as A')
  })
  it('says how counts moved, signed', () => {
    expect(deltaWords('tokens', -87)).toBe('-87 vs A')
    expect(deltaWords('tokens', 1200)).toBe('+1,200 vs A')
    expect(deltaWords('markets', 1)).toBe('+1 vs A')
  })
  it('calls a move too small to show the same', () => {
    expect(deltaWords('time', 0.2)).toBe('same as A')
    expect(deltaWords('score', 0.001)).toBe('same as A')
    expect(deltaWords('score', -0.004)).toBe('same as A')
  })
  it('says nothing for a missing delta', () => {
    expect(deltaWords('score', null)).toBeNull()
  })
})
