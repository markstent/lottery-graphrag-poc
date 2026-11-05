/** The names of the measures and table heads the Results tables show, beside the other label maps of this folder. */

export const MEASURES = {
  recall: 'Recall',
  precision: 'Precision',
  citation: 'Citation accuracy',
  latency: 'Latency (ms)',
  context: 'Context (tokens)',
  efficiency: 'Evidence per 1,000 tokens',
  failures: 'Failures',
  /** Repeats that have no score because the answer model failed: not the generation_failure class. */
  unscored: 'Repeats with no score (generation failed)',
  /** Repeats whose answer stops before the model finished it (D-096). */
  cutOff: 'Answers cut off',
  judge: 'Judge (0 to 2)',
  judgeName: 'Judge',
} as const

export const QUESTION_HEADS = {
  question: 'Question',
  kind: 'Kind',
  approach: 'Approach',
  world: 'World',
  answer: 'Answer',
  liveLab: 'Live Lab',
} as const

export const TABLE_HEADS = {
  measure: 'Measure',
  failureKind: 'Failure',
  kindApproach: 'Kind and approach',
  group: 'Group',
  pairs: 'Pairs judged',
  agreement: 'Agreement',
  weightedKappa: 'Weighted kappa',
  supported: 'Held by cited blocks',
  unsupported: 'In no shown block',
  questions: 'Questions',
  total: 'in all',
} as const

/** Table names that are read out and never drawn. */
export const CAPTIONS = {
  questions: 'Questions',
  efficiency: 'Efficiency',
  failures: 'Failures',
  judge: 'Judge',
  agreement: 'Agreement',
  groundedness: 'Groundedness',
} as const
