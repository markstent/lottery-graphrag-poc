/**
 * The copy budget (spec 7.8), in one place. The cap on product copy outside
 * Help is checked in `copy/banned-words.test.ts`.
 *
 * Help has no word cap since D-082: it is a one-stop guide at two reading
 * levels, and its Plain text is held to the banned-word list instead.
 */

/**
 * Product copy outside Help; the target is about 1,200 words. The count covers
 * the copy in src/screens (except Help), src/app, src/components, src/charts,
 * src/graph, src/design (the label maps) and src/results. It leaves out tests, fixtures,
 * the development pages, text from the API, and the glossary in src/copy,
 * which renders in Help and counts there.
 *
 * The count leaves out what a comparison reads (`status === 'ready'`), which
 * is not shown. The Phase 7 copy pass brought it from 1,362 to 1,300, so the
 * raise to 1,375 made for the start form is withdrawn.
 */
export const OUTSIDE_HELP_WORD_CAP = 1300

export const wordsIn = (text: string): number =>
  text.split(/\s+/).filter(Boolean).length
