import { describe, expect, it } from 'vitest'

import { cutOffCount, cutOffNote } from './cut-off'

describe('cut-off words', () => {
  it('names the recorded limit when the answer stopped at it', () => {
    expect(
      cutOffNote({
        cut_off: true,
        token_limit_reached: true,
        max_tokens: 1200,
      }),
    ).toBe('The answer stopped at the 1,200-token limit.')
    expect(
      cutOffNote({
        cut_off: true,
        token_limit_reached: true,
        max_tokens: null,
      }),
    ).toBe('The answer stopped at the token limit.')
  })

  it('says only that the answer stops part-way when the limit is not known to be the cause', () => {
    for (const reached of [false, null])
      expect(
        cutOffNote({
          cut_off: true,
          token_limit_reached: reached,
          max_tokens: 4096,
        }),
      ).toBe('The answer stops part-way.')
  })

  it('has no note for a finished answer or one recorded before the record existed', () => {
    expect(cutOffNote({ cut_off: false })).toBeNull()
    expect(cutOffNote({})).toBeNull()
  })

  it("counts repeats with the run's recorded limit, and says when a run did not record them", () => {
    expect(cutOffCount(0, 0, 4096)).toBe('0')
    expect(cutOffCount(3, 3, 4096)).toBe('3 (3 at the 4,096-token limit)')
    expect(cutOffCount(2, 1, null)).toBe('2 (1 at the token limit)')
    expect(cutOffCount(null, null, 4096)).toBe('Not recorded')
    expect(cutOffCount(undefined, undefined, 4096)).toBe('Not recorded')
  })
})
