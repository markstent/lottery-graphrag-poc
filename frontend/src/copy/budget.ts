/**
 * The copy budget (spec 7.8), in one place. Both caps are checked by tests:
 * product copy outside Help in `copy/banned-words.test.ts`, Help prose in
 * `screens/help/help.test.tsx`.
 */

/** Product copy outside Help; the target is about 1,200 words. */
export const OUTSIDE_HELP_WORD_CAP = 1300

/** Help prose, leaving out text from the API. */
export const HELP_WORD_CAP = 1650

export const wordsIn = (text: string): number =>
  text.split(/\s+/).filter(Boolean).length
