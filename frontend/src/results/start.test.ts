import { describe, expect, it } from 'vitest'

import defaultRequest from '../../e2e/fixtures/start-default-request.json'
import {
  DEFAULT_FORM,
  errorsOf,
  progressFraction,
  progressText,
  serverErrors,
  startBody,
  withKind,
  type StartForm,
} from './start'

const form = (change: Partial<StartForm> = {}): StartForm => ({
  ...DEFAULT_FORM,
  ...change,
})

describe('errorsOf', () => {
  it('a development run needs one repeat', () => {
    expect(errorsOf(form({ kind: 'dev', repeats: '1' }))).toEqual({})
    expect(errorsOf(form({ kind: 'dev', repeats: '0' })).repeats).toBe(
      'Use a whole number, at least 1.',
    )
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

  it('needs a kind of question when the scope is chosen', () => {
    expect(errorsOf(form({ scope: 'chosen' })).strata).toBe(
      'Choose at least one kind.',
    )
    expect(errorsOf(form({ scope: 'chosen', strata: ['H1'] }))).toEqual({})
    expect(errorsOf(form({ scope: 'bank', strata: [] }))).toEqual({})
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
  it('sends by default the request the API accepts as it stands (test_api_benchmarks.py posts the same)', () => {
    expect(startBody(form())).toEqual(defaultRequest)
    expect(startBody(form())).toEqual({
      kind: 'dev',
      seeds: [2026],
      repeats: 1,
      strata: null,
      limit: null,
    })
  })

  it('sends no strata for the whole bank even when kinds were ticked', () => {
    expect(startBody(form({ scope: 'bank', strata: ['H1'] })).strata).toBeNull()
  })

  it('sends chosen worlds in order, strata and the limit', () => {
    expect(
      startBody(
        form({
          kind: 'smoke',
          worlds: [2028, 2026],
          repeats: '1',
          scope: 'chosen',
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

  // The shapes the backend reports (test_api_benchmarks.py pins the same):
  // worlds_done already includes a world whose questions are all done.
  const endOfWorld = {
    world_seed: 2027,
    worlds_done: 2,
    worlds_total: 3,
    instances_done: 40,
    instances_total: 40,
  }
  const endOfRun = { ...endOfWorld, world_seed: 2028, worlds_done: 3 }

  it('counts a finished world once, between worlds', () => {
    expect(progressText(endOfWorld)).toBe(
      'World 2027 (2 of 3): 40 of 40 questions',
    )
    expect(progressFraction(endOfWorld)).toBeCloseTo(2 / 3)
  })

  it('never passes the whole run or reads past the last world', () => {
    expect(progressText(endOfRun)).toBe(
      'World 2028 (3 of 3): 40 of 40 questions',
    )
    expect(progressFraction(endOfRun)).toBe(1)
  })
})

describe('withKind', () => {
  it('keeps the chosen worlds the kind may use, and Repeats as typed', () => {
    const smoke = withKind(form({ repeats: '5' }), 'smoke')
    expect(smoke).toMatchObject({ kind: 'smoke', worlds: [2026], repeats: '5' })
    const three = { ...smoke, worlds: [2026, 2027, 2028] }
    expect(withKind(three, 'dev').worlds).toEqual([2026])
  })

  it('gives a kind all the worlds it may use when none of the chosen ones fit', () => {
    expect(
      withKind(form({ kind: 'smoke', worlds: [2027] }), 'dev').worlds,
    ).toEqual([2026])
    expect(withKind(form({ worlds: [] }), 'smoke').worlds).toEqual([
      2026, 2027, 2028,
    ])
  })
})

describe('serverErrors', () => {
  it('gives each part that names a field to that field', () => {
    expect(
      serverErrors(
        'unknown seeds [2029]; repeats: Input should be greater than or equal to 1; kind: bad',
      ),
    ).toEqual({
      fields: {
        worlds: 'unknown seeds [2029]',
        repeats: 'repeats: Input should be greater than or equal to 1',
      },
      rest: 'kind: bad',
    })
  })

  it('keeps a message that names no field as the form message', () => {
    expect(serverErrors('invalid request')).toEqual({
      fields: {},
      rest: 'invalid request',
    })
  })
})
