import { describe, expect, it } from 'vitest'

import { isFullOfficial, verdictFrom } from './latest-run'

const cell = (mean: number | null, n: number, repeats: number) => ({
  mean,
  n,
  repeats,
})

const summary = (selection: unknown) => ({
  selection,
  headlines: ['Graph beat text search.'],
  metrics: {
    overall: {
      evidence_f1: {
        A: cell(0.25, 114, 342),
        B: cell(null, 0, 0),
        C: cell(0.5, 114, 342),
      },
    },
  },
})

const run = (run_kind: string, label: string | null, selection: unknown) => ({
  run_id: 'r',
  run_kind,
  label,
  summary: summary(selection),
})

const FULL = { strata: null, limit: null }

describe('verdictFrom', () => {
  it('reads the overall evidence F1 and counts of a full official run', () => {
    expect(verdictFrom(run('official', null, FULL))).toEqual({
      kind: 'official',
      tiles: [
        { pipeline: 'A', mean: 0.25, n: 114, repeats: 342 },
        { pipeline: 'B', mean: null, n: 0, repeats: 0 },
        { pipeline: 'C', mean: 0.5, n: 114, repeats: 342 },
      ],
      headlines: ['Graph beat text search.'],
    })
  })

  it('keeps a missing mean as null, never zero', () => {
    const verdict = verdictFrom(run('official', null, FULL))
    expect(verdict.kind === 'official' && verdict.tiles[1].mean).toBeNull()
  })

  it('is empty-handed when the run is missing a metrics block', () => {
    const bare = {
      run_id: 'r',
      run_kind: 'official',
      label: null,
      summary: { selection: FULL },
    }
    expect(verdictFrom(bare)).toEqual({
      kind: 'official',
      tiles: ['A', 'B', 'C'].map((pipeline) => ({
        pipeline,
        mean: null,
        n: 0,
        repeats: 0,
      })),
      headlines: [],
    })
  })

  it('never fills tiles from a smoke run, and names it by its label', () => {
    expect(verdictFrom(run('smoke', 'scorer smoke test', FULL))).toEqual({
      kind: 'none',
      otherRun: 'scorer smoke test',
    })
  })

  it('never fills tiles from a subset official run', () => {
    expect(
      verdictFrom(run('official', 'subset run', { strata: null, limit: 1 })),
    ).toEqual({ kind: 'none', otherRun: 'subset run' })
    expect(
      verdictFrom(run('official', null, { strata: ['H1'], limit: null })),
    ).toEqual({ kind: 'none', otherRun: 'official run' })
  })

  it('names an unlabelled run of another kind in words', () => {
    expect(verdictFrom(run('sweep', null, FULL))).toEqual({
      kind: 'none',
      otherRun: 'depth sweep',
    })
  })

  it('treats no published run as plain none', () => {
    expect(verdictFrom(null)).toEqual({ kind: 'none', otherRun: null })
  })
})

describe('isFullOfficial', () => {
  it('needs kind official and a selection with no strata and no limit', () => {
    expect(isFullOfficial(run('official', null, FULL))).toBe(true)
    expect(isFullOfficial(run('smoke', null, FULL))).toBe(false)
    expect(isFullOfficial(run('official', null, undefined))).toBe(false)
  })
})
