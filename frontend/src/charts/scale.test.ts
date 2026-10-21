import { describe, expect, it } from 'vitest'

import {
  extent,
  formatOrGap,
  formatRange,
  formatNumber,
  decimalsFor,
  formatTick,
  linearScale,
  niceTicks,
  wrapText,
} from './scale'

describe('linearScale', () => {
  it('maps the domain ends to the range ends and interpolates between', () => {
    const y = linearScale([0, 100], [300, 0])
    expect(y(0)).toBe(300)
    expect(y(100)).toBe(0)
    expect(y(25)).toBe(225)
  })

  it('maps values outside the domain linearly rather than clamping', () => {
    expect(linearScale([0, 10], [0, 100])(-5)).toBe(-50)
  })

  it('maps a zero-width domain to the range start', () => {
    expect(linearScale([3, 3], [10, 20])(3)).toBe(10)
  })
})

describe('niceTicks', () => {
  it('rounds to clean numbers that cover the domain', () => {
    expect(niceTicks([0, 100], 5)).toEqual([0, 20, 40, 60, 80, 100])
    expect(niceTicks([0, 0.93], 5)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1])
    expect(niceTicks([-0.3, 0.45], 5)).toEqual([-0.4, -0.2, 0, 0.2, 0.4, 0.6])
  })
})

describe('extent', () => {
  it('ignores null values and is null when nothing remains', () => {
    expect(extent([3, null, -2, undefined, 7])).toEqual([-2, 7])
    expect(extent([null, null])).toBeNull()
  })
})

describe('formatNumber', () => {
  it('groups thousands, signs on request and never prints a negative zero', () => {
    expect(formatNumber(12345.6, { decimals: 0 })).toBe('12,346')
    expect(formatNumber(4.2, { decimals: 1, signed: true })).toBe('+4.2')
    expect(formatNumber(-4.2, { decimals: 1, signed: true })).toBe('-4.2')
    expect(formatNumber(-0.001, { decimals: 1, signed: true })).toBe('0.0')
  })

  it('compacts ticks from a thousand up', () => {
    expect(formatTick(0)).toBe('0')
    expect(formatTick(2000)).toBe('2K')
    expect(formatTick(0.2)).toBe('0.2')
  })
})

describe('decimalsFor', () => {
  it('keeps one decimal on a wide domain and two on a unit one', () => {
    expect(decimalsFor([0, 100])).toBe(1)
    expect(decimalsFor([0, 1])).toBe(2)
  })
})

describe('wrapText', () => {
  it('wraps on words and ends an overlong label with an ellipsis', () => {
    expect(wrapText('multi hop reasoning', 10, 3)).toEqual([
      'multi hop',
      'reasoning',
    ])
    expect(wrapText('one two three four five six', 8, 2)).toEqual([
      'one two',
      'three f…',
    ])
  })
})

describe('gap and range text', () => {
  const one = (v: number) => v.toFixed(1)
  it('writes a null as no value and a given interval as low to high', () => {
    expect(formatOrGap(null, one)).toBe('no value')
    expect(formatOrGap(undefined, one)).toBe('no value')
    expect(formatOrGap(2, one)).toBe('2.0')
    expect(formatRange(1, 3, one)).toBe('1.0 to 3.0')
  })
})
