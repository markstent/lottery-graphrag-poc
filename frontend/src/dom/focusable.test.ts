import { describe, expect, it } from 'vitest'

import { focusableIn } from './focusable'

function page(html: string): HTMLElement {
  const root = document.createElement('div')
  root.innerHTML = html
  document.body.append(root)
  return root
}

describe('focusableIn', () => {
  it('lists links, enabled controls and tab-indexed elements in order', () => {
    const root = page(`
      <a href="#x" id="a">a</a>
      <button id="b">b</button>
      <button id="c" disabled>c</button>
      <input id="d" /><div tabindex="0" id="e"></div>
      <div tabindex="-1" id="f"></div>`)
    expect(focusableIn(root).map((el) => el.id)).toEqual(['a', 'b', 'd', 'e'])
  })

  it('skips elements that are hidden or not displayed, or inside one', () => {
    const root = page(`
      <button id="a" hidden>a</button>
      <button id="b" style="display: none">b</button>
      <div hidden><button id="c">c</button></div>
      <div style="display: none"><a href="#" id="d">d</a></div>
      <button id="e">e</button>`)
    expect(focusableIn(root).map((el) => el.id)).toEqual(['e'])
  })
})
