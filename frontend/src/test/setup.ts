import '@testing-library/jest-dom/vitest'

// jsdom does not implement matchMedia; the settings provider listens to it
// for prefers-reduced-motion.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList) as typeof window.matchMedia
}

// React Flow measures with ResizeObserver and DOMMatrixReadOnly, which jsdom
// does not implement.
if (typeof ResizeObserver === 'undefined') {
  // The callback runs once on observe, as a browser does, so nodes are measured.
  globalThis.ResizeObserver = class {
    callback: ResizeObserverCallback
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback
    }
    observe(target: Element) {
      this.callback(
        [
          {
            target,
            contentRect: { width: 1000, height: 700 },
          } as ResizeObserverEntry,
        ],
        this as unknown as ResizeObserver,
      )
    }
    unobserve() {}
    disconnect() {}
  }
  // jsdom has no layout; every element measures the same.
  for (const [name, value] of [
    ['offsetWidth', 260],
    ['offsetHeight', 64],
  ] as const)
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      get: () => value,
    })
}
if (typeof DOMMatrixReadOnly === 'undefined') {
  globalThis.DOMMatrixReadOnly = class {
    m22 = 1
    constructor(transform?: string) {
      const scale = /scale\(([\d.]+)\)/.exec(transform ?? '')
      if (scale) this.m22 = Number(scale[1])
    }
  } as unknown as typeof DOMMatrixReadOnly
}
