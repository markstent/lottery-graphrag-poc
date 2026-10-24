/** How an answer score, an evidence score and a yes/no score read on every screen. */

/** What a score that was not given reads as. */
export const MISSING = 'Missing'

/** A 0 to 1 score as a whole percentage; "Missing" for none. */
export const percent = (value: number | null): string =>
  value === null ? MISSING : `${Math.round(value * 100)}%`

/** An evidence score on its 0 to 1 scale with two decimals; "Missing" for none. */
export const evidenceScore = (value: number | null): string =>
  value === null ? MISSING : value.toFixed(2)

/** "Correct", "Not correct", or a percentage between; "Missing" for no score. */
export function answerWords(answer: number | null): string {
  if (answer === null) return MISSING
  if (answer >= 1) return 'Correct'
  if (answer <= 0) return 'Not correct'
  return `Partly correct (${percent(answer)})`
}

/** "Yes", "No", or a percentage between; "Missing" for no score. */
export function yesNo(value: number | null): string {
  if (value === null) return MISSING
  if (value >= 1) return 'Yes'
  return value <= 0 ? 'No' : percent(value)
}
