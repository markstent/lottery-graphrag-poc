import { describe, expect, it } from 'vitest'

import { answerWords, evidenceScore } from './score-words'

describe('evidenceScore', () => {
  it('has two decimals on a 0 to 1 scale and shows no score as missing', () => {
    expect(evidenceScore(0.4)).toBe('0.40')
    expect(evidenceScore(1)).toBe('1.00')
    expect(evidenceScore(0)).toBe('0.00')
    expect(evidenceScore(null)).toBe('Missing')
  })
})

describe('answerWords', () => {
  it('reads 1 as correct, 0 as not correct and between as partly correct', () => {
    expect(answerWords(1)).toBe('Correct')
    expect(answerWords(0)).toBe('Not correct')
    expect(answerWords(0.5)).toBe('Partly correct (50%)')
  })
  it('shows a missing score as missing, not 0', () => {
    expect(answerWords(null)).toBe('Missing')
  })
})
