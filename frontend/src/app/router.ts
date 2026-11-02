/**
 * Hash router for the six destinations (spec 7.1; Architecture since D-109).
 * A hand-written module rather than react-router: six static routes, and deep links survive a
 * refresh by design (DECISIONS.md D-011). The routes of the earlier
 * application redirect to the destination that took their place.
 */

import { useEffect, useMemo, useSyncExternalStore } from 'react'

export type RouteName =
  'overview' | 'live-lab' | 'results' | 'data-model' | 'architecture' | 'help'

export interface Destination {
  name: RouteName
  label: string
  /** The sentence the destination is described by, from spec 7.1. */
  purpose: string
}

export const DESTINATIONS: readonly Destination[] = [
  {
    name: 'overview',
    label: 'Overview',
    purpose:
      'What we found, how the three approaches work, and questions to try',
  },
  {
    name: 'live-lab',
    label: 'Live Lab',
    purpose:
      'Run one question through all three approaches and watch them work',
  },
  {
    name: 'results',
    label: 'Results',
    purpose: 'Every official run, every question, every score, with intervals',
  },
  {
    name: 'data-model',
    label: 'Data Model',
    purpose:
      'What the warehouse, the graph and the ontology look like, with live counts and sample rows',
  },
  {
    name: 'architecture',
    label: 'Architecture',
    purpose:
      'The tech stack: the data platform, the graph and ontology layers on top, and what each part runs on',
  },
  {
    name: 'help',
    label: 'Help',
    purpose:
      'How it works, every benchmark question with its answer key, glossary, how to run it',
  },
]

export interface Route {
  name: RouteName
  params: URLSearchParams
}

const DEFAULT_ROUTE: RouteName = 'overview'

const LEGACY: Record<string, RouteName> = {
  lab: 'live-lab',
  experiment: 'overview',
  dictionary: 'data-model',
  semantic: 'data-model',
  scenarios: 'data-model',
  benchmark: 'results',
  evidence: 'live-lab',
}

const NAMES: readonly string[] = DESTINATIONS.map(({ name }) => name)

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '')
  const [path, query = ''] = raw.split('?')
  const name = NAMES.includes(path)
    ? (path as RouteName)
    : (LEGACY[path] ?? DEFAULT_ROUTE)
  return { name, params: new URLSearchParams(query) }
}

export function hrefFor(
  name: RouteName,
  params?: Record<string, string>,
): string {
  const query = params ? `?${new URLSearchParams(params).toString()}` : ''
  return `#/${name}${query}`
}

const subscribe = (onChange: () => void) => {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}
const currentHash = () => window.location.hash

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, currentHash)
  const route = useMemo(() => parseHash(hash), [hash])
  useEffect(() => {
    // Give the bare URL and every old route its canonical hash, so a refresh
    // or a shared link reopens the same screen. The route is the same either
    // way, so nothing needs to re-render.
    const query = route.params.toString()
    const canonical = `#/${route.name}${query ? `?${query}` : ''}`
    if (hash !== canonical)
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${window.location.search}${canonical}`,
      )
  }, [hash, route])
  return route
}
