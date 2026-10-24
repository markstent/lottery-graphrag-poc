/** How an answer score and an evidence score read on every screen. */

/** An evidence score on its 0 to 1 scale with two decimals; "Missing" for none. */
export const evidenceScore = (value: number | null): string =>
  value === null ? 'Missing' : value.toFixed(2)

/** "Correct", "Not correct", or a percentage between; "Missing" for no score. */
export function answerWords(answer: number | null): string {
  if (answer === null) return 'Missing'
  if (answer >= 1) return 'Correct'
  if (answer <= 0) return 'Not correct'
  return `Partly correct (${Math.round(answer * 100)}%)`
}
