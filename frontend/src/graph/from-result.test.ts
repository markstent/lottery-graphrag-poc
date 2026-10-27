import { describe, expect, it } from 'vitest'

import type { components } from '../api/schema'
import fixture from '../run/fixtures/run-abc.json'
import {
  pathsFromResult,
  recordedPathsFromResult,
  sourceRecordsFromResult,
} from './from-result'

type GraphRunResult = components['schemas']['GraphRunResult']
const result = (pipeline: 'B' | 'C') =>
  fixture.results.results[pipeline] as unknown as GraphRunResult

describe('pathsFromResult', () => {
  it('returns the path of each selected node as the backend recorded it', () => {
    for (const id of ['B', 'C'] as const) {
      const selected = result(id).node_evidence.filter((n) => n.selected)
      expect(pathsFromResult(result(id))).toEqual(selected.map((n) => n.path))
      // Every path starts at a seed: the incident asked about, or in C the matched concept.
      for (const path of pathsFromResult(result(id)))
        expect(['INC_021', 'CONCEPT_INCIDENT']).toContain(path[0])
    }
  })

  it('leaves out the paths of nodes that were not selected', () => {
    const all = result('C').node_evidence.length
    expect(all).toBe(53)
    expect(pathsFromResult(result('C'))).toHaveLength(15)
  })
})

describe('recordedPathsFromResult', () => {
  it('carries the relationship that reached each selected node past the seed', () => {
    const selected = result('B').node_evidence.filter((n) => n.selected)
    const recorded = recordedPathsFromResult(result('B'))
    expect(recorded.map((p) => p.ids)).toEqual(selected.map((n) => n.path))
    recorded.forEach((p, i) => {
      if (p.ids.length > 1)
        expect(p.lastRelationship).toBe(selected[i].rel_type)
      else expect(p.lastRelationship).toBeUndefined()
    })
    expect(recorded.some((p) => p.lastRelationship !== undefined)).toBe(true)
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
