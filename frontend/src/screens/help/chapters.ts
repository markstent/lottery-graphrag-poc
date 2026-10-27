/**
 * The twelve chapters of Help, in the order of the spec (docs/superpowers/specs/2026-10-26-help-v2-design.md),
 * the old section ids that still link to them, and the shape of a chapter's copy.
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
  { id: 'questions', nav: 'The questions', title: '10. The questions' },
  { id: 'glossary', nav: 'Glossary', title: '11. Glossary' },
  { id: 'running', nav: 'Running it', title: '12. Running it' },
] as const

export type ChapterId = (typeof CHAPTERS)[number]['id']

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

/** A key of the settings a run records, such as `top_k`; a nested one is written `context.graph_slots`. */
export type SettingKey = string

/** The pictures a chapter can show: each approach in chapter 4, and how evidence is chosen in chapter 5. */
export const DIAGRAM_NAMES = [
  'approachA',
  'approachB',
  'approachC',
  'evidence',
] as const

export type DiagramName = (typeof DIAGRAM_NAMES)[number]

/** Live parts of a chapter that plain text cannot hold: they read the bank, the newest run or the API. */
export type ComponentName =
  'dataTour' | 'stories' | 'register' | 'questions' | 'glossary' | 'running'

/**
 * One block of a chapter. A string is a paragraph and a list of strings is a
 * bulleted list; either may hold `{setting_key}`, filled from the settings.
 */
export type Block =
  | string
  | readonly string[]
  | { kind: 'settings'; keys: readonly SettingKey[] }
  | { kind: 'diagram'; name: DiagramName }
  | { kind: 'component'; name: ComponentName }

/** What a chapter says: the Plain blocks always, the Technical blocks after them at the Technical level. */
export interface ChapterCopy {
  plain: readonly Block[]
  technical: readonly Block[]
  /**
   * The glossary terms the chapter uses, as the glossary spells them. A test
   * checks that each is in the glossary and appears in the chapter's text.
   */
  terms?: readonly string[]
}
