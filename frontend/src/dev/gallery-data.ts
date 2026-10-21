/**
 * The numbers the gallery's charts draw. They are display values for looking
 * at each chart in each state; no run produced them, and nothing in the
 * application reads them. The graph sections use the recorded run instead.
 */

import type { BarGroup } from '../charts/grouped-bars'
import type { IntervalRow } from '../charts/interval-plot'

export const BAR_GROUPS: readonly BarGroup[] = [
  { key: 'H1', label: 'Single record', values: { A: 62.5, B: 64, C: 70.5 } },
  {
    key: 'H2',
    label: 'Several records in one market',
    values: { A: 48, B: 61.5, C: 66 },
  },
  {
    key: 'H3',
    label: 'Multi-hop reasoning across markets',
    values: { A: 31, B: 52, C: 68.5 },
  },
  { key: 'H4', label: 'Name-anchored', values: { A: 55, B: 57.5, C: 59 } },
]

export const BAR_INTERVALS = {
  H1: { A: [55, 70], B: [57, 71], C: [64, 77] },
  H2: { A: [40, 56], B: [54, 69], C: [58, 74] },
  H3: { A: [22, 40], B: [44, 60], C: [60, 77] },
  H4: { A: [46, 64], B: [49, 66], C: [51, 67] },
} as const

export const BAR_DELTA = {
  between: ['C', 'A'],
  values: { H1: 8, H2: 18, H3: 37.5, H4: 4 },
} as const

export const BAR_GROUPS_WITH_GAPS: readonly BarGroup[] = [
  { key: 'H1', label: 'Single record', values: { A: 62.5, B: null, C: 70.5 } },
  {
    key: 'H3',
    label: 'Multi-hop reasoning across markets',
    values: { A: null, B: null, C: 68.5 },
  },
]

export const BAR_GROUPS_NEGATIVE: readonly BarGroup[] = [
  { key: 'H1', label: 'Single record', values: { A: -4, B: 6.5, C: 12 } },
  { key: 'H2', label: 'Several records', values: { A: -11.5, B: -2, C: 5 } },
  { key: 'H3', label: 'Multi-hop reasoning', values: { A: 3, B: -7.5, C: 9 } },
]

export const INTERVAL_ROWS: readonly IntervalRow[] = [
  {
    key: 'ba-all',
    label: 'B against A, all questions',
    mean: 11.5,
    low: 6,
    high: 17,
    n: 96,
    groups: 24,
    inFamily: true,
    pipeline: 'B',
  },
  {
    key: 'cb-all',
    label: 'C against B, all questions',
    mean: 8.5,
    low: 3,
    high: 14.5,
    n: 96,
    groups: 24,
    inFamily: true,
    pipeline: 'C',
  },
  {
    key: 'cb-multi',
    label: 'C against B, multi-hop reasoning across markets',
    mean: -1.5,
    low: -7,
    high: 4,
    n: 36,
    groups: 12,
    inFamily: true,
    pipeline: 'C',
  },
  {
    key: 'cb-name',
    label: 'C against B, name-anchored',
    mean: 1,
    low: -5,
    high: 8,
    n: 8,
    groups: 2,
    inFamily: false,
    note: 'not tested: too few pairs or groups',
    pipeline: 'C',
  },
]

export const INTERVAL_ROWS_WITH_GAPS: readonly IntervalRow[] = [
  INTERVAL_ROWS[0],
  {
    ...INTERVAL_ROWS[1],
    key: 'cb-gap',
    label: 'C against B, no interval yet',
    mean: 8.5,
    low: null,
    high: null,
  },
  {
    ...INTERVAL_ROWS[2],
    key: 'cb-none',
    label: 'C against B, no value',
    mean: null,
    low: null,
    high: null,
  },
]

export const INTERVAL_ROWS_NEGATIVE: readonly IntervalRow[] = [
  { ...INTERVAL_ROWS[0], mean: -9, low: -15.5, high: -3, key: 'n1' },
  { ...INTERVAL_ROWS[1], mean: -4.5, low: -10, high: 1.5, key: 'n2' },
  { ...INTERVAL_ROWS[2], mean: -12, low: -19, high: -6, key: 'n3' },
]
