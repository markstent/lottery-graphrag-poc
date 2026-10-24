/** What each published run stands for, and which one the Results screen opens first. */

import type { Schemas } from '../api/client'

type Run = Schemas['BenchmarkRunOut']

/** A result is a whole-bank official run; a subset covers part of the bank; a quick check is a scorer test. */
export type RunStanding = 'result' | 'subset' | 'quick-check'

export function standing(run: Run): RunStanding {
  if (run.run_kind === 'smoke') return 'quick-check'
  const { strata, limit } = run.selection
  return run.run_kind === 'official' && (strata != null || limit != null)
    ? 'subset'
    : 'result'
}

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
