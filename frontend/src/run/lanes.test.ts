import { describe, expect, it } from 'vitest'

import runAbc from './fixtures/run-abc.json'
import { RECORDINGS } from '../test/recordings'
import { LANES, STAGE_LABELS, STEPS } from './lanes'
import { initialRunState, reduce, type RunEvent, type Stage } from './reduce'
import type { PipelineId } from '../design/pipelines'

const RUNS: { name: string; events: RunEvent[] }[] = [
  ...RECORDINGS.map((run) => ({ name: run.instance_id, events: run.events })),
  { name: 'run-abc', events: runAbc.events as unknown as RunEvent[] },
]

/** The stages of a pipeline in the order the first event of each one arrives. */
function stagesInOrder(events: RunEvent[], id: PipelineId): Stage[] {
  const seen: Stage[] = []
  let state = initialRunState()
  for (const event of events) {
    state = reduce(state, event)
    for (const stage of Object.keys(state.pipelines[id].stages) as Stage[])
      if (!seen.includes(stage)) seen.push(stage)
  }
  return seen
}

describe('the order of the steps against the recorded events', () => {
  const ids: PipelineId[] = ['A', 'B', 'C']

  it.each(RUNS.flatMap((run) => ids.map((id) => [run.name, id] as const)))(
    '%s, pipeline %s: stages begin in the order STEPS lists',
    (name, id) => {
      const { events } = RUNS.find((run) => run.name === name)!
      const seen = stagesInOrder(events, id)
      expect(seen.length).toBeGreaterThan(0)
      expect(seen).toEqual(STEPS[id].filter((stage) => seen.includes(stage)))
    },
  )

  it.each(ids)('pipeline %s: the runs between them show every stage', (id) => {
    const shown = new Set(RUNS.flatMap((run) => stagesInOrder(run.events, id)))
    expect([...shown].sort()).toEqual([...STEPS[id]].sort())
  })

  it('the Overview lanes name the same steps, in the same order, as STEPS', () => {
    const labels = (id: PipelineId) =>
      STEPS[id]
        .slice(0, STEPS[id].indexOf('rerank'))
        .map((stage) => STAGE_LABELS[stage])
    const lane = (id: PipelineId) => LANES.find((l) => l.pipeline === id)!.steps
    expect(lane('B')).toEqual(labels('B'))
    expect(lane('C')).toEqual(labels('C'))
    expect(labels('A')).toEqual(
      expect.arrayContaining(
        LANES.find((l) => l.pipeline === undefined)!.steps,
      ),
    )
  })
})
