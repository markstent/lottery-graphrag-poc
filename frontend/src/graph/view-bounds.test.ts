import { describe, expect, it } from 'vitest'

import { nextAfter, outOfView, outOfViewNote } from './view-bounds'

const size = { width: 400, height: 300 }
const still = { x: 0, y: 0, zoom: 1 }
const box = (id: string, x: number, y: number) => ({
  id,
  x,
  y,
  width: 100,
  height: 50,
})

describe('outOfView', () => {
  it('counts a node as in view only when all of it is inside the frame', () => {
    const nodes = [
      box('inside', 10, 10),
      box('cut-right', 350, 10),
      box('cut-bottom', 10, 280),
      box('cut-left', -20, 10),
      box('cut-top', 10, -5),
      box('far', 900, 900),
    ]
    expect(outOfView(nodes, still, size)).toEqual([
      'cut-right',
      'cut-bottom',
      'cut-left',
      'cut-top',
      'far',
    ])
  })

  it('follows the viewport pan and zoom', () => {
    const nodes = [box('a', 350, 100)]
    expect(outOfView(nodes, still, size)).toEqual(['a'])
    expect(outOfView(nodes, { x: -100, y: 0, zoom: 1 }, size)).toEqual([])
    expect(outOfView(nodes, { x: 0, y: 0, zoom: 0.5 }, size)).toEqual([])
  })

  it('keeps the order it was given', () => {
    const nodes = [box('b', 900, 0), box('a', 800, 0)]
    expect(outOfView(nodes, still, size)).toEqual(['b', 'a'])
  })
})

describe('outOfViewNote', () => {
  it('counts the nodes, in the singular and the plural, and is empty for none', () => {
    expect(outOfViewNote(0)).toBe('')
    expect(outOfViewNote(1)).toBe('1 evidence node out of view')
    expect(outOfViewNote(2)).toBe('2 evidence nodes out of view')
  })
})

describe('nextAfter', () => {
  it('steps through the ids and wraps', () => {
    expect(nextAfter(['a', 'b'], null)).toBe('a')
    expect(nextAfter(['a', 'b'], 'a')).toBe('b')
    expect(nextAfter(['a', 'b'], 'b')).toBe('a')
    expect(nextAfter(['a', 'b'], 'gone')).toBe('a')
    expect(nextAfter([], null)).toBeUndefined()
  })
})
