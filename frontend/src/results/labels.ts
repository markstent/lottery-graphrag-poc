/** The names of the measures and table heads the Results tables show, beside the other label maps of this folder. */

export const MEASURES = {
  recall: 'Recall',
  precision: 'Precision',
  citation: 'Citation accuracy',
  latency: 'Latency (ms)',
  context: 'Context (tokens)',
  efficiency: 'Evidence per 1,000 tokens',
  failures: 'Failure classes',
  /** Repeats that have no score because the answer model failed: not the generation_failure class. */
  unscored: 'Repeats with no score (generation failed)',
  judge: 'Judge (0 to 2)',
  judgeName: 'Judge',
} as const

export const QUESTION_HEADS = {
  question: 'Question',
  kind: 'Kind',
  world: 'World',
  answer: 'Answer',
  evidence: 'Evidence',
  liveLab: 'Live Lab',
} as const

export const TABLE_HEADS = {
  measure: 'Measure',
  failureKind: 'Kind of failure',
  efficiencyRow: 'Kind of question and approach',
  group: 'Group',
  pairs: 'Pairs judged',
  agreement: 'Agreement',
  kappa: 'Kappa',
  total: 'in all',
} as const

/** Table names that are read out and never drawn. */
export const CAPTIONS = {
  questions: 'Question scores',
  efficiency: 'Efficiency',
  failures: 'Failures',
  judge: 'Judge scores',
  agreement: 'Agreement',
} as const
