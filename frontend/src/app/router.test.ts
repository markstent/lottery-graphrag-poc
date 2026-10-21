import { describe, expect, it } from 'vitest'

import { hrefFor, parseHash } from './router'

describe('router', () => {
  it('opens Overview for an empty or unknown hash', () => {
    expect(parseHash('').name).toBe('overview')
    expect(parseHash('#/nowhere').name).toBe('overview')
  })

  it.each([
    ['#/overview', 'overview'],
    ['#/live-lab', 'live-lab'],
    ['#/results', 'results'],
    ['#/data-model', 'data-model'],
    ['#/help', 'help'],
  ])('knows %s', (hash, name) => {
    expect(parseHash(hash).name).toBe(name)
  })

  it.each([
    ['#/lab', 'live-lab'],
    ['#/experiment', 'overview'],
    ['#/dictionary', 'data-model'],
    ['#/semantic', 'data-model'],
    ['#/scenarios', 'data-model'],
    ['#/benchmark', 'results'],
    ['#/evidence', 'live-lab'],
  ])('sends the old %s to %s', (hash, name) => {
    expect(parseHash(hash).name).toBe(name)
  })

  it('keeps the query through a redirect', () => {
    const route = parseHash('#/evidence?run=RUN-1&evidence=X')
    expect(route.name).toBe('live-lab')
    expect(route.params.get('run')).toBe('RUN-1')
  })

  it('builds a hash with its query', () => {
    expect(hrefFor('live-lab', { run: 'RUN-1' })).toBe('#/live-lab?run=RUN-1')
    expect(hrefFor('help')).toBe('#/help')
  })
})
