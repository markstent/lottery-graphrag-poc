/** Plain names the Settings drawer shows for model roles and reachability. */

export const MODEL_LABELS = {
  generation: 'Answer model',
  embedding: 'Embedding model',
  rerank: 'Re-ordering model',
  sparse: 'Keyword search model',
} as const

export const REACHABLE = {
  true: 'Reachable',
  false: 'Not reachable',
  null: 'Not checked',
} as const

/** What every model row says on the public read-only site, where no model runs (D-117). */
export const MODELS_OFF_PUBLIC = 'Off on the public site'
