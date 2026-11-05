import { describe, expect, it } from 'vitest'

import fixture from '../run/fixtures/run-abc.json'
import {
  RELATIONSHIP_PHRASES,
  RELATIONSHIP_SOURCES,
  linkLines,
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

describe('link lines', () => {
  const kinds: Record<string, string> = {
    'AVAILABLE_IN/out': 'Market',
    'AFFECTS/in': 'Incident',
    'PLAYS/in': 'Player',
    'BELONGS_TO/out': 'GameFamily',
  }
  const lines = (links: Parameters<typeof linkLines>[0]) =>
    linkLines(links, (type, direction) => kinds[`${type}/${direction}`])

  it('puts the count first and the direction in the verb', () => {
    expect(
      lines([
        { type: 'AVAILABLE_IN', direction: 'out', count: 1 },
        { type: 'AFFECTS', direction: 'in', count: 1 },
        { type: 'PLAYS', direction: 'in', count: 2573 },
        { type: 'BELONGS_TO', direction: 'out', count: 3 },
      ]),
    ).toEqual([
      'is available in 1 market',
      '1 incident affects it',
      '2,573 players play it',
      'belongs to 3 game families',
    ])
  })

  it('merges a symmetric kind of link into one line counting both directions', () => {
    expect(
      lines([
        { type: 'SIMILAR_TO', direction: 'in', count: 3 },
        { type: 'SIMILAR_TO', direction: 'out', count: 3 },
        { type: 'RELATED_TO', direction: 'in', count: 24 },
        { type: 'RELATED_TO', direction: 'out', count: 1 },
      ]),
    ).toEqual(['is similar to 6 others', 'is related to 25 others'])
  })

  it('calls an unknown other end a record and an unknown type by its phrase', () => {
    expect(
      lines([
        { type: 'REFERENCES', direction: 'in', count: 1 },
        { type: 'NEW_KIND', direction: 'out', count: 2 },
      ]),
    ).toEqual(['1 record refers to it', 'new kind 2 records'])
  })
})
