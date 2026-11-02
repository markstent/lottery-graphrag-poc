import { describe, expect, it } from 'vitest'

import {
  disagreeRows,
  levelWord,
  markRows,
  markTiles,
  type JudgesMark,
} from './judges'
import { V03_SECOND_JUDGE } from './results.fixtures'

const COMBINED = V03_SECOND_JUDGE.combined as JudgesMark

describe("the judges' mark", () => {
  it('reads each approach overall mean as published, null where there is none', () => {
    expect(markTiles(COMBINED)).toEqual([
      { pipeline: 'A', mean: COMBINED.metrics.overall!.A!.mean },
      { pipeline: 'B', mean: COMBINED.metrics.overall!.B!.mean },
      { pipeline: 'C', mean: COMBINED.metrics.overall!.C!.mean },
    ])
    const none = { ...COMBINED, metrics: { overall: {} } }
    expect(markTiles(none).map(({ mean }) => mean)).toEqual([null, null, null])
  })

  it('draws every cell of its own family, tested ones with their Holm p, in points', () => {
    const rows = markRows(COMBINED)
    expect(rows).toHaveLength(COMBINED.comparisons.length)
    const tested = COMBINED.comparisons.findIndex((c) => c.in_family)
    const cell = COMBINED.comparisons[tested]!
    expect(rows[tested]).toMatchObject({
      inFamily: true,
      pHolm: cell.p_holm,
      mean: cell.mean! * 100,
      n: cell.n,
      groups: cell.clusters,
    })
  })

  it('says each judge verdict in words', () => {
    expect([0, 1, 2].map(levelWord)).toEqual(['wrong', 'partly', 'correct'])
    expect(levelWord(3)).toBe('-')
  })

  it('lists the answers the judges disagree on, in run order, in words', () => {
    const rows = disagreeRows(COMBINED)
    expect(rows).toHaveLength(COMBINED.counts.disagreements)
    const first = COMBINED.disagreements[0]!
    expect(rows[0]).toEqual({
      key: `${first.instance_id}:${first.pipeline}:${first.repeat}`,
      question: first.question,
      approach: first.pipeline === 'B' ? 'B · Graph' : expect.any(String),
      first: levelWord(first.first),
      second: levelWord(first.second),
    })
    expect(new Set(rows.map(({ key }) => key)).size).toBe(rows.length)
  })
})
