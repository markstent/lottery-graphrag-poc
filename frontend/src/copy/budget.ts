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
 * findings and chart of evidence found by kind of question; and to 1,950
 * the same day (D-107, D-108) for the Overview's plainer count line and the
 * Live Lab's easy-to-read questions; and to 2,400 the same day (D-109) for
 * the Architecture screen: its tech stack diagram and the same diagram in
 * words, which a screen reader needs. The owner raised it to 3,350 on
 * 2026-11-04 (D-113), asking for Data Model write-ups that are easy to
 * follow: how each layer is built, where every kind of graph link is made
 * from, how to read the warehouse maps and the story cards; and to 3,500
 * the same day (D-114) for the way-finding the owner asked for, so a reader
 * can see what to click: three steps on each tab, a trail and a click cue.
 * The rise to 3,510 on 2026-11-05 is temporary, for the D-115 Data Model
 * redesign while its old and new views both exist, and so is the rise to
 * 3,850 the same day for the new Overview tab (its layer cards, the example
 * through the layers and the short notes on how each layer is built), and
 * the rise to 4,000 for the Tables tab, while the old explanation panels
 * they replace are still in the code; Task 9 of that plan sets the final
 * value.
 */
export const OUTSIDE_HELP_WORD_CAP = 4000

export const wordsIn = (text: string): number =>
  text.split(/\s+/).filter(Boolean).length
