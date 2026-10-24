/**
 * What Data Model draws, worked out from the API's answers: the warehouse
 * tables grouped by source system, and the map of the graph's kinds of record
 * with the relationships each approach may follow. Pure functions, apart from
 * the drawing in meta-graph.tsx and the tabs.
 */

import type { Schemas } from '../../api/client'
import { plainName } from '../../app/plain-words'
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

export interface MetaGraphModel {
  nodes: DiagramNode[]
  edges: DiagramEdge[]
  /** Relationships between two records of one kind, which the map cannot draw as an edge. */
  loops: string[]
}

/**
 * The map of kinds of record: each sized by its count, each relationship type
 * labelled with the count the ingestion recorded for it. The statistics count
 * a type once across every pair of kinds it joins, so a type that joins
 * several pairs says "in all". `mode` picks which relationships are shown:
 * those B may follow, those C may follow (the ontology's marked apart), or
 * the whole schema (those neither follows marked apart).
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
  const pairs = new Map<string, number>()
  for (const { type } of schema.relationship_types)
    pairs.set(type, (pairs.get(type) ?? 0) + 1)

  const labelFor = (type: string) => {
    const total = stats.relationships_by_type[type]
    const words = relationshipPhrase(type)
    if (total === undefined) return words
    return `${words} · ${count(total)}${(pairs.get(type) ?? 0) > 1 ? ' in all' : ''}`
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
  const loops: string[] = []
  const connected = new Set<string>()
  for (const rel of schema.relationship_types) {
    const { hidden, look } = looks(rel.type)
    if (rel.from_label === rel.to_label) {
      if (!hidden) {
        loops.push(
          `${nodeLabel(rel.from_label)} ${labelFor(rel.type).replace(' · ', ` ${nodeLabel(rel.to_label)} · `)}`,
        )
        connected.add(rel.from_label)
      }
      continue
    }
    if (!hidden) {
      connected.add(rel.from_label)
      connected.add(rel.to_label)
    }
    edges.push({
      id: `${rel.type}:${rel.from_label}>${rel.to_label}`,
      source: rel.from_label,
      target: rel.to_label,
      label: labelFor(rel.type),
      hidden,
      look,
    })
  }

  const largest = Math.max(1, ...Object.values(stats.nodes_by_label))
  const nodes = schema.labels.map((label) => {
    const n = stats.nodes_by_label[label] ?? 0
    const share = Math.log1p(n) / Math.log1p(largest)
    return {
      id: label,
      title: nodeLabel(label),
      detail: `${count(n)} ${n === 1 ? 'node' : 'nodes'}`,
      width: Math.round((MIN_WIDTH + (MAX_WIDTH - MIN_WIDTH) * share) * scale),
      dimmed: !connected.has(label),
    }
  })
  return { nodes, edges, loops }
}
