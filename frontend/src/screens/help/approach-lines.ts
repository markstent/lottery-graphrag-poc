import type { PipelineId } from '../../design/pipelines'

/** One line on each approach, for its card in Help. */
export const APPROACH_LINES: Record<PipelineId, string> = {
  A: 'Finds the passages of documents that best match the words of the question.',
  B: 'Adds records linked to the question by relationships, such as an incident and its platform version.',
  C: 'Also uses the ontology, which ties each market’s local terms to one concept, so a question can cross markets.',
}
