/**
 * Where a Live Lab run comes from, and why Live may be unavailable.
 */

import type { ModelStatus, Readiness } from '../../app/use-readiness'

export type Source = 'recorded' | 'live'

const CHECK_NAMES: Record<string, string> = {
  lab: 'The lab',
  index: 'The search index',
  graph: 'The graph database',
  model: 'The answer model',
  embedding: 'The embedding model',
}

/** Why Live cannot run now, in plain words, or null when it can. */
export function liveUnavailableReason(
  status: ModelStatus,
  checks: Readiness['checks'] | null,
): string | null {
  switch (status) {
    case 'ready':
      return null
    case 'checking':
      return 'Checking whether the backend is ready.'
    case 'starting':
      return 'The backend is still starting.'
    case 'not-ready': {
      const failed = Object.entries(checks ?? {}).find(([, check]) => !check.ok)
      return failed
        ? `${CHECK_NAMES[failed[0]] ?? failed[0]} is not ready: ${failed[1].detail}.`
        : 'The backend did not answer.'
    }
  }
}
