/**
 * Minimal hash router for the eight IA routes
 * (docs/ux/information-architecture.md section 2; Help added at HITL-11).
 *
 * Chosen over adding react-router: eight static routes with one query
 * parameter each; a 40-line module keeps the dependency count down
 * (DECISIONS.md D-011). Deep links survive refresh by design.
 */

import { useEffect, useState } from 'react'

export type RouteName =
  | 'lab'
  | 'experiment'
  | 'scenarios'
  | 'evidence'
  | 'benchmark'
  | 'results'
  | 'semantic'
  | 'help'
  | 'dictionary'

export interface Route {
  name: RouteName
  params: URLSearchParams
}

const ROUTES: RouteName[] = [
  'lab',
  'experiment',
  'scenarios',
  'evidence',
  'benchmark',
  'results',
  'semantic',
  'help',
  'dictionary',
]

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '')
  const [path, query = ''] = raw.split('?')
  const name = (ROUTES as string[]).includes(path) ? (path as RouteName) : 'lab'
  return { name, params: new URLSearchParams(query) }
}

export function hrefFor(
  name: RouteName,
  params?: Record<string, string>,
): string {
  const query = params ? `?${new URLSearchParams(params).toString()}` : ''
  return `#/${name}${query}`
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash))
  useEffect(() => {
    // Live Lab is the home screen: give the bare URL an explicit hash so
    // refreshes and shared links always reopen the same screen.
    if (!window.location.hash) {
      window.history.replaceState(null, '', '#/lab')
    }
    const onChange = () => setRoute(parseHash(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}
