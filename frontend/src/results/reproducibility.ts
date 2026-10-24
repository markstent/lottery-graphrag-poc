/** A run's reproducibility record as labelled rows, for runs old and new. */

import type { Schemas } from '../api/client'
import { plainName, plainValue } from '../app/plain-words'
import { yesNo } from '../app/score-words'

type JsonValue = Schemas['JsonValue']

const NOT_RECORDED = 'Not recorded'

/** Every field of docs/evaluation/reproducibility.md in the order it is shown. */
export const REPRO_LABELS: Record<string, string> = {
  git_sha: 'Code version',
  git_dirty: 'Code changed since that version',
  question_bank_version: 'Question bank version (in the code)',
  bank_version: 'Question bank version (frozen)',
  bank_hash: 'Question bank fingerprint',
  scorer_version: 'Scorer version',
  run_kind: 'Kind of run',
  repeats: 'Repeats per question',
  started_at: 'Started',
  world_dir: 'World folder',
  generator_version: 'World generator version',
  profile: 'World size',
  world_seed: 'World number',
  scenario_seed: 'Scenario number',
  reference_date: 'Reference date',
  ontology_version: 'Ontology version',
  graph_label_version: 'Graph label version',
  embedding_model: 'Embedding model',
  embedding_dimensions: 'Embedding size',
  sparse_model: 'Keyword search model',
  rrf_k: 'Rank fusion constant',
  record_serialiser_version: 'Record text version',
  reranker: 'Second-pass ranking model',
  top_k: 'Hits per search before fusion',
  context_budget_tokens: 'Context budget (tokens)',
  context: 'Context settings',
  dedupe_threshold: 'Near-duplicate threshold',
  graph_limits: 'Graph limits',
  relationship_types_b: 'Relationships followed by Graph',
  relationship_types_c: 'Relationships followed by Graph + Ontology',
  ranking_weights: 'Graph evidence ranking weights',
  excluded_labels: 'Node labels the graph does not follow',
  generation_model: 'Answer model',
  generation_model_family: 'Answer model family',
  generation_quantisation: 'Answer model quantisation',
  generation_temperature: 'Answer model temperature',
  max_tokens: 'Answer length limit (tokens)',
  generation_reasoning: 'Answer model reasoning',
  prompt_version: 'Answer prompt version',
  prompt_hash: 'Answer prompt fingerprint',
  judge_model: 'Judge model',
  judge_model_family: 'Judge model family',
  judge_reasoning: 'Judge model reasoning',
  judge_temperature: 'Judge model temperature',
  judge_prompt_version: 'Judge prompt version',
  judge_prompt_hash: 'Judge prompt fingerprint',
}

function show(value: JsonValue | undefined): string {
  if (value === null || value === undefined) return NOT_RECORDED
  if (typeof value === 'boolean') return yesNo(value ? 1 : 0)
  const text = plainValue(value)
  return text === '' ? 'None' : text
}

/** Every labelled field in label order, then any other key; a field the run did not record reads "Not recorded". */
export function reproFields(
  record: Record<string, JsonValue>,
): { key: string; label: string; value: string }[] {
  const known = Object.entries(REPRO_LABELS).map(([key, label]) => ({
    key,
    label,
    value: show(record[key]),
  }))
  const extra = Object.keys(record)
    .filter((key) => !(key in REPRO_LABELS))
    .map((key) => ({ key, label: plainName(key), value: show(record[key]) }))
  return [...known, ...extra]
}
