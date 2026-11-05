/**
 * The Overview's example, followed through the three layers (D-115): the
 * incident the API names (`GET /api/v1/data-model/example`, never a planted
 * one), its table row, the graph links made from it and the shared concept its
 * incident type is matched to. Every part is read from the API, so the
 * example always fits the world shown.
 */

import {
  getDataModelExample,
  getNeighbours,
  getRecord,
  listDatasets,
  type Schemas,
} from '../../api/client'

type JsonValue = Schemas['JsonValue']

/** One kind of link meeting the example, with one record it reaches when known. */
export interface ExampleLink {
  type: string
  direction: 'out' | 'in'
  count: number
  sample?: string
}

export interface LayeredExample {
  incidentId: string
  row: Record<string, JsonValue>
  links: ExampleLink[]
  concept: { id: string; name: string } | null
}

/** The example is an incident, so its row is in this table. */
const INCIDENTS = 'incidents'
/** The incident's column naming its type, whose graph node maps to a concept. */
const TYPE_COLUMN = 'incident_type'
/** The most neighbours the API gives in one answer; samples come from these. */
const NEIGHBOUR_LIMIT = 100

const isDirection = (value: string): value is ExampleLink['direction'] =>
  value === 'out' || value === 'in'

/** The concept a type code is matched to: its neighbour along the ontology link. */
async function conceptOf(
  code: string,
  signal: AbortSignal,
): Promise<LayeredExample['concept']> {
  const { items } = await getNeighbours(code, { type: 'MAPS_TO' }, signal)
  const concept = items.find(
    (item) =>
      item.direction === 'out' && item.node.labels.includes('BusinessConcept'),
  )
  if (!concept) return null
  const name = concept.node.properties.label_en
  return {
    id: concept.node.node_id,
    name: typeof name === 'string' ? name : concept.node.node_id,
  }
}

/**
 * The example through the layers, or null when the world has none. A failed
 * request rejects, so the caller shows an error rather than the empty case.
 */
export async function loadExample(
  signal: AbortSignal,
): Promise<LayeredExample | null> {
  const { incident_id: incidentId } = await getDataModelExample(signal)
  if (incidentId === null || incidentId === undefined) return null
  const worlds = await listDatasets(signal)
  const world = worlds.find((w) => w.active)
  if (!world)
    throw new Error('No world is active, so the example cannot be shown.')
  const record = await getRecord(
    world.dataset_id,
    INCIDENTS,
    incidentId,
    signal,
  )
  const code = record.row[TYPE_COLUMN]
  const [neighbours, concept] = await Promise.all([
    record.graph_node_id
      ? getNeighbours(
          record.graph_node_id,
          { limit: NEIGHBOUR_LIMIT },
          signal,
        ).then((answer) => answer.items)
      : Promise.resolve([]),
    typeof code === 'string' ? conceptOf(code, signal) : Promise.resolve(null),
  ])
  const links = (record.edges ?? []).flatMap((edge): ExampleLink[] => {
    if (!isDirection(edge.direction)) return []
    const sample = neighbours.find(
      (n) => n.rel_type === edge.type && n.direction === edge.direction,
    )?.node.node_id
    return [
      {
        type: edge.type,
        direction: edge.direction,
        count: edge.count,
        ...(sample === undefined ? {} : { sample }),
      },
    ]
  })
  return { incidentId, row: record.row, links, concept }
}
