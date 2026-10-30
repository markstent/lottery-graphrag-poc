import { afterEach, describe, expect, it } from 'vitest'

import { scrollBoxOf } from './tooltip'

/** A box with `overflow-x: auto` whose content is `content` pixels wide in a 300 pixel box. */
function box(content: number, parent: HTMLElement = document.body) {
  const el = document.createElement('div')
  el.style.overflowX = 'auto'
  Object.defineProperty(el, 'clientWidth', { value: 300 })
  Object.defineProperty(el, 'scrollWidth', { value: content })
  parent.append(el)
  return el
}

afterEach(() => document.body.replaceChildren())

describe('scrollBoxOf', () => {
  it('passes over a box that does not scroll sideways, such as a page that scrolls only up and down', () => {
    // overflow-y: auto computes overflow-x to auto too, with nothing to scroll sideways.
    const page = box(300)
    const plot = document.createElement('div')
    page.append(plot)
    expect(scrollBoxOf(plot)).toBeNull()
  })

  it('finds the nearest box whose content is wider than it', () => {
    const page = box(300)
    const chart = box(900, page)
    const plot = document.createElement('div')
    chart.append(plot)
    expect(scrollBoxOf(plot)).toBe(chart)
  })
})
