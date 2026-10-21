import { describe, expect, test } from 'vitest'
import { EVIDENCE_STATES, type EvidenceState } from './evidence-states'

const STATES = Object.keys(EVIDENCE_STATES) as EvidenceState[]

describe('evidence states', () => {
  test('there are exactly the seven states', () => {
    expect(STATES).toEqual([
      'seed',
      'traversed',
      'candidate',
      'selected',
      'discarded',
      'concept',
      'source_record',
    ])
  })

  test('each evidence state differs from every other in shape or icon, not only colour', () => {
    for (const [i, a] of STATES.entries()) {
      for (const b of STATES.slice(i + 1)) {
        const [x, y] = [EVIDENCE_STATES[a], EVIDENCE_STATES[b]]
        expect(x.shape !== y.shape && x.icon !== y.icon, `${a} vs ${b}`).toBe(
          true,
        )
      }
    }
  })

  test('labels are the plain-language names', () => {
    expect(STATES.map((s) => EVIDENCE_STATES[s].label)).toEqual([
      'Starting point',
      'Followed',
      'Considered',
      'Used as evidence',
      'Set aside',
      'Ontology concept',
      'Source record',
    ])
  })

  test('set aside is grey and dashed, never red, and concept wears the ontology tone', () => {
    expect(EVIDENCE_STATES.discarded.shape).toBe('dashed-circle')
    const [r, g, b] = [1, 3, 5].map((i) =>
      parseInt(EVIDENCE_STATES.discarded.stroke.slice(i, i + 2), 16),
    )
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(40)
    expect(EVIDENCE_STATES.concept.stroke).toBe('#a02574')
  })
})
