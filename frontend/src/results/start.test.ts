import { describe, expect, it } from 'vitest'

import {
  DEFAULT_FORM,
  errorsOf,
  progressFraction,
  progressText,
  startBody,
  type StartForm,
} from './start'

const form = (change: Partial<StartForm> = {}): StartForm => ({
  ...DEFAULT_FORM,
  ...change,
})

describe('errorsOf', () => {
  it('official run needs three repeats', () => {
    expect(errorsOf(form({ kind: 'official', repeats: '2' })).repeats).toBe(
      'Use a whole number, at least 3.',
    )
    expect(errorsOf(form({ kind: 'official', repeats: '3' }))).toEqual({})
  })

  it('a quick check needs one repeat', () => {
    expect(errorsOf(form({ kind: 'smoke', repeats: '1' }))).toEqual({})
    expect(errorsOf(form({ kind: 'smoke', repeats: '0' })).repeats).toMatch(
      /at least 1/,
    )
  })

  it('refuses repeats that are not whole numbers', () => {
    expect(errorsOf(form({ repeats: '' })).repeats).toBeDefined()
    expect(errorsOf(form({ repeats: '3.5' })).repeats).toBeDefined()
  })

  it('needs a world and a whole-number limit when one is given', () => {
    expect(errorsOf(form({ worlds: [] })).worlds).toBe(
      'Choose at least one world.',
    )
    expect(errorsOf(form({ limit: '0' })).limit).toBeDefined()
    expect(errorsOf(form({ limit: 'x' })).limit).toBeDefined()
    expect(errorsOf(form({ limit: '' }))).toEqual({})
    expect(errorsOf(form({ limit: '2' }))).toEqual({})
  })
})

describe('startBody', () => {
  it('sends the whole bank when no kind of question is chosen', () => {
    expect(startBody(form())).toEqual({
      kind: 'official',
      seeds: [2026, 2027, 2028],
      repeats: 3,
      strata: null,
      limit: null,
    })
  })

  it('sends chosen worlds in order, strata and the limit', () => {
    expect(
      startBody(
        form({
          kind: 'smoke',
          worlds: [2028, 2026],
          repeats: '1',
          strata: ['H1', 'H3'],
          limit: '2',
        }),
      ),
    ).toEqual({
      kind: 'smoke',
      seeds: [2026, 2028],
      repeats: 1,
      strata: ['H1', 'H3'],
      limit: 2,
    })
  })
})

describe('progress', () => {
  const progress = {
    world_seed: 2027,
    worlds_done: 1,
    worlds_total: 3,
    instances_done: 12,
    instances_total: 40,
  }

  it('reads as the world and the questions done', () => {
    expect(progressText(progress)).toBe(
      'World 2027 (2 of 3): 12 of 40 questions',
    )
    expect(progressText(null)).toBe('Starting')
  })

  it('is the share of the whole run done, worlds counted whole', () => {
    expect(progressFraction(progress)).toBeCloseTo((1 + 12 / 40) / 3)
    expect(progressFraction(null)).toBe(0)
  })
})
