import { describe, expect, it } from 'vitest'

import type { components } from '../api/schema'
import fixture from '../run/fixtures/run-abc.json'
import { pathsFromResult, sourceRecordsFromResult } from './from-result'

type GraphRunResult = components['schemas']['GraphRunResult']
const result = (pipeline: 'B' | 'C') =>
  fixture.results.results[pipeline] as unknown as GraphRunResult

describe('pathsFromResult', () => {
  it('returns the path of each selected node as the backend recorded it', () => {
    for (const id of ['B', 'C'] as const) {
      const selected = result(id).node_evidence.filter((n) => n.selected)
      expect(pathsFromResult(result(id))).toEqual(selected.map((n) => n.path))
      for (const path of pathsFromResult(result(id)))
        expect(path[0]).toBe('INC_037')
    }
  })

  it('leaves out the paths of nodes that were not selected', () => {
    const all = result('C').node_evidence.length
    expect(all).toBe(61)
    expect(pathsFromResult(result('C'))).toHaveLength(4)
  })
})

describe('sourceRecordsFromResult', () => {
  it('names the nodes that carry facts from a structured source record', () => {
    const withFacts = result('B')
      .node_evidence.filter((n) => n.authoritative?.source_record_id)
      .map((n) => n.node_id)
    expect([...sourceRecordsFromResult(result('B'))]).toEqual(withFacts)
    expect(withFacts.length).toBeGreaterThan(0)
  })
})
