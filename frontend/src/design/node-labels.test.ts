import { describe, expect, it } from 'vitest'

import fixture from '../run/fixtures/run-abc.json'
import { countedLabel, NODE_LABELS, nodeLabel } from './node-labels'

const BANNED =
  /honest|never|real|fake|prototype|telemetry|seed|chunk|rerank|maps_to/i

describe('node labels', () => {
  it('cover every label the fixture recorded', () => {
    const labels = new Set(
      fixture.events
        .filter((e) => e.event_type === 'graph.node.discovered')
        .map((e) => (e.payload as { node_label: string }).node_label),
    )
    expect(labels.size).toBeGreaterThan(8)
    for (const label of labels) expect(NODE_LABELS[label]).toBeDefined()
  })

  it('are lower-case plain words with none of the banned words', () => {
    for (const words of Object.values(NODE_LABELS)) {
      expect(words).toBe(words.toLowerCase())
      expect(words).not.toMatch(BANNED)
      expect(words).not.toMatch(/[A-Z_]/)
    }
  })

  it('turns a type name into words', () => {
    expect(nodeLabel('IncidentType')).toBe('incident type')
    expect(nodeLabel('DocumentChunk')).toBe('passage')
  })

  it('splits an unmapped type name at its capitals', () => {
    expect(nodeLabel('LoyaltyTier')).toBe('loyalty tier')
  })

  it('leaves text written for people as it is', () => {
    expect(nodeLabel('Euromillions UK')).toBe('Euromillions UK')
    expect(nodeLabel('INC_037')).toBe('INC_037')
  })

  it('counts with the right plural', () => {
    expect(countedLabel(1, 'Game')).toBe('1 game')
    expect(countedLabel(12, 'IncidentType')).toBe('12 incident types')
    expect(countedLabel(3, 'GameCategory')).toBe('3 game categories')
    expect(countedLabel(2, 'Campaign')).toBe('2 campaigns')
    expect(countedLabel(5, 'Index')).toBe('5 indexes')
  })
})
