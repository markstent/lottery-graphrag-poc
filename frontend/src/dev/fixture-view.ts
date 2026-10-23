/** The graph views the development pages draw, built from the committed fixture runs. */

import type { components } from '../api/schema'
import { recordedPathsFromResult } from '../graph/from-result'
import { DEFAULT_VISIBLE_NODE_CAP, graphView } from '../graph/model'
import recordedRun from '../run/fixtures/run-abc.json'
import { reduceAll, type RunEvent } from '../run/reduce'

type GraphRunResult = components['schemas']['GraphRunResult']

/** A recorded run: its events and the results the backend returned. */
export type FixtureRun = typeof recordedRun

/** The recorded A, B, C run, which is in the bundle already. */
export const RECORDED_RUN: FixtureRun = recordedRun

/**
 * The generated 200-node run. It is large, so it is fetched only by the page
 * that asks for it (`source=200`), not bundled with every development page.
 */
export async function loadGeneratedRun(): Promise<FixtureRun> {
  return (await import('./fixtures/graph-200.json'))
    .default as unknown as FixtureRun
}

/**
 * The graph as it stands after `upTo` events of a fixture run (all by
 * default). C is drawn against B, so what the ontology added shows; the
 * generated run holds C only and has no B to compare with.
 */
export function fixtureView({
  run = RECORDED_RUN,
  config,
  upTo = Infinity,
  cap = DEFAULT_VISIBLE_NODE_CAP,
  focus = false,
}: {
  run?: FixtureRun
  config: 'B' | 'C'
  upTo?: number
  cap?: number
  focus?: boolean
}) {
  const events = run.events as unknown as RunEvent[]
  const result = (
    run.results.results as unknown as Record<string, GraphRunResult>
  )[config]
  const overlay =
    config === 'C' && run === RECORDED_RUN
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
