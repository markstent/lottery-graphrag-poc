/**
 * The chapters of Help's guide, in the order of the spec
 * (docs/superpowers/specs/2026-10-26-help-v2-design.md) with what the official
 * run teaches at the end, and the questions and answers, which are a page of
 * their own beside the guide (D-110). Also the old section ids that still
 * link to them, and the shape of a chapter's copy.
 */

export const CHAPTERS = [
  { id: 'why', nav: 'Why this exists', title: '1. Why this exists' },
  {
    id: 'company',
    nav: 'The made-up company',
    title: '2. The made-up company',
  },
  {
    id: 'stories',
    nav: 'The planted stories',
    title: '3. The planted stories',
  },
  {
    id: 'approaches',
    nav: 'The three approaches',
    title: '4. The three approaches',
  },
  {
    id: 'evidence',
    nav: 'How evidence is chosen',
    title: '5. How evidence is chosen',
  },
  {
    id: 'answer',
    nav: 'The answer and the judge',
    title: '6. The answer and the judge',
  },
  { id: 'scoring', nav: 'Scoring', title: '7. How scoring works' },
  {
    id: 'results',
    nav: 'Reading the results',
    title: '8. Reading the results',
  },
  {
    id: 'limits',
    nav: 'Assumptions and limits',
    title: '9. Assumptions and limits',
  },
  { id: 'glossary', nav: 'Glossary', title: '10. Glossary' },
  { id: 'running', nav: 'Running it', title: '11. Running it' },
  {
    id: 'lessons',
    nav: 'What the results teach',
    title: '12. What the results teach',
  },
] as const

/** The questions and answers: every benchmark question with its answer key, a page beside the guide. */
export const QUESTIONS_PAGE = {
  id: 'questions',
  nav: 'Questions and answers',
  title: 'Questions and answers',
} as const

export type GuideChapterId = (typeof CHAPTERS)[number]['id']
export type ChapterId = GuideChapterId | typeof QUESTIONS_PAGE.id

/** Every page of Help, the guide's chapters and the questions and answers. */
export const PAGES = [...CHAPTERS, QUESTIONS_PAGE] as const

/** The eight ids of the first Help, which other screens and shared links still use. */
export const SECTION_ALIASES: Record<string, ChapterId> = {
  what: 'why',
  data: 'company',
  stories: 'stories',
  approaches: 'approaches',
  scoring: 'scoring',
  questions: 'questions',
  glossary: 'glossary',
  running: 'running',
}

/** A key of the settings a run records, such as `top_k`; a nested one is written `context.dedupe_threshold`. */
export type SettingKey = string

/**
 * The pictures a chapter can show: each approach, how evidence is chosen, and
 * the small pictures that explain the test, a world, the four countries'
 * names, evidence found, how an answer is marked and a margin of error.
 */
export const DIAGRAM_NAMES = [
  'approachA',
  'approachB',
  'approachC',
  'evidence',
  'test',
  'world',
  'countries',
  'found',
  'marking',
  'interval',
] as const

export type DiagramName = (typeof DIAGRAM_NAMES)[number]

/** Live parts of a chapter that plain text cannot hold: they read the bank, the newest run or the API. */
export type ComponentName =
  'dataTour' | 'stories' | 'register' | 'questions' | 'glossary' | 'running'

/** A table of text a chapter states: a caption read by a screen reader, its column names and its rows, the first cell of each row naming it. */
export interface TableBlock {
  kind: 'table'
  caption: string
  columns: readonly string[]
  rows: readonly (readonly string[])[]
}

/**
 * One block of a chapter. A string is a paragraph and a list of strings is a
 * bulleted list; either may hold `{setting_key}`, filled from the settings.
 * A heading names the part of the chapter that follows it. A key line is the
 * chapter's point in one sentence, drawn boxed as "In one line"; "more"
 * folds blocks behind a disclosure (summary "More detail" when left empty);
 * steps are a numbered list.
 */
export type Block =
  | string
  | readonly string[]
  | { kind: 'heading'; text: string }
  | { kind: 'key'; text: string }
  | { kind: 'more'; summary: string; blocks: readonly Block[] }
  | { kind: 'steps'; items: readonly string[] }
  | TableBlock
  | { kind: 'settings'; keys: readonly SettingKey[] }
  | { kind: 'diagram'; name: DiagramName }
  | { kind: 'component'; name: ComponentName }

/** What a chapter says: the Plain blocks always, the Technical blocks after them at the Technical level. */
export interface ChapterCopy {
  plain: readonly Block[]
  technical: readonly Block[]
  /** A sentence shown at Plain only, pointing to what the Technical level adds. */
  plainHint?: string
  /**
   * The glossary terms the chapter uses, as the glossary spells them. A test
   * checks that each is in the glossary and appears in the chapter's text.
   */
  terms?: readonly string[]
}
