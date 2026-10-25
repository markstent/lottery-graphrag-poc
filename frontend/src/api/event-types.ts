/** Every event type of the run stream, as the contract names them. */

import type { components } from './schema'

type RunEvent = components['schemas']['RecordedEvent']

// tsc fails here when the contract gains or loses an event type.
export const EVENT_TYPES = {
  'run.started': true,
  'pipeline.started': true,
  'pipeline.completed': true,
  'pipeline.failed': true,
  'pipeline.cancelled': true,
  'run.completed': true,
  'run.failed': true,
  'run.cancelled': true,
  'rag.query.received': true,
  'rag.embedding.started': true,
  'rag.embedding.completed': true,
  'rag.vector_search.started': true,
  'rag.candidate.retrieved': true,
  'rag.rerank.started': true,
  'rag.candidate.reranked': true,
  'rag.evidence.selected': true,
  'rag.evidence.discarded': true,
  'rag.context.assembled': true,
  'rag.generation.started': true,
  'rag.generation.completed': true,
  'graph.entity_resolution.started': true,
  'graph.entity.resolved': true,
  'graph.query.expanded': true,
  'graph.seed.selected': true,
  'graph.traversal.started': true,
  'graph.node.discovered': true,
  'graph.relationship.traversed': true,
  'graph.ontology.expanded': true,
  'graph.rerank.started': true,
  'graph.candidate.reranked': true,
  'graph.candidate.selected': true,
  'graph.candidate.discarded': true,
  'graph.evidence_path.completed': true,
  'graph.context.assembled': true,
  'graph.generation.started': true,
  'graph.generation.completed': true,
} satisfies Record<RunEvent['event_type'], true>
