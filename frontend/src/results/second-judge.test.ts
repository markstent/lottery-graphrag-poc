import { describe, expect, it } from 'vitest'

import { V03_SECOND_JUDGE } from './results.fixtures'
import {
  answerScoreRows,
  eachOtherRows,
  judgeModels,
  labelRows,
} from './second-judge'

describe('second judge rows', () => {
  it('sets the two judges side by side against the answer score', () => {
    const rows = answerScoreRows(V03_SECOND_JUDGE)
    expect(rows.map((row) => row.label)).toEqual([
      'First judge, answered',
      'First judge, abstained',
      'Second judge, answered',
      'Second judge, abstained',
    ])
    // Test values: 324 pairs each; the kappa shows from 10 pairs.
    expect(rows[0].cells).toEqual(['324', '4%', '0.00'])
    expect(rows[2].cells).toEqual(['324', '32%', '0.00'])
    // No answer abstained, so there is nothing to say.
    expect(rows[1].cells).toEqual(['0', 'Too few to say', 'Too few to say'])
  })

  it('says how often the two judges agree with each other', () => {
    const rows = eachOtherRows(V03_SECOND_JUDGE)
    expect(rows.map((row) => row.label)).toEqual(['Answered', 'Abstained'])
    expect(rows[0].cells).toEqual(['324', '33%', '0.00'])
  })

  it('names each label measure as the label check does, with the n rule', () => {
    const rows = labelRows(V03_SECOND_JUDGE)!
    expect(rows.map((row) => row.key)).toEqual([
      'judge_recorded',
      'judge_abstention_rule',
      'second_judge',
    ])
    expect(rows[2].label).toBe(
      'Second judge ollama/muse-glimmer:latest with judge prompt 1.2.0',
    )
    // Five labelled items: below 10, so no kappa.
    expect(rows[2].cells).toEqual(['5', '20%', 'Too few to say'])
  })

  it('has no label rows without a label check', () =>
    expect(labelRows({ ...V03_SECOND_JUDGE, labels: null })).toBeNull())

  it('names the two judge models and the larger reply limit of the second', () =>
    expect(judgeModels(V03_SECOND_JUDGE)).toEqual([
      ['First judge', 'fake-judge-v1'],
      ['Second judge', 'ollama/muse-glimmer:latest, reply limit 2,048 tokens'],
    ]))

  it('names no reply limit when it equals the first judge limit', () => {
    const run = V03_SECOND_JUDGE.run
    const same = {
      ...V03_SECOND_JUDGE,
      run: { ...run, second_judge: { ...run.second_judge, max_tokens: 300 } },
    }
    expect(judgeModels(same)[1]).toEqual([
      'Second judge',
      'ollama/muse-glimmer:latest',
    ])
  })
})
