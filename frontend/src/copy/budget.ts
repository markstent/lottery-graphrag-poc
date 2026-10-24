/**
 * The copy budget (spec 7.8), in one place. Both caps are checked by tests:
 * product copy outside Help in `copy/banned-words.test.ts`, Help prose in
 * `screens/help/help.test.tsx`.
 */

/**
 * Product copy outside Help; the target is about 1,200 words. The count covers
 * the copy in src/screens (except Help), src/app, src/components, src/charts,
 * src/graph and src/design (the label maps). It leaves out tests, fixtures,
 * the development pages, text from the API, and the glossary in src/copy,
 * which renders in Help and counts there.
 *
 * Raised from 1,300 to 1,375 (measured 1,359, rounded up to the next 25) by the
 * controller's ruling for Phase 7 Task 6: the start form, its progress and the
 * Live Lab deep-link message are required copy with no helper prose left to cut.
 * The owner's decision is pending at CP3.
 */
export const OUTSIDE_HELP_WORD_CAP = 1375

/** Help prose, leaving out text from the API. */
export const HELP_WORD_CAP = 1650

export const wordsIn = (text: string): number =>
  text.split(/\s+/).filter(Boolean).length
