/**
 * The development pages, behind one entry so the production build leaves them
 * out with a single conditional import (App.tsx): the graph canvas harness at
 * `#/__graph` and the foundation gallery at `#/__gallery`.
 */

import Gallery from './gallery'
import GraphHarness from './graph-harness'

export default function DevPage() {
  return window.location.hash.startsWith('#/__gallery') ? (
    <Gallery />
  ) : (
    <GraphHarness />
  )
}
