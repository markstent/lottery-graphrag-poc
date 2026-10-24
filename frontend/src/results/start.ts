/** The start form of a benchmark run: its checks, the request it makes and the progress line. */

import type { Schemas } from '../api/client'

type Start = Schemas['BenchmarkStart']
type Progress = Schemas['JobProgress']

/** The worlds the harness runs. */
export const WORLD_SEEDS = [2026, 2027, 2028]

/** The kinds of question a run can be limited to; "all questions" and the name-anchored group are views, not strata. */
export const STRATA = ['H1', 'H2', 'H3', 'H5']

const MIN_REPEATS: Record<Start['kind'], number> = { official: 3, smoke: 1 }

export interface StartForm {
  kind: Start['kind']
  worlds: number[]
  /** As typed, so an empty box is an error and not a zero. */
  repeats: string
  scope: 'bank' | 'chosen'
  /** The kinds of question, used only when the scope is chosen. */
  strata: string[]
  /** As typed; empty means no limit. */
  limit: string
}

export const DEFAULT_FORM: StartForm = {
  kind: 'official',
  worlds: WORLD_SEEDS,
  repeats: String(MIN_REPEATS.official),
  scope: 'bank',
  strata: [],
  limit: '',
}

const wholeAtLeast = (min: number) => `Use a whole number, at least ${min}.`

const wholeNumber = (text: string) => /^\d+$/.test(text.trim())

/** What is wrong with the form, by field; the backend checks the same rules again. */
export function errorsOf(
  form: StartForm,
): Partial<Record<'worlds' | 'repeats' | 'limit' | 'strata', string>> {
  const errors: Partial<
    Record<'worlds' | 'repeats' | 'limit' | 'strata', string>
  > = {}
  const min = MIN_REPEATS[form.kind]
  if (form.worlds.length === 0) errors.worlds = 'Choose at least one world.'
  if (form.scope === 'chosen' && form.strata.length === 0)
    errors.strata = 'Choose at least one kind.'
  if (!wholeNumber(form.repeats) || Number(form.repeats) < min)
    errors.repeats = wholeAtLeast(min)
  if (
    form.limit.trim() !== '' &&
    (!wholeNumber(form.limit) || Number(form.limit) < 1)
  )
    errors.limit = wholeAtLeast(1)
  return errors
}

/** The request for a form that passes `errorsOf`. */
export const startBody = (form: StartForm): Start => ({
  kind: form.kind,
  seeds: WORLD_SEEDS.filter((seed) => form.worlds.includes(seed)),
  repeats: Number(form.repeats),
  strata: form.scope === 'chosen' ? form.strata : null,
  limit: form.limit.trim() === '' ? null : Number(form.limit),
})

export const progressText = (progress: Progress | null | undefined): string =>
  progress
    ? `World ${progress.world_seed} (${progress.worlds_done + 1} of ${progress.worlds_total}): ${progress.instances_done} of ${progress.instances_total} questions`
    : 'Starting'

/** The share of the run done: finished worlds count whole, the current one by its questions. */
export function progressFraction(
  progress: Progress | null | undefined,
): number {
  if (!progress || progress.worlds_total === 0) return 0
  const current =
    progress.instances_total === 0
      ? 0
      : progress.instances_done / progress.instances_total
  return (progress.worlds_done + current) / progress.worlds_total
}
