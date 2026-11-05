/**
 * What Data Model draws, worked out from the API's answers: the warehouse
 * tables grouped by source system, and the map of the graph's kinds of record
 * with the relationships each approach may follow. Pure functions, apart from
 * the drawing in meta-graph.tsx and the tabs.
 */

import type { Schemas } from '../../api/client'
import { plainName } from '../../app/plain-words'
import { plural } from '../../charts/scale'
import { nodeLabel } from '../../design/node-labels'
import { relationshipPhrase } from '../../design/relationships'

type Table = Schemas['TableSchemaOut']

export type EdgeLook = 'plain' | 'b' | 'c' | 'outside'

export interface DiagramNode {
  id: string
  title: string
  detail?: string
  width: number
  /** Drawn faint with a dashed outline: present, but not on any shown link. */
  dimmed?: boolean
}

export interface DiagramEdge {
  id: string
  source: string
  target: string
  /** Drawn on the edge. */
  label?: string
  /** False draws the line without its tag (default: tagged). */
  tagged?: boolean
  /** Drawn pale, to stand back from the lines that matter. */
  faint?: boolean
  /** Not drawn and not listed, but kept so the layout does not move. */
  hidden?: boolean
  look?: EdgeLook
  /**
   * The link runs from target to source: laid out from source to target, so
   * the source sits on the left, but its arrow points back at the source and
   * it reads from the target.
   */
  reversed?: boolean
}

/** The source systems as the warehouse names them, in words a reader knows. */
const SYSTEM_WORDS: Record<string, string> = {
  warehouse: 'Warehouse',
  telemetry_platform: 'Usage logs',
  release_management: 'Release management',
  incident_management: 'Incident management',
  support_platform: 'Support platform',
  campaign_platform: 'Campaign platform',
  document_store: 'Document store',
}
export const systemName = (system: string) =>
  SYSTEM_WORDS[system] ?? plainName(system)

/** Tables grouped by source system, in the order the dictionary first names each system. */
export function groupBySystem(
  dictionary: Table[],
): { system: string; tables: Table[] }[] {
  const groups = new Map<string, Table[]>()
  for (const table of dictionary)
    groups.set(table.source_system, [
      ...(groups.get(table.source_system) ?? []),
      table,
    ])
  return [...groups].map(([system, tables]) => ({ system, tables }))
}

export type AllowList = 'B' | 'C' | 'full'

export const count = (n: number) => n.toLocaleString('en-GB')

// Node widths run from MIN to MAX on a log scale of the count, so the
// largest label is not many times wider than the smallest.
const MIN_WIDTH = 150
const MAX_WIDTH = 210

/** Which approaches' search may walk a kind of link. */
export type Follower = 'both' | 'B' | 'C' | 'neither'

/** One kind of link, once, for the table under the map. */
export interface RelationshipRow {
  type: string
  /** Each pair of kinds it joins, as a sentence: "incident affects game". */
  sentences: string[]
  /** How many links of this kind the graph holds; null when not counted. */
  total: number | null
  follower: Follower
}

export interface MetaGraphModel {
  /** The kinds that have a relationship in the schema, for the drawing. */
  nodes: DiagramNode[]
  /** The kinds with no relationship at all, which the drawing would only clutter. */
  isolated: DiagramNode[]
  edges: DiagramEdge[]
  /** True when the map draws a line neither approach follows (dashed grey). */
  hasOutside: boolean
}

/**
 * The map of kinds of record: each sized by its count, each relationship drawn
 * as a line tagged with its phrase. The statistics count a type once across
 * every pair of kinds it joins, so the counts are in a list that gives each
 * type once (self-links, which the map cannot draw, are in it too). `mode`
 * picks which relationships are shown: those B may follow, those C may follow
 * (the ontology's marked apart), or the whole schema (those neither follows
 * marked apart).
 */
export function metaGraphModel(
  schema: Schemas['GraphSchema'],
  stats: Schemas['GraphStats'],
  mode: AllowList,
  scale: number,
): MetaGraphModel {
  const allowed = {
    B: new Set(schema.allow_list.B ?? []),
    C: new Set(schema.allow_list.C ?? []),
  }
  const looks = (type: string): { hidden: boolean; look: EdgeLook } => {
    if (mode === 'B') return { hidden: !allowed.B.has(type), look: 'b' }
    if (mode === 'C')
      return {
        hidden: !allowed.C.has(type),
        look: allowed.B.has(type) ? 'b' : 'c',
      }
    return {
      hidden: false,
      look: allowed.C.has(type) || allowed.B.has(type) ? 'plain' : 'outside',
    }
  }

  const edges: DiagramEdge[] = []
  const connected = new Set<string>()
  for (const rel of schema.relationship_types) {
    const { hidden, look } = looks(rel.type)
    if (hidden) {
      if (rel.from_label !== rel.to_label)
        edges.push({
          id: `${rel.type}:${rel.from_label}>${rel.to_label}`,
          source: rel.from_label,
          target: rel.to_label,
          label: relationshipPhrase(rel.type),
          hidden,
          look,
        })
      continue
    }
    connected.add(rel.from_label)
    connected.add(rel.to_label)
    if (rel.from_label !== rel.to_label)
      edges.push({
        id: `${rel.type}:${rel.from_label}>${rel.to_label}`,
        source: rel.from_label,
        target: rel.to_label,
        label: relationshipPhrase(rel.type),
        hidden,
        look,
      })
  }

  const largest = Math.max(1, ...Object.values(stats.nodes_by_label))
  const joined = new Set(
    schema.relationship_types.flatMap((r) => [r.from_label, r.to_label]),
  )
  const sized = schema.labels.map((label) => {
    const n = stats.nodes_by_label[label] ?? 0
    const share = Math.log1p(n) / Math.log1p(largest)
    return {
      id: label,
      title: nodeLabel(label),
      detail: plural(n, 'record'),
      width: Math.round((MIN_WIDTH + (MAX_WIDTH - MIN_WIDTH) * share) * scale),
      dimmed: !connected.has(label),
    }
  })
  return {
    nodes: sized.filter((n) => joined.has(n.id)),
    isolated: sized.filter((n) => !joined.has(n.id)),
    edges,
    hasOutside: edges.some((e) => !e.hidden && e.look === 'outside'),
  }
}

/** The ontology's four languages, in the markets' order. */
export const LANGUAGES = [
  { id: 'en', name: 'English' },
  { id: 'el', name: 'Greek' },
  { id: 'de', name: 'German' },
  { id: 'cs', name: 'Czech' },
] as const

/** The concept's name in `language`, or its English name when it has none there. */
export const labelOf = (
  concept: Schemas['ConceptOut'],
  language = 'en',
): string => concept.labels[language] ?? concept.labels.en ?? concept.concept_id

/**
 * "incident affects game". A phrase that already names the target is not
 * followed by it again: "affects market" stays, and "has mechanic" before
 * "game mechanic" reads "has game mechanic".
 */
export function linkSentence(type: string, from: string, to: string): string {
  return `${nodeLabel(from)} ${linkTail(type, to)}`
}

/** What a link says of its source: "affects game", "has game mechanic". */
function linkTail(type: string, to: string): string {
  const phrase = relationshipPhrase(type)
  const target = nodeLabel(to)
  if (phrase.endsWith(` ${target}`)) return phrase
  const words = phrase.split(' ')
  const last = target.split(' ').at(-1)
  const verb =
    words.length > 1 && words.at(-1) === last
      ? words.slice(0, -1).join(' ')
      : phrase
  return `${verb} ${target}`
}

/** "a, b and c". */
export const listed = (items: readonly string[]): string =>
  items.length < 2
    ? items.join('')
    : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`

export const FOLLOWER_ORDER: readonly Follower[] = ['both', 'B', 'C', 'neither']

/** Who may walk each kind of link, in words. */
export const FOLLOWED_BY: Readonly<Record<Follower, string>> = {
  both: 'Followed by Graph and Graph + Ontology',
  B: 'Followed by Graph only',
  C: 'Followed by Graph + Ontology only',
  neither: 'Followed by neither',
}

/** Which approaches' search may walk links of `type`, from the schema's allow lists. */
export function followerOf(
  schema: Schemas['GraphSchema'],
  type: string,
): Follower {
  const b = schema.allow_list.B?.includes(type) ?? false
  const c = schema.allow_list.C?.includes(type) ?? false
  return b ? (c ? 'both' : 'B') : c ? 'C' : 'neither'
}

/**
 * The kinds of record the schema puts at the other end of a link of `type`
 * from a record of kind `label`: its targets when the link goes out, its
 * sources when it comes in. Each kind once, in schema order.
 */
export function otherKinds(
  schema: Schemas['GraphSchema'],
  label: string,
  type: string,
  direction: 'out' | 'in',
): string[] {
  const kinds = schema.relationship_types
    .filter((r) => r.type === type)
    .flatMap((r) =>
      direction === 'out' && r.from_label === label
        ? [r.to_label]
        : direction === 'in' && r.to_label === label
          ? [r.from_label]
          : [],
    )
  return [...new Set(kinds)]
}

/**
 * Every kind of link in the schema, once, with the pairs it joins, its count
 * and which approaches follow it: those both follow first, then the
 * ontology's, then those neither follows, each in schema order.
 */
export function relationshipRows(
  schema: Schemas['GraphSchema'],
  stats: Schemas['GraphStats'],
): RelationshipRow[] {
  const rows = new Map<string, RelationshipRow>()
  // The kinds a link starts from, by link type and the kind it ends at.
  const sources = new Map<string, Map<string, string[]>>()
  for (const rel of schema.relationship_types) {
    const byTarget = sources.get(rel.type) ?? new Map<string, string[]>()
    const from = byTarget.get(rel.to_label) ?? []
    if (!from.includes(rel.from_label)) from.push(rel.from_label)
    byTarget.set(rel.to_label, from)
    sources.set(rel.type, byTarget)
    if (rows.has(rel.type)) continue
    rows.set(rel.type, {
      type: rel.type,
      sentences: [],
      total: stats.relationships_by_type[rel.type] ?? null,
      follower: followerOf(schema, rel.type),
    })
  }
  for (const [type, byTarget] of sources) {
    const row = rows.get(type)!
    for (const [to, from] of byTarget)
      row.sentences.push(
        from.length === 1
          ? linkSentence(type, from[0], to)
          : `${listed(from.map(nodeLabel))}: each ${linkTail(type, to)}`,
      )
  }
  return FOLLOWER_ORDER.flatMap((follower) =>
    [...rows.values()].filter((row) => row.follower === follower),
  )
}

/**
 * The core of the graph the Overview draws (`core-map.tsx`): where each main
 * kind sits, as column and row of a three by three grid. The places let the
 * lines cross only once: support case, incident, game and market all meet
 * one another, which cannot be drawn on a grid without one crossing.
 */
export const CORE_PLACES: Readonly<
  Record<string, { col: number; row: number }>
> = {
  Market: { col: 1, row: 0 },
  SupportCase: { col: 2, row: 0 },
  Player: { col: 0, row: 1 },
  Game: { col: 1, row: 1 },
  Incident: { col: 2, row: 1 },
  Campaign: { col: 0, row: 2 },
  Platform: { col: 1, row: 2 },
  PlatformVersion: { col: 2, row: 2 },
}

/** The core kinds, in reading order of the grid. */
export const CORE_KINDS = Object.keys(CORE_PLACES)

export interface CoreLink {
  id: string
  type: string
  from: string
  to: string
}

/** The schema's links between two different core kinds, in schema order. */
export function coreLinks(schema: Schemas['GraphSchema']): CoreLink[] {
  const present = new Set(schema.labels)
  const core = (kind: string) => kind in CORE_PLACES && present.has(kind)
  return schema.relationship_types
    .filter((r) => core(r.from_label) && core(r.to_label))
    .filter((r) => r.from_label !== r.to_label)
    .map((r) => ({
      id: `${r.type}:${r.from_label}>${r.to_label}`,
      type: r.type,
      from: r.from_label,
      to: r.to_label,
    }))
}
