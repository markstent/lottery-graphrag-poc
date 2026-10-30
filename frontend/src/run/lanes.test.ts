import { describe, expect, it } from 'vitest'

import runAbc from './fixtures/run-abc.json'
import { RECORDINGS } from '../test/recordings'
import { LANES, STAGE_LABELS, stageLabel, STEP, STEPS } from './lanes'
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

  it('the Overview lanes name the same steps, in the same order, as STEPS, then the graph ranking', () => {
    const labels = (id: PipelineId) =>
      STEPS[id]
        .slice(0, STEPS[id].indexOf('rerank'))
        .map((stage) => stageLabel(id, stage))
    const lane = (id: PipelineId) => LANES.find((l) => l.pipeline === id)!.steps
    expect(lane('B')).toEqual([...labels('B'), STEP.rankByGraph])
    expect(lane('C')).toEqual([...labels('C'), STEP.rankByGraph])
    expect(LANES.find((l) => l.pipeline === undefined)!.steps).toEqual([
      STAGE_LABELS.search,
      STEP.reorderPassages,
    ])
  })
  it('names the re-rank stage by what the run does in it under method v0.3', () => {
    // In B and C the stage re-ranks passages only, then graph records and
    // passages take turns; in A it re-ranks and picks passages.
    const events = runAbc.events as unknown as RunEvent[]
    const inRerank = (id: PipelineId) => {
      const start = events.findIndex(
        (e) => e.pipeline === id && e.event_type.endsWith('rerank.started'),
      )
      const end = events.findIndex(
        (e) => e.pipeline === id && e.event_type.endsWith('context.assembled'),
      )
      return events.slice(start + 1, end)
    }
    for (const id of ['B', 'C'] as const) {
      const reranked = inRerank(id).filter(
        (e) => e.event_type === 'graph.candidate.reranked',
      )
      expect(reranked.length).toBeGreaterThan(0)
      expect(
        reranked.every((e) => (e.payload as { kind: string }).kind !== 'node'),
      ).toBe(true)
      expect(
        inRerank(id).some(
          (e) =>
            e.event_type === 'graph.candidate.selected' &&
            'node_id' in (e.payload as object),
        ),
      ).toBe(true)
      expect(stageLabel(id, 'rerank')).toBe('Re-order passages, take turns')
    }
    expect(
      inRerank('A').some((e) => e.event_type === 'rag.evidence.selected'),
    ).toBe(true)
    expect(stageLabel('A', 'rerank')).toBe('Re-order and pick passages')
  })
})
