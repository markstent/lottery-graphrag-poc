import { describe, expect, it } from 'vitest'

import { roundedPath } from './edge-path'

describe('roundedPath', () => {
  it('draws a straight route as one line', () => {
    expect(
      roundedPath([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ]),
    ).toBe('M0,0 L100,0')
  })

  it('rounds each corner with a curve of at most 10 px', () => {
    expect(
      roundedPath([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 50 },
        { x: 200, y: 50 },
      ]),
    ).toBe('M0,0 L90,0 Q100,0 100,10 L100,40 Q100,50 110,50 L200,50')
  })

  it('shrinks the curve to half of the shorter segment', () => {
    expect(
      roundedPath([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 8 },
      ]),
    ).toBe('M0,0 L6,0 Q10,0 10,4 L10,8')
  })
})
