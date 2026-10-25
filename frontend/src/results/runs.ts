/** What each published run stands for, and which one the Results screen opens first. */

import type { Schemas } from '../api/client'
import { plainName } from '../app/plain-words'
import { plural } from '../charts/scale'

type Run = Schemas['BenchmarkRunOut']

/** A result is a whole-bank official run; a subset covers part of the bank; a quick check is a scorer test. */
export type RunStanding = 'result' | 'subset' | 'quick-check'

export function standing(run: Run): RunStanding {
  if (run.run_kind === 'smoke') return 'quick-check'
  const { strata, limit, questions } = run.selection
  return run.run_kind === 'official' &&
    (strata != null || limit != null || questions != null)
    ? 'subset'
    : 'result'
}

const STANDING_WORDS: Record<RunStanding, string> = {
  result: 'Result',
  subset: 'Subset run',
  'quick-check': 'Quick check',
}

export const standingWord = (run: Run): string => STANDING_WORDS[standing(run)]

const startedAt = (run: Run) => Date.parse(run.started_at)

/** The newest result, else the newest subset, else the newest run; null with no runs. */
export function defaultRun(runs: readonly Run[]): string | null {
  const newest = (candidates: readonly Run[]) =>
    candidates.reduce<Run | null>(
      (best, run) =>
        best === null || startedAt(run) > startedAt(best) ? run : best,
      null,
    )
  const of = (kind: RunStanding) => runs.filter((run) => standing(run) === kind)
  return (
    (newest(of('result')) ?? newest(of('subset')) ?? newest(runs))?.run_id ??
    null
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
      `Strata: ${strata.map((name) => plainName(String(name))).join(', ')}`,
    )
  else if (!Array.isArray(questions)) parts.push('All strata')
  if (Array.isArray(questions)) parts.push(`Questions: ${questions.join(', ')}`)
  if (typeof limit === 'number')
    parts.push(`at most ${plural(limit, 'instance')} per question`)
  return parts.join('; ')
}
