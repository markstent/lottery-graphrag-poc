/**
 * The first graph layout of a test file loads elk (a large module, imported
 * when the first layout needs it) and runs its code cold. A test that waits
 * for a canvas would pay that once-only cost inside its own wait, and on a
 * busy machine that cost alone can outlast the wait. Files that draw the
 * graph canvas run one small layout before their tests instead, so each test
 * waits only for its own work.
 */

import { layoutGraph } from '../graph/layout'

export async function warmLayout(): Promise<void> {
  await layoutGraph(
    [
      { id: 'from', width: 120 },
      { id: 'to', width: 120 },
    ],
    [
      {
        id: 'from>to',
        source: 'from',
        target: 'to',
        tag: { width: 60, height: 16 },
      },
    ],
    40,
    new Map(),
  )
}
