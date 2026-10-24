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

/** One relationship type, once, with its count, for the list beside the map. */
export interface RelationshipLine {
  type: string
  /** "is an instance of concept: 124" */
  text: string
  /** What else a reader needs: a link between two records of one kind, or one neither approach follows. */
  note?: string
}

export interface MetaGraphModel {
  /** The kinds that have a relationship in the schema, for the drawing. */
  nodes: DiagramNode[]
  /** The kinds with no relationship at all, which the drawing would only clutter. */
  isolated: DiagramNode[]
  edges: DiagramEdge[]
  /** Each relationship type shown, once, with its count. */
  types: RelationshipLine[]
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
  const types = new Map<string, RelationshipLine>()
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
    const total = stats.relationships_by_type[rel.type]
    const note =
      look === 'outside'
        ? 'followed by neither approach'
        : rel.from_label === rel.to_label
          ? `between two ${nodeLabel(rel.from_label)} records`
          : undefined
    types.set(rel.type, {
      type: rel.type,
      text:
        total === undefined
          ? relationshipPhrase(rel.type)
          : `${relationshipPhrase(rel.type)}: ${count(total)}`,
      note: types.get(rel.type)?.note ?? note,
    })
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
      detail: plural(n, 'node'),
      width: Math.round((MIN_WIDTH + (MAX_WIDTH - MIN_WIDTH) * share) * scale),
      dimmed: !connected.has(label),
    }
  })
  return {
    nodes: sized.filter((n) => joined.has(n.id)),
    isolated: sized.filter((n) => !joined.has(n.id)),
    edges,
    types: [...types.values()],
    hasOutside: edges.some((e) => !e.hidden && e.look === 'outside'),
  }
}

/** The concept's name in `language`, or its English name when it has none there. */
export const labelOf = (
  concept: Schemas['ConceptOut'],
  language = 'en',
): string => concept.labels[language] ?? concept.labels.en ?? concept.concept_id
