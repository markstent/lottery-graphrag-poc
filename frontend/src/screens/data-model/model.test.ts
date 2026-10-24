import { describe, expect, it } from 'vitest'

import { SCHEMA, STATS } from './data-model.fixtures'
import { metaGraphModel } from './model'

const edgeLabels = (mode: 'B' | 'C' | 'full') =>
  metaGraphModel(SCHEMA, STATS, mode, 1)
    .edges.filter((edge) => !edge.hidden)
    .map((edge) => edge.label)

describe('metaGraphModel', () => {
  it('sizes each label by its count and says the count in words', () => {
    const { nodes } = metaGraphModel(SCHEMA, STATS, 'full', 1)
    const width = (id: string) => nodes.find((n) => n.id === id)?.width ?? 0
    expect(width('Game')).toBeGreaterThan(width('Incident'))
    expect(width('Incident')).toBeGreaterThan(width('Market'))
    const game = nodes.find((n) => n.id === 'Game')
    expect(game).toMatchObject({ title: 'game', detail: '120 nodes' })
  })

  it('labels each relationship in plain words with its count', () => {
    expect(edgeLabels('full')).toContain('affects · 34')
    expect(edgeLabels('full')).toContain('is available in · 310')
  })

  it('says a count covers every link of a type that joins several pairs of labels', () => {
    expect(edgeLabels('full')).toContain(
      'is an instance of concept · 124 in all',
    )
  })

  it('keeps links between two records of one kind apart from the drawn edges', () => {
    const { edges, loops } = metaGraphModel(SCHEMA, STATS, 'full', 1)
    expect(edges.some((edge) => edge.source === edge.target)).toBe(false)
    expect(loops).toEqual(['game is similar to game · 60'])
  })

  it('shows only the relationships Graph may follow, and dims what they leave out', () => {
    expect(edgeLabels('B')).toEqual(['affects · 34', 'is available in · 310'])
    const { nodes } = metaGraphModel(SCHEMA, STATS, 'B', 1)
    expect(nodes.find((n) => n.id === 'BusinessConcept')?.dimmed).toBe(true)
    expect(nodes.find((n) => n.id === 'Game')?.dimmed).toBe(false)
  })

  it('adds the ontology relationships for Graph + Ontology and marks them', () => {
    const { edges } = metaGraphModel(SCHEMA, STATS, 'C', 1)
    const shown = edges.filter((edge) => !edge.hidden)
    expect(shown.map((e) => e.look)).toEqual(['b', 'b', 'c', 'c'])
    expect(metaGraphModel(SCHEMA, STATS, 'C', 1).loops).toEqual([
      'game is similar to game · 60',
    ])
  })

  it('draws every relationship in the full schema and marks the ones neither approach follows', () => {
    const noC = {
      ...SCHEMA,
      allow_list: { B: ['AFFECTS'], C: ['AFFECTS'] },
    }
    const { edges } = metaGraphModel(noC, STATS, 'full', 1)
    expect(edges.filter((e) => e.look === 'outside')).toHaveLength(3)
    expect(edges.every((e) => !e.hidden)).toBe(true)
  })

  it('scales node widths for presentation mode', () => {
    const normal = metaGraphModel(SCHEMA, STATS, 'full', 1).nodes[0].width
    const large = metaGraphModel(SCHEMA, STATS, 'full', 1.4).nodes[0].width
    expect(large).toBeGreaterThan(normal)
  })
})
