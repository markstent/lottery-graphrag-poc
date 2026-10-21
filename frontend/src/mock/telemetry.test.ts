import { describe, expect, it } from 'vitest'

import { MOCK_RUN, mergeTimeline, projectGraph, projectRag } from './telemetry'

describe('projectRag', () => {
  it('starts idle and empty', () => {
    const state = projectRag([])
    expect(state.stage).toBe('idle')
    expect(state.chunks).toEqual([])
    expect(state.answer).toBeNull()
  })

  it('retrieves chunks before selecting context', () => {
    const atCandidates = projectRag(MOCK_RUN.rag.slice(0, 4))
    expect(atCandidates.stage).toBe('retrieving')
    expect(atCandidates.chunks).toHaveLength(4)
    expect(atCandidates.selectedIds).toEqual([])

    const atSelected = projectRag(MOCK_RUN.rag.slice(0, 7))
    expect(atSelected.selectedIds).toEqual(['CHNK_S007_GR_00', 'CHNK_0112_00'])
  })

  it('completes with an answer carrying citations', () => {
    const state = projectRag(MOCK_RUN.rag)
    expect(state.stage).toBe('done')
    expect(state.answer?.citations.length).toBeGreaterThan(0)
    expect(state.answer?.contextTokens).toBe(1840)
  })
})

describe('projectGraph', () => {
  it('renders nothing before seed resolution', () => {
    const state = projectGraph([])
    expect(state.nodes.size).toBe(0)
  })

  it('keeps seed state when a traversal returns to a seed', () => {
    const state = projectGraph(MOCK_RUN.graph)
    expect(state.nodes.get('MKT_GR')?.state).toBe('seed')
    expect(state.nodes.get('GAME_GR_01')?.state).toBe('seed')
  })

  it('progresses to evidence path selection and completion', () => {
    const atTraversal = projectGraph(MOCK_RUN.graph.slice(0, 5))
    expect(atTraversal.stage).toBe('traversing')
    expect(atTraversal.nodes.get('PLT_PAYMENTS')?.state).toBe('traversed')

    const done = projectGraph(MOCK_RUN.graph)
    expect(done.stage).toBe('done')
    expect(done.evidencePath).toEqual([
      'INC_S007_GR',
      'PLV_PAYMENTS_3',
      'INC_S007_AT',
    ])
    expect(done.nodes.get('INC_S007_GR')?.state).toBe('selected')
    expect(done.nodes.get('INC_S007_CZ')?.state).toBe('discarded')
    expect(done.nodes.get('CONCEPT_PLATFORM_INCIDENT')?.state).toBe('ontology')
    expect(done.answer?.text).toContain('Austria')
  })

  it('is deterministic under prefixes (rewind equals replay)', () => {
    const full = projectGraph(MOCK_RUN.graph)
    const half = projectGraph(MOCK_RUN.graph.slice(0, 8))
    expect(half.nodes.size).toBeLessThanOrEqual(full.nodes.size)
    // Re-projecting the same prefix yields identical output.
    expect(projectGraph(MOCK_RUN.graph.slice(0, 8)).nodes.size).toBe(
      half.nodes.size,
    )
  })
})

describe('mergeTimeline', () => {
  it('merges streams ordered by event time', () => {
    const timeline = mergeTimeline(MOCK_RUN)
    expect(timeline.length).toBe(
      MOCK_RUN.rag.length + MOCK_RUN.graph.length + MOCK_RUN.evaluation.length,
    )
    for (let i = 1; i < timeline.length; i += 1) {
      expect(timeline[i].t).toBeGreaterThanOrEqual(timeline[i - 1].t)
    }
  })
})
