import { describe, expect, it } from 'vitest'

import type { Schemas } from '../api/client'
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
      evidence_recall: {
        A: cell(0.4, 120, 360),
        B: cell(0.6, 120, 360),
        C: cell(0.7, 120, 360),
      },
    },
  },
})

// Only the keys the Overview tiles read are built; the cast stands in for the rest of the summary.
const run = (
  run_kind: string,
  label: string | null,
  selection: unknown,
  method_version = '0.2.0',
): Schemas['BenchmarkSummary'] =>
  ({
    run_id: 'r',
    run_kind,
    label,
    method_version,
    summary: summary(selection),
  }) as unknown as Schemas['BenchmarkSummary']

const FULL = { strata: null, limit: null }

describe('verdictFrom', () => {
  it('reads the overall evidence F1 and counts of a full official run of method v0.2', () => {
    expect(verdictFrom(run('official', null, FULL))).toEqual({
      kind: 'official',
      method: '0.2.0',
      metric: 'evidence_f1',
      note: null,
      tiles: [
        { pipeline: 'A', mean: 0.25, n: 114, repeats: 342 },
        { pipeline: 'B', mean: null, n: 0, repeats: 0 },
        { pipeline: 'C', mean: 0.5, n: 114, repeats: 342 },
      ],
      headlines: ['Graph beat text search.'],
    })
  })

  it('reads evidence recall, by its name, from a run of method v0.3', () => {
    expect(verdictFrom(run('official', null, FULL, '0.3.0'))).toMatchObject({
      kind: 'official',
      method: '0.3.0',
      metric: 'evidence_recall',
      tiles: [
        { pipeline: 'A', mean: 0.4, n: 120, repeats: 360 },
        { pipeline: 'B', mean: 0.6, n: 120, repeats: 360 },
        { pipeline: 'C', mean: 0.7, n: 120, repeats: 360 },
      ],
    })
  })

  it('carries the declaration of the method change a v0.3 summary makes', () => {
    const v03 = run('official', null, FULL, '0.3.0')
    const declared = {
      ...v03,
      summary: {
        ...v03.summary,
        method_note: 'Method v0.3 was made after v0.2.0.',
      },
    }
    expect(verdictFrom(declared)).toMatchObject({
      note: 'Method v0.3 was made after v0.2.0.',
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
      method_version: '0.3.0',
      summary: { selection: FULL },
    } as unknown as Schemas['BenchmarkSummary']
    expect(verdictFrom(bare)).toEqual({
      kind: 'official',
      method: '0.3.0',
      metric: 'evidence_recall',
      note: null,
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
    ).toEqual({ kind: 'none', otherRun: 'Official run' })
  })

  it('names an unlabelled run of another kind in words', () => {
    expect(verdictFrom(run('sweep', null, FULL))).toEqual({
      kind: 'none',
      otherRun: 'Depth sweep',
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
