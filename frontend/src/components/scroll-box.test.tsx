import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ScrollBox } from './scroll-box'

/** A ResizeObserver that records what it watches and fires only when told. */
class Watcher {
  static all: Watcher[] = []
  watched = new Set<Element>()
  constructor(private readonly callback: ResizeObserverCallback) {
    Watcher.all.push(this)
  }
  observe(target: Element) {
    this.watched.add(target)
  }
  unobserve(target: Element) {
    this.watched.delete(target)
  }
  disconnect() {
    this.watched.clear()
  }
  /** A size change of `target`, as the browser reports it. */
  static resize(target: Element) {
    for (const watcher of Watcher.all)
      if (watcher.watched.has(target))
        watcher.callback([], watcher as unknown as ResizeObserver)
  }
}

/** The box's content is `wide` pixels wide in a 300 pixel box. */
function measure(box: HTMLElement, wide: number) {
  Object.defineProperty(box, 'clientWidth', {
    configurable: true,
    value: 300,
  })
  Object.defineProperty(box, 'scrollWidth', {
    configurable: true,
    value: wide,
  })
}

const box = (container: HTMLElement) =>
  container.firstElementChild as HTMLElement

beforeEach(() => {
  Watcher.all = []
  vi.stubGlobal('ResizeObserver', Watcher)
})
afterEach(() => vi.unstubAllGlobals())

describe('ScrollBox', () => {
  it('is a plain box with no name and no tab stop while its content fits', () => {
    const { container } = render(
      <ScrollBox label="Scorecard">
        <table />
      </ScrollBox>,
    )
    const el = box(container)
    expect(el).not.toHaveAttribute('role')
    expect(el).not.toHaveAttribute('aria-label')
    expect(el).not.toHaveAttribute('tabindex')
    expect(screen.queryByRole('group')).toBeNull()
  })

  it('is a named group and a tab stop while its content is wider than it', () => {
    const { container } = render(
      <ScrollBox label="Scorecard">
        <table />
      </ScrollBox>,
    )
    const el = box(container)
    measure(el, 900)
    act(() => Watcher.resize(el))
    expect(screen.getByRole('group', { name: 'Scorecard' })).toBe(el)
    expect(el).toHaveAttribute('tabindex', '0')
  })

  it('watches content that replaces the first after mount', async () => {
    const { container, rerender } = render(
      <ScrollBox label="Questions">
        <p key="loading">Loading</p>
      </ScrollBox>,
    )
    const el = box(container)
    rerender(
      <ScrollBox label="Questions">
        <table key="table" />
      </ScrollBox>,
    )
    const table = el.querySelector('table')!
    // The observer that sees new children runs after the change, as in a browser.
    await act(async () => undefined)
    measure(el, 900)
    act(() => Watcher.resize(table))
    expect(el).toHaveAttribute('tabindex', '0')
  })
})
