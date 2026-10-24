import { describe, expect, it } from 'vitest'

import type { Schemas } from '../api/client'
import { hrefFor } from '../app/router'
import { PILOT_INSTANCES } from './results.fixtures'
import { filterInstances, liveLabLink, type QuestionFilter } from './questions'

type Row = Schemas['InstanceResultOut']

const NONE: QuestionFilter = { stratum: null, failure: null, world: null }

const row = (over: Partial<Row>): Row => ({
  instance_id: 'L01-2026-X',
  question_id: 'L01',
  world_seed: 2026,
  stratum: 'H3',
  sub_stratum: null,
  ontology_dependent: false,
  text: 'q',
  pipelines: {},
  ...over,
})

describe('filterInstances', () => {
  it('orders by stratum, then question, then world', () => {
    const rows = [
      row({ instance_id: 'e', stratum: 'H5', question_id: 'L50' }),
      row({
        instance_id: 'd',
        stratum: 'H3',
        question_id: 'L02',
        world_seed: 2027,
      }),
      row({
        instance_id: 'c',
        stratum: 'H3',
        question_id: 'L02',
        world_seed: 2026,
      }),
      row({ instance_id: 'b', stratum: 'H3', question_id: 'L01' }),
      row({
        instance_id: 'a',
        stratum: 'H2',
        sub_stratum: 'name_anchored',
        question_id: 'L10',
      }),
      row({ instance_id: 'z', stratum: 'H1', question_id: 'L30' }),
    ]
    expect(filterInstances(rows, NONE).map((r) => r.instance_id)).toEqual([
      'z',
      'a',
      'b',
      'c',
      'd',
      'e',
    ])
  })
  it('does not change the rows it is given', () => {
    const rows = [row({ stratum: 'H5' }), row({ stratum: 'H1' })]
    filterInstances(rows, NONE)
    expect(rows.map((r) => r.stratum)).toEqual(['H5', 'H1'])
  })
  it('filters by stratum, telling H2 from H2_name', () => {
    const ids = row({
      instance_id: 'i',
      stratum: 'H2',
      sub_stratum: 'id_anchored',
    })
    const names = row({
      instance_id: 'n',
      stratum: 'H2',
      sub_stratum: 'name_anchored',
    })
    const pick = (stratum: string) =>
      filterInstances([ids, names], { ...NONE, stratum }).map(
        (r) => r.instance_id,
      )
    expect(pick('H2')).toEqual(['i'])
    expect(pick('H2_name')).toEqual(['n'])
  })
  it('filters by world', () => {
    const rows = [row({ world_seed: 2026 }), row({ world_seed: 2027 })]
    expect(filterInstances(rows, { ...NONE, world: 2027 })).toHaveLength(1)
  })
  it('filters by a failure class of a pipeline', () => {
    const pipe = (failure_classes: Record<string, number>) =>
      ({
        repeats: 3,
        unscored_repeats: 0,
        failure_classes,
      }) as Row['pipelines'][string]
    const rows = [
      row({
        instance_id: 'hit',
        pipelines: { B: pipe({ retrieval_failure: 2 }) },
      }),
      row({
        instance_id: 'other-pipeline',
        pipelines: { A: pipe({ retrieval_failure: 1 }) },
      }),
      row({
        instance_id: 'other-class',
        pipelines: { B: pipe({ generation_failure: 1 }) },
      }),
      row({ instance_id: 'none', pipelines: { B: pipe({}) } }),
    ]
    const failure = { pipeline: 'B', cls: 'retrieval_failure' }
    expect(
      filterInstances(rows, { ...NONE, failure }).map((r) => r.instance_id),
    ).toEqual(['hit'])
  })
  it('the captured pilot orders by stratum and holds every instance with no filter', () => {
    const rows = filterInstances(PILOT_INSTANCES, NONE)
    expect(rows).toHaveLength(PILOT_INSTANCES.length)
    expect(rows[0].stratum).toBe('H1')
  })
})

describe('liveLabLink', () => {
  const row2026 = row({ instance_id: 'L01-2026-A', world_seed: 2026 })
  const row2027 = row({ instance_id: 'L01-2027-A', world_seed: 2027 })
  it('live lab link only for the loaded world', () => {
    expect(liveLabLink(row2027, 2026)).toEqual({
      reason: 'Loaded world is 2026',
    })
    expect(liveLabLink(row2026, 2026)).toEqual({
      href: hrefFor('live-lab', { question: row2026.instance_id }),
    })
  })
  it('says no world is loaded when none is', () =>
    expect(liveLabLink(row2026, null)).toEqual({
      reason: 'No world is loaded',
    }))
})
