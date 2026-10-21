import { TOKENS } from './tokens'

export type PipelineId = 'A' | 'B' | 'C'

export interface Pipeline {
  id: PipelineId
  name: string
  label: string
  /** Marks, lines and fills that carry identity (3:1 or better on white). */
  hue: string
  /** Light fill behind pipeline content. */
  tint: string
  /** Darker tone for text and thin lines (4.5:1 on white, on the tint and on the page). */
  strong: string
}

function define(id: PipelineId, name: string): Pipeline {
  const key = id.toLowerCase() as 'a' | 'b' | 'c'
  return {
    id,
    name,
    label: `${id} · ${name}`,
    hue: TOKENS[`color-pipeline-${key}`],
    tint: TOKENS[`color-pipeline-${key}-tint`],
    strong: TOKENS[`color-pipeline-${key}-strong`],
  }
}

export const PIPELINES = [
  define('A', 'Text search'),
  define('B', 'Graph'),
  define('C', 'Graph + Ontology'),
] as const

export function pipeline(id: PipelineId): Pipeline {
  return PIPELINES.find((p) => p.id === id) as Pipeline
}
