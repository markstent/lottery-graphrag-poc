/** What each published run stands for, and which one the Results screen opens first. */

import type { Schemas } from '../api/client'
import { plainName } from '../app/plain-words'
import { kindWord } from '../app/run-kinds'
import { plural } from '../charts/scale'
import { STRATUM_LABELS } from './strata'

type Run = Schemas['BenchmarkRunOut']

/**
 * A result is a whole-bank official run; a subset covers part of the bank; a
 * quick check is a scorer test; any other kind, such as a development run or a
 * depth sweep, is not a result.
 */
export type RunStanding = 'result' | 'subset' | 'quick-check' | 'not-a-result'

export function standing(run: Run): RunStanding {
  if (run.run_kind === 'smoke') return 'quick-check'
  if (run.run_kind !== 'official') return 'not-a-result'
  const { strata, limit, questions } = run.selection
  return strata != null || limit != null || questions != null
    ? 'subset'
    : 'result'
}

const STANDING_WORDS: Record<Exclude<RunStanding, 'not-a-result'>, string> = {
  result: 'Result',
  subset: 'Subset run',
  'quick-check': 'Quick check',
}

/** The standing in words; a run that is not a result says so after its kind, "Development run, not a result". */
export function standingWord(run: Run): string {
  const kind = standing(run)
  return kind === 'not-a-result'
    ? `${kindWord(run.run_kind)}, not a result`
    : STANDING_WORDS[kind]
}

const startedAt = (run: Run) => Date.parse(run.started_at)

const newest = (candidates: readonly Run[]) =>
  candidates.reduce<Run | null>(
    (best, run) =>
      best === null || startedAt(run) > startedAt(best) ? run : best,
    null,
  )
const of = (runs: readonly Run[], kind: RunStanding) =>
  runs.filter((run) => standing(run) === kind)

/** The newest result: an official run of the whole bank, never a subset or a quick check; null with none. */
export const newestResult = (runs: readonly Run[]): Run | null =>
  newest(of(runs, 'result'))

/** The newest result, else the newest subset, else the newest run of any kind; null with no runs. */
export function defaultRun(runs: readonly Run[]): string | null {
  return (
    (newestResult(runs) ?? newest(of(runs, 'subset')) ?? newest(runs))
      ?.run_id ?? null
  )
}

/** What a subset run covers in words, to stand beside the "Subset run" label; null for a run of the whole bank. */
export function selectionText({
  strata,
  limit,
  questions,
}: Run['selection']): string | null {
  if (strata == null && limit == null && questions == null) return null
  const parts: string[] = []
  if (Array.isArray(strata))
    parts.push(
      `Strata: ${strata.map((name) => STRATUM_LABELS[String(name)] ?? plainName(String(name))).join(', ')}`,
    )
  else if (!Array.isArray(questions)) parts.push('All strata')
  if (Array.isArray(questions)) parts.push(`Questions: ${questions.join(', ')}`)
  if (typeof limit === 'number')
    parts.push(`at most ${plural(limit, 'instance')} per question`)
  return parts.join('; ')
}
