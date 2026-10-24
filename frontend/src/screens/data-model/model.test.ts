import { describe, expect, it } from 'vitest'

import { SCHEMA, STATS } from './data-model.fixtures'
import { metaGraphModel } from './model'

const shown = (mode: 'B' | 'C' | 'full') =>
  metaGraphModel(SCHEMA, STATS, mode, 1).edges.filter((edge) => !edge.hidden)

describe('metaGraphModel', () => {
  it('sizes each label by its count and says the count in words', () => {
    const { nodes } = metaGraphModel(SCHEMA, STATS, 'full', 1)
    const width = (id: string) => nodes.find((n) => n.id === id)?.width ?? 0
    expect(width('Game')).toBeGreaterThan(width('Incident'))
    expect(width('Incident')).toBeGreaterThan(width('Market'))
    expect(nodes.find((n) => n.id === 'Game')).toMatchObject({
      title: 'game',
      detail: '120 nodes',
    })
  })

  it('tags each line with the plain phrase only', () => {
    expect(shown('full').map((e) => e.label)).toEqual([
      'affects',
      'is available in',
      'is an instance of concept',
      'is an instance of concept',
    ])
  })

  it('lists each relationship type once with its count, self-links included', () => {
    const { types } = metaGraphModel(SCHEMA, STATS, 'full', 1)
    expect(types.map((t) => t.text)).toEqual([
      'affects: 34',
      'is available in: 310',
      'is an instance of concept: 124',
      'is similar to: 60',
    ])
    expect(types[3].note).toBe('between two game records')
  })

  it('shows only the relationships Graph may follow, and dims what they leave out', () => {
    expect(shown('B').map((e) => e.label)).toEqual([
      'affects',
      'is available in',
    ])
    const { nodes, types } = metaGraphModel(SCHEMA, STATS, 'B', 1)
    expect(types.map((t) => t.text)).toEqual([
      'affects: 34',
      'is available in: 310',
    ])
    expect(nodes.find((n) => n.id === 'BusinessConcept')?.dimmed).toBe(true)
    expect(nodes.find((n) => n.id === 'Game')?.dimmed).toBe(false)
  })

  it('adds the ontology relationships for Graph + Ontology and marks them', () => {
    expect(shown('C').map((e) => e.look)).toEqual(['b', 'b', 'c', 'c'])
    expect(metaGraphModel(SCHEMA, STATS, 'C', 1).types).toHaveLength(4)
  })

  it('draws every relationship in the full schema and marks the ones neither approach follows', () => {
    const none = { ...SCHEMA, allow_list: { B: ['AFFECTS'], C: ['AFFECTS'] } }
    const model = metaGraphModel(none, STATS, 'full', 1)
    expect(model.edges.filter((e) => e.look === 'outside')).toHaveLength(3)
    expect(model.edges.every((e) => !e.hidden)).toBe(true)
    expect(model.hasOutside).toBe(true)
    expect(model.types.find((t) => t.type === 'AVAILABLE_IN')?.note).toBe(
      'followed by neither approach',
    )
    expect(metaGraphModel(SCHEMA, STATS, 'full', 1).hasOutside).toBe(false)
  })

  it('sets apart the kinds that have no relationship at all', () => {
    const schema = { ...SCHEMA, labels: [...SCHEMA.labels, 'Currency'] }
    const stats = {
      ...STATS,
      nodes_by_label: { ...STATS.nodes_by_label, Currency: 3 },
    }
    const { nodes, isolated } = metaGraphModel(schema, stats, 'full', 1)
    expect(isolated.map((n) => [n.id, n.detail])).toEqual([
      ['Currency', '3 nodes'],
    ])
    expect(nodes.map((n) => n.id)).not.toContain('Currency')
  })

  it('scales node widths for presentation mode', () => {
    const normal = metaGraphModel(SCHEMA, STATS, 'full', 1).nodes[0].width
    const large = metaGraphModel(SCHEMA, STATS, 'full', 1.4).nodes[0].width
    expect(large).toBeGreaterThan(normal)
  })
})
