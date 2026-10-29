/**
 * Plain words for an answer that stops before the model finished it (D-096).
 * The backend decides whether an answer is cut off and whether it stopped at
 * the output token limit; these only word it. The limit is the one the answer
 * or the run was generated under, as recorded with it, never a number typed
 * here.
 */

import type { Schemas } from '../api/client'
import { formatNumber } from '../charts/scale'
import { NOT_RECORDED } from '../results/reproducibility'

type Answer = Pick<
  Schemas['RagAnswer'],
  'cut_off' | 'token_limit_reached' | 'max_tokens'
>

const limit = (maxTokens: number | null | undefined) =>
  maxTokens == null
    ? 'the token limit'
    : `the ${formatNumber(maxTokens, { decimals: 0 })}-token limit`

/** The note under a cut-off answer, or null for an answer that is not (or was recorded before the record existed). */
export function cutOffNote(answer: Answer): string | null {
  if (answer.cut_off !== true) return null
  return answer.token_limit_reached === true
    ? `The answer stopped at ${limit(answer.max_tokens)}.`
    : 'The answer stops part-way.'
}

/**
 * One approach's cut-off repeats for the Results details, such as
 * "2 (1 at the 4,096-token limit)"; `maxTokens` is the run's recorded limit.
 */
export function cutOffCount(
  cutOff: number | null | undefined,
  atLimit: number | null | undefined,
  maxTokens: number | null,
): string {
  if (cutOff == null) return NOT_RECORDED
  return atLimit ? `${cutOff} (${atLimit} at ${limit(maxTokens)})` : `${cutOff}`
}
