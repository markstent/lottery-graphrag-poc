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
  /** The reader has typed in Repeats, so a change of kind leaves it alone. */
  repeatsEdited: boolean
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
  repeatsEdited: false,
  scope: 'bank',
  strata: [],
  limit: '',
}

/** Another kind; Repeats follows the kind's own minimum until the reader has typed in it. */
export const withKind = (form: StartForm, kind: Start['kind']): StartForm => ({
  ...form,
  kind,
  repeats: form.repeatsEdited ? form.repeats : String(MIN_REPEATS[kind]),
})

type Field = 'worlds' | 'repeats' | 'limit' | 'strata'

/** The request field each server field name stands for (seeds are the worlds). */
const FIELD_OF_NAME: Record<string, Field> = {
  seeds: 'worlds',
  repeats: 'repeats',
  limit: 'limit',
  strata: 'strata',
}

/**
 * A 422's message ("seeds: ...; unknown strata [...]") split by field: the parts
 * that name a field go to that field, the rest stay a form-level message.
 */
export function serverErrors(message: string): {
  fields: Partial<Record<Field, string>>
  rest: string | null
} {
  const fields: Partial<Record<Field, string>> = {}
  const rest: string[] = []
  for (const part of message.split('; ')) {
    const field =
      FIELD_OF_NAME[/\b(seeds|repeats|limit|strata)\b/.exec(part)?.[1] ?? '']
    if (field && !(field in fields)) fields[field] = part
    else rest.push(part)
  }
  return { fields, rest: rest.length === 0 ? null : rest.join('; ') }
}

const wholeAtLeast = (min: number) => `Use a whole number, at least ${min}.`

const wholeNumber = (text: string) => /^\d+$/.test(text.trim())

/** What is wrong with the form, by field; the backend checks the same rules again. */
export function errorsOf(form: StartForm): Partial<Record<Field, string>> {
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
