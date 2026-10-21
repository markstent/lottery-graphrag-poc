/** The graph views the development pages draw, built from the committed fixture runs. */

import type { components } from '../api/schema'
import { recordedPathsFromResult } from '../graph/from-result'
import { DEFAULT_VISIBLE_NODE_CAP, graphView } from '../graph/model'
import recordedRun from '../run/fixtures/run-abc.json'
import { reduceAll, type RunEvent } from '../run/reduce'
import generated from './fixtures/graph-200.json'

type GraphRunResult = components['schemas']['GraphRunResult']

/**
 * The graph as it stands after `upTo` events of a fixture run (all by
 * default). C is drawn against B, so what the ontology added shows; the
 * generated run holds C only and has no B to compare with.
 */
export function fixtureView({
  source,
  config,
  upTo = Infinity,
  cap = DEFAULT_VISIBLE_NODE_CAP,
  focus = false,
}: {
  source: 'abc' | '200'
  config: 'B' | 'C'
  upTo?: number
  cap?: number
  focus?: boolean
}) {
  const run = source === '200' ? generated : recordedRun
  const events = run.events as unknown as RunEvent[]
  const result = (
    run.results.results as unknown as Record<string, GraphRunResult>
  )[config]
  const overlay =
    config === 'C' && source === 'abc'
      ? reduceAll((recordedRun.events as unknown as RunEvent[]).slice(0, upTo))
          .graph.B
      : undefined
  return graphView(reduceAll(events.slice(0, upTo)).graph[config], {
    cap,
    focus,
    overlay,
    paths: recordedPathsFromResult(result),
  })
}
