/**
 * The live figures the tech stack diagram prints (D-109), read from the
 * API as served: nothing here is estimated or copied from a run.
 */

import type { Schemas } from '../../api/client'

export interface StackCounts {
  /** Warehouse tables of the active world. */
  tables: number
  documents: number
  /** Passages in the text index (documents and table rows), or null before it is built. */
  passages: number | null
  /** Records in the graph, the business concepts left out (they are the ontology's). */
  graphRecords: number
  graphLinks: number
  graphKinds: number
  concepts: number
  ontologyVersion: string
  /** The answer model as the gateway names it, without its provider prefix or a ":latest" tag. */
  answerModel: string
}

/** The node label the ontology's concepts are loaded under. */
const CONCEPT_LABEL = 'BusinessConcept'

const sum = (values: Record<string, number>) =>
  Object.values(values).reduce((total, n) => total + n, 0)

export function stackCounts({
  dataset,
  detail,
  graph,
  ontology,
  models,
}: {
  dataset: Schemas['DatasetSummary']
  detail: Schemas['DatasetDetail']
  graph: Schemas['GraphStats']
  ontology: Schemas['OntologyOut']
  models: Schemas['ModelsOut']
}): StackCounts {
  const records = Object.fromEntries(
    Object.entries(graph.nodes_by_label).filter(
      ([label]) => label !== CONCEPT_LABEL,
    ),
  )
  return {
    tables: Object.keys(dataset.row_counts).length,
    documents: dataset.row_counts.documents ?? 0,
    passages: detail.index_status?.points ?? null,
    graphRecords: sum(records),
    graphLinks: sum(graph.relationships_by_type),
    graphKinds: Object.keys(records).length,
    concepts: ontology.concepts.length,
    ontologyVersion: ontology.version,
    answerModel: models.generation.model
      .replace(/^[a-z_]+\//, '')
      .replace(/:latest$/, ''),
  }
}
