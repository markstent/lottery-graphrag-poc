/** A run's reproducibility record by record name. */

import type { Schemas } from '../api/client'
import { plainValue } from '../app/plain-words'
import { yesNo } from '../app/score-words'

type JsonValue = Schemas['JsonValue']

export const NOT_RECORDED = 'Not recorded'

/** Every field of docs/reference/evaluation/reproducibility.md in the order it is shown, by the name the record gives it. */
export const REPRO_KEYS = [
  'git_sha',
  'git_dirty',
  'question_bank_version',
  'bank_version',
  'bank_hash',
  'scorer_version',
  'method_version',
  'run_kind',
  'repeats',
  'started_at',
  'world_dir',
  'generator_version',
  'profile',
  'world_seed',
  'scenario_seed',
  'reference_date',
  'ontology_version',
  'graph_label_version',
  'embedding_model',
  'embedding_dimensions',
  'sparse_model',
  'rrf_k',
  'record_serialiser_version',
  'record_facts_version',
  'reranker',
  'top_k',
  'selection_rule',
  'context_budget_tokens',
  'context',
  'dedupe_threshold',
  'graph_limits',
  'relationship_types_b',
  'relationship_types_c',
  'ranking_weights',
  'excluded_labels',
  'generation_model',
  'generation_model_family',
  'generation_quantisation',
  'generation_temperature',
  'max_tokens',
  'generation_reasoning',
  'prompt_version',
  'prompt_hash',
  'prompt_extras',
  'answer_parser_version',
  'judge_model',
  'judge_model_family',
  'judge_reasoning',
  'judge_temperature',
  'judge_prompt_version',
  'judge_prompt_hash',
] as const

/** A recorded field read as a number, or null when the run recorded none (or something else). */
export function recordedNumber(value: JsonValue | undefined): number | null {
  return typeof value === 'number' ? value : null
}

function show(value: JsonValue | undefined): string {
  if (value === null || value === undefined) return NOT_RECORDED
  if (typeof value === 'boolean') return yesNo(value ? 1 : 0)
  const text = plainValue(value)
  return text === '' ? 'None' : text
}

/**
 * Every known field in order, then any other key, each by its record name; a field the run did not record reads "Not recorded".
 * `perWorld` are the worlds' records: a field only they hold, such as bank_hash, differs by world and is left to each world's own list.
 */
export function reproFields(
  record: Record<string, JsonValue>,
  perWorld: readonly Record<string, JsonValue>[] = [],
): { key: string; value: string }[] {
  const known: readonly string[] = REPRO_KEYS
  const extra = Object.keys(record).filter((key) => !known.includes(key))
  const worldOnly = (key: string) =>
    !(key in record) && perWorld.some((world) => key in world)
  return [...REPRO_KEYS, ...extra]
    .filter((key) => !worldOnly(key))
    .map((key) => ({
      key,
      value: show(record[key]),
    }))
}
