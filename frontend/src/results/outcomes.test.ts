import { describe, expect, it } from 'vitest'

import type { Schemas } from '../api/client'
import { answerRows, evidenceRows, percent } from './outcomes'

type Outcomes = Schemas['RunOutcomesOut']

const answer = (
  right: number,
  partly: number,
  wrong: number,
  declined: [number, number, number],
) => ({
  scored: right + partly + wrong,
  right,
  partly,
  wrong,
  right_declined: declined[0],
  partly_declined: declined[1],
  wrong_declined: declined[2],
  not_scored: 0,
  partly_score_sum: 40,
})

const OUTCOMES: Outcomes = {
  recorded: true,
  evidence: {
    A: {
      repeats: 100,
      found: 321,
      missed: 421,
      found_share: 0.4201,
      extra_per_question: 16.2,
    },
    C: {
      repeats: 100,
      found: 500,
      missed: 242,
      found_share: 0.5685,
      extra_per_question: null,
    },
  },
  answers: {
    A: answer(117, 103, 80, [5, 15, 71]),
    B: answer(131, 101, 68, [6, 25, 64]),
  },
}

describe('percent', () => {
  it('rounds a share to a whole percent', () => {
    expect(percent(0.4201)).toBe('42 percent')
    expect(percent(0.5685)).toBe('57 percent')
  })
})

describe('evidenceRows', () => {
  it('draws found and missed from found_share, not from the pooled counts', () => {
    const [a] = evidenceRows(OUTCOMES)
    expect(a.found).toBeCloseTo(0.4201)
    expect(a.missed).toBeCloseTo(1 - 0.4201)
    expect(a.foundFacts).toBe(321)
    expect(a.missedFacts).toBe(421)
    expect(a.extra).toBe(16)
  })

  it('keeps the order A, B, C and skips an approach with no outcome', () => {
    expect(evidenceRows(OUTCOMES).map((row) => row.id)).toEqual(['A', 'C'])
  })

  it('has no bar and no extra count where the run scored nothing', () => {
    const rows = evidenceRows({
      ...OUTCOMES,
      evidence: {
        A: {
          ...OUTCOMES.evidence.A,
          found_share: null,
          extra_per_question: null,
        },
      },
    })
    expect(rows[0].found).toBeNull()
    expect(rows[0].extra).toBeNull()
  })
})

describe('answerRows', () => {
  it('gives three bands that add up to all scored answers', () => {
    const [a] = answerRows(OUTCOMES)
    expect(a.scored).toBe(300)
    expect(a.bands.map((band) => band.kind)).toEqual([
      'right',
      'partly',
      'wrong',
    ])
    expect(a.bands.reduce((sum, band) => sum + band.share, 0)).toBeCloseTo(1)
    expect(a.bands.map((band) => band.count)).toEqual([117, 103, 80])
  })

  it('puts each declined part inside its own band', () => {
    const [a] = answerRows(OUTCOMES)
    expect(a.bands.map((band) => band.declined)).toEqual([5, 15, 71])
    for (const band of a.bands) {
      expect(band.declinedShare).toBeLessThanOrEqual(band.share)
      expect(band.declinedShare).toBeCloseTo(band.declined / a.scored)
    }
  })

  it('has no bands for an approach that scored no answers', () => {
    const rows = answerRows({
      ...OUTCOMES,
      answers: { A: answer(0, 0, 0, [0, 0, 0]) },
    })
    expect(rows[0].bands.every((band) => band.share === 0)).toBe(true)
  })
})
