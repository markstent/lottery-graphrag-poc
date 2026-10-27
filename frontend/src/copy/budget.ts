/**
 * The copy budget (spec 7.8), in one place. Both caps are checked by tests:
 * product copy outside Help in `copy/banned-words.test.ts`, Help prose in
 * `screens/help/help.test.tsx`.
 */

/**
 * Product copy outside Help; the target is about 1,200 words. The count covers
 * the copy in src/screens (except Help), src/app, src/components, src/charts,
 * src/graph, src/design (the label maps) and src/results. It leaves out tests, fixtures,
 * the development pages, text from the API, and the glossary in src/copy,
 * which renders in Help and counts there.
 *
 * The count leaves out what a comparison reads (`status === 'ready'`), which
 * is not shown. The Phase 7 copy pass brought it from 1,362 to 1,300. The
 * owner raised it to 1,360 on 2026-10-27 (D-055), because method v0.3 labels
 * two methods: the method badge, evidence recall, the split judge agreement,
 * the groundedness table, the graph order in Live Lab and the start form's
 * reason for not starting the official run.
 */
export const OUTSIDE_HELP_WORD_CAP = 1360

/** Help prose, leaving out text from the API. */
export const HELP_WORD_CAP = 1650

export const wordsIn = (text: string): number =>
  text.split(/\s+/).filter(Boolean).length
