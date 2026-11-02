import { describe, expect, it } from 'vitest'

import { SCHEMA, STATS } from './data-model.fixtures'
import { linkSentence, metaGraphModel, relationshipRows } from './model'

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
      detail: '120 records',
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

  it('shows only the relationships Graph may follow, and dims what they leave out', () => {
    expect(shown('B').map((e) => e.label)).toEqual([
      'affects',
      'is available in',
    ])
    const { nodes } = metaGraphModel(SCHEMA, STATS, 'B', 1)
    expect(nodes.find((n) => n.id === 'BusinessConcept')?.dimmed).toBe(true)
    expect(nodes.find((n) => n.id === 'Game')?.dimmed).toBe(false)
  })

  it('adds the ontology relationships for Graph + Ontology and marks them', () => {
    expect(shown('C').map((e) => e.look)).toEqual(['b', 'b', 'c', 'c'])
  })

  it('draws every relationship in the full schema and marks the ones neither approach follows', () => {
    const none = { ...SCHEMA, allow_list: { B: ['AFFECTS'], C: ['AFFECTS'] } }
    const model = metaGraphModel(none, STATS, 'full', 1)
    expect(model.edges.filter((e) => e.look === 'outside')).toHaveLength(3)
    expect(model.edges.every((e) => !e.hidden)).toBe(true)
    expect(model.hasOutside).toBe(true)
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
      ['Currency', '3 records'],
    ])
    expect(nodes.map((n) => n.id)).not.toContain('Currency')
  })

  it('scales node widths for presentation mode', () => {
    const normal = metaGraphModel(SCHEMA, STATS, 'full', 1).nodes[0].width
    const large = metaGraphModel(SCHEMA, STATS, 'full', 1.4).nodes[0].width
    expect(large).toBeGreaterThan(normal)
  })
})

describe('relationshipRows', () => {
  it('gives each kind of link once, with what it joins, its count and who follows it', () => {
    expect(relationshipRows(SCHEMA, STATS)).toEqual([
      {
        type: 'AFFECTS',
        sentences: ['incident affects game'],
        total: 34,
        follower: 'both',
      },
      {
        type: 'AVAILABLE_IN',
        sentences: ['game is available in market'],
        total: 310,
        follower: 'both',
      },
      {
        type: 'MAPS_TO',
        sentences: ['game and market: each is an instance of business concept'],
        total: 124,
        follower: 'C',
      },
      {
        type: 'SIMILAR_TO',
        sentences: ['game is similar to game'],
        total: 60,
        follower: 'C',
      },
    ])
  })

  it('puts the links neither approach follows last', () => {
    const none = { ...SCHEMA, allow_list: { B: ['AFFECTS'], C: ['AFFECTS'] } }
    expect(
      relationshipRows(none, STATS).map((r) => [r.type, r.follower]),
    ).toEqual([
      ['AFFECTS', 'both'],
      ['AVAILABLE_IN', 'neither'],
      ['MAPS_TO', 'neither'],
      ['SIMILAR_TO', 'neither'],
    ])
  })
})

describe('linkSentence', () => {
  it('reads from one kind to the other, without naming the target twice', () => {
    expect(linkSentence('AFFECTS', 'Incident', 'Game')).toBe(
      'incident affects game',
    )
    expect(linkSentence('AFFECTS_MARKET', 'Incident', 'Market')).toBe(
      'incident affects market',
    )
    expect(linkSentence('HAS_MECHANIC', 'Game', 'GameMechanic')).toBe(
      'game has game mechanic',
    )
    expect(linkSentence('MAPS_TO', 'Game', 'BusinessConcept')).toBe(
      'game is an instance of business concept',
    )
  })
})
