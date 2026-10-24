/**
 * A screen owns its own folder. What two screens share lives in `app/`,
 * `run/`, `components/` or `design/`, never in one screen's module.
 */

import { describe, expect, it } from 'vitest'

const sources = import.meta.glob<string>('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
})

/** The screen folder of a source path, or null for a file outside every screen. */
const screenOf = (path: string) =>
  /^\/src\/screens\/([^/]+)\//.exec(path)?.[1] ?? null

/** Every module a source file imports, from `from '...'`, `import '...'` and `import('...')`. */
const importsOf = (source: string): string[] =>
  [...source.matchAll(/\b(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map(
    (match) => match[1],
  )

/** The screen folder of the source file an import resolves to, or null for any other module. */
function targetScreen(from: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null
  const parts = from.split('/').slice(0, -1)
  for (const part of specifier.split('/')) {
    if (part === '..') parts.pop()
    else if (part !== '.') parts.push(part)
  }
  const base = parts.join('/')
  const file = [`${base}.ts`, `${base}.tsx`, `${base}/index.tsx`].find(
    (candidate) => candidate in sources,
  )
  return file === undefined ? null : screenOf(file)
}

describe('screens', () => {
  it('import nothing from another screen', () => {
    const crossings = Object.entries(sources).flatMap(([path, source]) => {
      const own = screenOf(path)
      if (own === null) return []
      return importsOf(source)
        .filter((specifier) => {
          const target = targetScreen(path, specifier)
          return target !== null && target !== own
        })
        .map((specifier) => `${path} imports ${specifier}`)
    })
    expect(crossings).toEqual([])
  })

  it('are found by the scan, so an empty result is not a broken scan', () => {
    const screens = new Set(Object.keys(sources).map(screenOf))
    expect(screens).toEqual(
      new Set([null, 'data-model', 'help', 'live-lab', 'overview', 'results']),
    )
    const help = '/src/screens/help/what.tsx'
    expect(targetScreen(help, '../overview/overview')).toBe('overview')
    expect(targetScreen(help, './section')).toBe('help')
    expect(targetScreen(help, '../screen')).toBeNull()
    expect(targetScreen(help, '../../app/router')).toBeNull()
    expect(targetScreen(help, 'react')).toBeNull()
  })
})
