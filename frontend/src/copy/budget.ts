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
 * is not shown. The Phase 7 copy pass brought it from 1,362 to 1,300 (that count left out the noun in `plural()`; the scan now counts it). The
 * owner raised it to 1,360 on 2026-10-27 (D-055), because method v0.3 labels
 * two methods: the method badge, evidence recall, the split judge agreement,
 * the groundedness table, the graph order in Live Lab and the start form's
 * reason for not starting the official run. The owner raised it to 1,450 on
 * 2026-11-02 (D-098) for an Overview a newcomer can read at first glance,
 * then to 1,800 the same day (D-101) for the Data Model panels on why the
 * graph and the ontology are built as they are, and the Graph tab's table
 * of kinds of link, which the owner asked to be made understandable; and
 * to 1,900 the same day (D-106) for the Overview's score key, plain
 * findings and chart of evidence found by kind of question.
 */
export const OUTSIDE_HELP_WORD_CAP = 1900

export const wordsIn = (text: string): number =>
  text.split(/\s+/).filter(Boolean).length
