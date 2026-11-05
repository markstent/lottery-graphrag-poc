import { describe, expect, it } from 'vitest'

import { SCHEMA, STATS } from './data-model.fixtures'
import { linkSentence, relationshipRows } from './model'

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
