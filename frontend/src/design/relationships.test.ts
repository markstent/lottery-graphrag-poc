import { describe, expect, it } from 'vitest'

import fixture from '../run/fixtures/run-abc.json'
import {
  RELATIONSHIP_PHRASES,
  RELATIONSHIP_SOURCES,
  relationshipPhrase,
} from './relationships'

const BANNED =
  /honest|never|real|fake|prototype|telemetry|seed|chunk|rerank|maps_to/i

describe('relationship phrases', () => {
  it('cover every relationship type the fixture recorded', () => {
    const types = new Set(
      fixture.events
        .filter((e) => e.event_type === 'graph.relationship.traversed')
        .map(
          (e) => (e.payload as { relationship_type: string }).relationship_type,
        ),
    )
    expect(types.size).toBeGreaterThan(10)
    for (const type of types) expect(RELATIONSHIP_PHRASES[type]).toBeDefined()
  })

  it('are lower-case plain phrases with none of the banned words', () => {
    for (const phrase of Object.values(RELATIONSHIP_PHRASES)) {
      expect(phrase).toBe(phrase.toLowerCase())
      expect(phrase).not.toMatch(BANNED)
      expect(phrase).not.toMatch(/[A-Z_]/)
    }
  })

  it('read an unmapped type as its lower-cased name', () => {
    expect(relationshipPhrase('AFFECTS_GAME')).toBe('affects game')
    expect(relationshipPhrase('MAPS_TO')).toBe('is an instance of concept')
  })
})

describe('relationship sources', () => {
  it('say where every kind of link with a phrase is made from', () => {
    expect(Object.keys(RELATIONSHIP_SOURCES).sort()).toEqual(
      Object.keys(RELATIONSHIP_PHRASES).sort(),
    )
  })

  it('are plain sentences with none of the banned words', () => {
    for (const source of Object.values(RELATIONSHIP_SOURCES)) {
      expect(source).toMatch(/^[A-Z].*\.$/)
      expect(source).not.toMatch(BANNED)
      expect(source).not.toMatch(/[A-Z]{2,}|_/)
    }
  })
})
