/**
 * The neighbours the Graph tab draws around a record (D-115): each kind of
 * link and direction with more than a few neighbours is folded into one box
 * with its true count, so a market with hundreds of support cases reads as
 * one box, not hundreds; the rest stay single records. The counts come from
 * the node's edge summary, which counts every link, while the neighbour items
 * are only the first page the server returned.
 */

import type { Schemas } from '../../api/client'
import { countedLabel } from '../../design/node-labels'
import { count, listed } from './model'

type Node = Schemas['NodeOut']

/** More neighbours than this of one kind of link and direction become one box. */
export const GROUP_THRESHOLD = 4

/** One box around the record: a group of neighbours, or a single one (`node`). */
export interface DiagramGroup {
  /** `<type>:<direction>` for a group, as in the address; `<type>:<direction>:<node id>` for a single. */
  id: string
  type: string
  direction: 'out' | 'in'
  /** The box's title: "22 support cases", or the record's name. */
  label: string
  /** How many neighbours the box stands for. */
  total: number
  /** For a group, the kinds of record in it, as node labels; empty when not known. */
  kinds?: string[]
  /** The neighbour, for a single. */
  node?: Node
}

/** A record's name, a concept's name, its title, or its id, in that order. */
export function titleOf(node: Node): string {
  const { name, canonical_name, title } = node.properties
  for (const value of [name, canonical_name, title])
    if (typeof value === 'string' && value !== '') return value
  return node.node_id
}

/** "support cases" for "SupportCase". */
const pluralKind = (label: string) => countedLabel(2, label).replace(/^2 /, '')

/**
 * The boxes around a record, in the order of its edge summary. `kindsOf`
 * names the kinds of record the schema puts at the other end of a link, so a
 * group is named for all it holds even when only some of it was read; without
 * it the group is named for the members read, or "records".
 */
export function groupNeighbours(
  items: readonly Schemas['NeighbourOut'][],
  edges: readonly Schemas['EdgeSummary'][],
  threshold: number,
  kindsOf: (type: string, direction: 'out' | 'in') => string[] = () => [],
): DiagramGroup[] {
  const read = new Map<string, Schemas['NeighbourOut'][]>()
  for (const item of items) {
    const key = `${item.rel_type}:${item.direction}`
    read.set(key, [...(read.get(key) ?? []), item])
  }
  const totals = new Map<string, number>(
    edges.map((e) => [`${e.type}:${e.direction}`, e.count]),
  )
  for (const [key, members] of read)
    if (!totals.has(key)) totals.set(key, members.length)

  return [...totals].flatMap(([key, total]): DiagramGroup[] => {
    const members = read.get(key) ?? []
    const [type, direction] = key.split(':') as [string, 'out' | 'in']
    if (total <= threshold)
      return members.map(({ node }) => ({
        id: `${key}:${node.node_id}`,
        type,
        direction,
        label: titleOf(node),
        total: 1,
        node,
      }))
    const named = kindsOf(type, direction)
    const kinds =
      named.length > 0
        ? named
        : [...new Set(members.flatMap(({ node }) => node.labels.slice(0, 1)))]
    const words = kinds.length > 0 ? listed(kinds.map(pluralKind)) : 'records'
    return [
      {
        id: key,
        type,
        direction,
        label: `${count(total)} ${words}`,
        total,
        kinds,
      },
    ]
  })
}
