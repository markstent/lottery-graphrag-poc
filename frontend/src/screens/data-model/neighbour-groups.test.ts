import { describe, expect, it } from 'vitest'

import type { Schemas } from '../../api/client'
import { GROUP_THRESHOLD, groupNeighbours } from './neighbour-groups'

const neighbour = (
  rel_type: string,
  direction: 'out' | 'in',
  id: string,
  label: string,
): Schemas['NeighbourOut'] => ({
  rel_type,
  direction,
  node: { node_id: id, labels: [label], properties: { id }, provenance: null },
})

const CASES = Array.from({ length: 5 }, (_, i) =>
  neighbour('RELATED_TO', 'in', `SC_${i}`, 'SupportCase'),
)
const GAMES = [
  neighbour('AFFECTS', 'out', 'GAME_1', 'Game'),
  neighbour('AFFECTS', 'out', 'GAME_2', 'Game'),
]
const EDGES: Schemas['EdgeSummary'][] = [
  { type: 'RELATED_TO', direction: 'in', count: 22 },
  { type: 'AFFECTS', direction: 'out', count: 2 },
]

describe('groupNeighbours', () => {
  it('folds a kind of link with more neighbours than the threshold into one group, counted from the edge summary', () => {
    const groups = groupNeighbours([...CASES, ...GAMES], EDGES, 4)
    expect(groups).toEqual([
      {
        id: 'RELATED_TO:in',
        type: 'RELATED_TO',
        direction: 'in',
        label: '22 support cases',
        total: 22,
        kinds: ['SupportCase'],
      },
      {
        id: 'AFFECTS:out:GAME_1',
        type: 'AFFECTS',
        direction: 'out',
        label: 'GAME_1',
        total: 1,
        node: GAMES[0].node,
      },
      {
        id: 'AFFECTS:out:GAME_2',
        type: 'AFFECTS',
        direction: 'out',
        label: 'GAME_2',
        total: 1,
        node: GAMES[1].node,
      },
    ])
  })

  it('names a group by the kinds the schema puts at the other end, so a group none of whose members was read still reads', () => {
    const groups = groupNeighbours(
      [],
      [{ type: 'FROM_MARKET', direction: 'in', count: 2575 }],
      GROUP_THRESHOLD,
      () => ['SupportCase', 'Document'],
    )
    expect(groups.map((g) => g.label)).toEqual([
      '2,575 support cases and documents',
    ])
  })

  it('calls the members records when nothing says what they are', () => {
    const groups = groupNeighbours(
      [],
      [{ type: 'FROM_MARKET', direction: 'in', count: 9 }],
      4,
    )
    expect(groups.map((g) => g.label)).toEqual(['9 records'])
  })

  it('keeps every neighbour single at or below the threshold, counting from the items when there is no summary', () => {
    const groups = groupNeighbours(CASES.slice(0, 4), [], 4)
    expect(groups.map((g) => g.id)).toEqual([
      'RELATED_TO:in:SC_0',
      'RELATED_TO:in:SC_1',
      'RELATED_TO:in:SC_2',
      'RELATED_TO:in:SC_3',
    ])
  })

  it('groups by four', () => {
    expect(GROUP_THRESHOLD).toBe(4)
  })
})
