import { describe, expect, it } from 'vitest'

import type { Schemas } from '../api/client'
import { RUNS } from './results.fixtures'
import { defaultRun, selectionText, standing } from './runs'

type Run = Schemas['BenchmarkRunOut']

const run = (
  run_id: string,
  run_kind: string,
  started_at: string,
  selection: Run['selection'] = { strata: null, limit: null },
): Run => ({
  run_id,
  run_kind,
  label: null,
  started_at,
  selection,
  worlds: [2026],
  headlines: [],
})

const smoke = run('s', 'smoke', '2026-10-19T00:00:00Z')
const subset = run('p', 'official', '2026-10-18T00:00:00Z', {
  strata: null,
  limit: 2,
})
const full = run('f', 'official', '2026-10-17T00:00:00Z')

describe('standing', () => {
  it('quick check is never a result', () =>
    expect(standing(smoke)).toBe('quick-check'))
  it('an official run with a limit or strata is a subset', () => {
    expect(standing(subset)).toBe('subset')
    expect(
      standing(
        run('x', 'official', '2026-10-17T00:00:00Z', { strata: ['H1'] }),
      ),
    ).toBe('subset')
  })
  it('an official run of the whole bank is a result', () =>
    expect(standing(full)).toBe('result'))
  it('classifies the captured runs', () =>
    expect(RUNS.map((r) => [r.run_id, standing(r)])).toEqual([
      ['pilot-2026-nothink', 'subset'],
      ['pilot-2026', 'subset'],
      ['20261019T164733Z-smoke', 'quick-check'],
    ]))
})

describe('defaultRun', () => {
  it('default run prefers a full official run, however old', () =>
    expect(defaultRun([smoke, subset, full])).toBe('f'))
  it('takes the newest of several results', () =>
    expect(
      defaultRun([full, run('g', 'official', '2026-10-20T00:00:00Z')]),
    ).toBe('g'))
  it('falls back to the newest subset, then to the newest run', () => {
    expect(defaultRun([smoke, subset])).toBe('p')
    expect(defaultRun([smoke])).toBe('s')
  })
  it('is null without runs', () => expect(defaultRun([])).toBeNull())
  it('does not rely on the order it is given', () =>
    expect(
      defaultRun([
        run('old', 'official', '2026-10-01T00:00:00Z'),
        run('new', 'official', '2026-10-02T00:00:00Z'),
      ]),
    ).toBe('new'))
})

describe('selectionText', () => {
  it('is null for a whole-bank selection', () =>
    expect(selectionText({ strata: null, limit: null })).toBeNull())
  it('names strata and limit', () =>
    expect(selectionText({ strata: ['depth'], limit: 3 })).toBe(
      'Subset (strata: depth; at most 3 instances per question)',
    ))
  it('reads a limit alone as all strata', () =>
    expect(selectionText({ strata: null, limit: 1 })).toBe(
      'Subset (all strata; at most 1 instance per question)',
    ))
})
