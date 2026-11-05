import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Blocks } from './blocks'
import { Chapter } from './chapter'
import { DIAGRAM_NAMES, type Block, type ChapterId } from './chapters'
import { CHAPTER_COPY } from './copy'
import { HelpDataContext, type HelpData } from './help-data'
import { withoutTermHelp } from './help.fixtures'
import { glossaryEntry } from '../../copy/glossary'

afterEach(cleanup)

const FIRST_SIX: readonly ChapterId[] = [
  'why',
  'company',
  'stories',
  'approaches',
  'evidence',
  'answer',
]

/** The prose of a list of blocks: paragraphs and list items, not tables, pictures or widgets. */
const prose = (blocks: readonly Block[]) =>
  blocks.filter((block) => typeof block === 'string' || !('kind' in block))
    .length

/** Settings now of 1500 tokens and a duplicate threshold of 0.9; the run recorded 2000 and 0.85. */
function helpData(
  level: HelpData['level'],
  recorded: Record<string, unknown> | null,
): HelpData {
  return {
    level,
    bank: { status: 'loading', retry: () => undefined },
    scores: 'none',
    story: null,
    settings: {
      status: 'ready',
      retry: () => undefined,
      data: {
        judge_configured: true,
        values: {
          context_budget_tokens: 1500,
          context: { dedupe_threshold: 0.9 },
        },
      },
    },
    recorded: { status: 'ready', retry: () => undefined, data: recorded },
  }
}

const RECORDED = {
  context_budget_tokens: 2000,
  context: { dedupe_threshold: 0.85 },
}

function showEvidence(
  level: HelpData['level'],
  recorded: Record<string, unknown> | null = RECORDED,
) {
  render(
    <HelpDataContext.Provider value={helpData(level, recorded)}>
      <Chapter id="evidence" copy={CHAPTER_COPY.evidence} />
    </HelpDataContext.Provider>,
  )
  return screen.getByRole('region', { name: '5. How evidence is chosen' })
}

/** Every piece of Plain body text: paragraphs, list items, key lines and steps, inside "More detail" too. */
const bodyTexts = (blocks: readonly Block[]): string[] =>
  blocks.flatMap((block): string[] => {
    if (typeof block === 'string') return [block]
    if (!('kind' in block)) return [...block]
    if (block.kind === 'key') return [block.text]
    if (block.kind === 'steps') return [...block.items]
    if (block.kind === 'more') return bodyTexts(block.blocks)
    return []
  })

/** Every word a reader can see in Plain blocks: body text, headings and "More detail" summaries. */
const plainWords = (blocks: readonly Block[]): string[] =>
  blocks.flatMap((block): string[] => {
    if (typeof block !== 'string' && 'kind' in block) {
      if (block.kind === 'heading') return [block.text]
      if (block.kind === 'more')
        return [block.summary, ...plainWords(block.blocks)]
    }
    return bodyTexts([block])
  })

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length

const isKind = (block: Block | undefined, kind: string) =>
  block !== undefined &&
  typeof block !== 'string' &&
  'kind' in block &&
  block.kind === kind

const WORLD = /\bworlds?\b/i

describe('chapters 1 to 3 read in short sections', () => {
  it('chapter 1 opens with the exam sentence, a key line and the picture of the test', () => {
    const [first, second, third] = CHAPTER_COPY.why.plain
    expect(first).toMatch(/^This is a test with an answer key, like an exam\./)
    expect(isKind(second, 'key')).toBe(true)
    expect(third).toEqual({ kind: 'diagram', name: 'test' })
  })

  it('chapter 2 says what a world is first, with a key line and the picture of a world', () => {
    const plain = CHAPTER_COPY.company.plain
    const headings = plain.flatMap((block, index) =>
      isKind(block, 'heading') ? [index] : [],
    )
    const [at, next] = headings
    expect(plain[at!]).toEqual({ kind: 'heading', text: 'What a world is' })
    // Nothing before the heading uses the word.
    expect(plainWords(plain.slice(0, at)).join(' ')).not.toMatch(WORLD)
    const section = plain.slice(at! + 1, next)
    expect(section[0]).toMatch(/^A world is /)
    expect(section.some((block) => isKind(block, 'key'))).toBe(true)
    expect(section).toContainEqual({ kind: 'diagram', name: 'world' })
  })

  it('no Plain text before chapter 2 uses the word world, nor the help of a term it marks', () => {
    const { plain, plainHint, terms = [] } = CHAPTER_COPY.why
    const own = [...plainWords(plain), plainHint ?? ''].join(' ')
    expect(own).not.toMatch(WORLD)
    for (const term of terms)
      expect(glossaryEntry(term)!.meaning, term).not.toMatch(WORLD)

    // What chapter 1 draws at Plain, its pictures included.
    render(
      <HelpDataContext.Provider value={helpData('plain', null)}>
        <Chapter id="why" copy={CHAPTER_COPY.why} />
      </HelpDataContext.Provider>,
    )
    const chapter = screen.getByRole('region', { name: '1. Why this exists' })
    expect(withoutTermHelp(chapter).textContent).not.toMatch(WORLD)
    for (const picture of within(chapter).getAllByRole('img'))
      expect(picture.getAttribute('aria-label')).not.toMatch(WORLD)
  })

  it('every Plain paragraph in chapters 1 to 3 is at most 60 words, and each chapter has headed sections', () => {
    for (const id of ['why', 'company', 'stories'] as const) {
      const { plain } = CHAPTER_COPY[id]
      for (const text of bodyTexts(plain))
        expect(wordCount(text), `${id}: ${text}`).toBeLessThanOrEqual(60)
      expect(
        plain.filter((block) => isKind(block, 'heading')).length,
        id,
      ).toBeGreaterThanOrEqual(2)
    }
  })

  it('keeps the longer detail of chapters 1 to 3 at Technical in headed sections', () => {
    for (const id of ['why', 'company', 'stories'] as const) {
      const { technical } = CHAPTER_COPY[id]
      expect(
        technical.filter((block) => isKind(block, 'heading')).length,
        id,
      ).toBeGreaterThanOrEqual(3)
    }
  })
})

/** The blocks that follow a heading, up to the next heading. */
const section = (blocks: readonly Block[], heading: string) => {
  const at = blocks.findIndex(
    (block) =>
      isKind(block, 'heading') && (block as { text: string }).text === heading,
  )
  expect(at, heading).toBeGreaterThanOrEqual(0)
  const rest = blocks.slice(at + 1)
  const next = rest.findIndex((block) => isKind(block, 'heading'))
  return next < 0 ? rest : rest.slice(0, next)
}

const sentences = (text: string) => text.match(/[.?!](?=\s|$)/g)?.length ?? 0

describe('chapters 4 to 6 read in short sections', () => {
  it('each opens with one sentence and a key line, keeps paragraphs to 60 words and has headed sections', () => {
    for (const id of ['approaches', 'evidence', 'answer'] as const) {
      const { plain } = CHAPTER_COPY[id]
      const [first, second] = plain
      expect(typeof first, id).toBe('string')
      expect(sentences(first as string), id).toBe(1)
      expect(isKind(second, 'key'), id).toBe(true)
      for (const text of bodyTexts(plain))
        expect(wordCount(text), `${id}: ${text}`).toBeLessThanOrEqual(60)
      expect(
        plain.filter((block) => isKind(block, 'heading')).length,
        id,
      ).toBeGreaterThanOrEqual(2)
    }
  })

  it('chapter 4 gives each approach a heading, a one-line lead and its picture', () => {
    const { plain } = CHAPTER_COPY.approaches
    for (const [heading, name] of [
      ['What A does', 'approachA'],
      ['What B adds', 'approachB'],
      ['What C adds', 'approachC'],
    ] as const) {
      const part = section(plain, heading)
      expect(typeof part[0], heading).toBe('string')
      expect(part, heading).toContainEqual({ kind: 'diagram', name })
    }
  })

  it('chapter 5 introduces evidence found with its picture', () => {
    const part = section(CHAPTER_COPY.evidence.plain, 'Evidence found')
    expect(part).toContainEqual({ kind: 'diagram', name: 'found' })
  })

  it('chapter 6 is under half its old length, shows how an answer is marked and lists the judges limits', () => {
    const { plain } = CHAPTER_COPY.answer
    expect(wordCount(plainWords(plain).join(' '))).toBeLessThan(407)
    expect(plain.slice(0, 4)).toContainEqual({
      kind: 'diagram',
      name: 'marking',
    })
    const limits = section(plain, "The judges' limits")
    expect(limits.some((block) => Array.isArray(block))).toBe(true)
    // The official agreement figures stay.
    const text = bodyTexts(plain).join(' ')
    for (const figure of [
      '88 percent of the 637',
      '70 percent of the 263',
      '99 answers',
      '90 percent',
      '2026-10-29',
    ])
      expect(text).toContain(figure)
  })
})

describe('chapters 1 to 6', () => {
  it('every chapter 1-6 has plain and technical blocks', () => {
    for (const id of FIRST_SIX) {
      expect(prose(CHAPTER_COPY[id].plain), `${id} plain`).toBeGreaterThan(0)
      expect(
        prose(CHAPTER_COPY[id].technical),
        `${id} technical`,
      ).toBeGreaterThan(0)
    }
  })

  it('chapter 5 prose takes the budget and the duplicate threshold from settings', () => {
    const plain = within(showEvidence('plain'))
      .getAllByText(/./, { selector: 'p, li' })
      .map((node) => node.textContent!)
      .join(' ')
    expect(plain).toContain('a budget of 1,500 tokens')
    expect(plain).toContain('There is no other limit on the number of pieces')
    // The current settings win over the run's, and no budget is typed in.
    expect(plain).not.toMatch(/\b(?:2000|2,000)\b/)
    cleanup()

    // The technical detail states the same settings from the settings.
    const technical = showEvidence('technical', null)
    const detail = within(technical)
      .getByRole('heading', { name: 'Technical detail' })
      .closest('div')!
    const sentences = within(detail)
      .getAllByText(/./, { selector: 'p, li' })
      .map((node) => node.textContent!)
      .join(' ')
    expect(sentences).toContain('until the 1,500-token budget is full')
    expect(sentences).toContain('a Jaccard index of 0.9 or more')
  })

  it('every diagram has a text alternative', () => {
    for (const name of DIAGRAM_NAMES) {
      render(
        <HelpDataContext.Provider value={helpData('plain', null)}>
          <Blocks blocks={[{ kind: 'diagram', name }]} />
        </HelpDataContext.Provider>,
      )
      const picture = screen.getByRole('img')
      expect(picture.getAttribute('aria-label')!.length, name).toBeGreaterThan(
        40,
      )
      cleanup()
    }
  })

  it('draws the evidence diagram from the settings, and says so when they are not known', () => {
    render(
      <HelpDataContext.Provider value={helpData('plain', null)}>
        <Blocks blocks={[{ kind: 'diagram', name: 'evidence' }]} />
      </HelpDataContext.Provider>,
    )
    const label = screen.getByRole('img').getAttribute('aria-label')!
    expect(label).toContain('one budget of 1,500 tokens')
    expect(label).toContain('no limit on the number of pieces')
    expect(label).toContain('a passage or record text first')
    // The row captions name record texts, as the prose does.
    const picture = screen.getByRole('img')
    expect(picture).toHaveTextContent('Passages and record texts, in order')
    expect(picture).toHaveTextContent('One from each list, in turn')
    expect(label).not.toMatch(/\b(?:12|2000|2,000)\b/)
    cleanup()

    const loading: HelpData = {
      ...helpData('plain', RECORDED),
      settings: { status: 'loading', retry: () => undefined },
    }
    render(
      <HelpDataContext.Provider value={loading}>
        <Blocks blocks={[{ kind: 'diagram', name: 'evidence' }]} />
      </HelpDataContext.Provider>,
    )
    const loadingLabel = screen.getByRole('img').getAttribute('aria-label')!
    expect(loadingLabel).toMatch(/settings it quotes are loading/)
    expect(loadingLabel).not.toMatch(/not available|\b(?:10|12|1,500|2,000)\b/)
    cleanup()

    const failed: HelpData = {
      ...helpData('plain', null),
      settings: {
        status: 'error',
        error: new Error('down'),
        retry: () => undefined,
      },
    }
    render(
      <HelpDataContext.Provider value={failed}>
        <Blocks blocks={[{ kind: 'diagram', name: 'evidence' }]} />
      </HelpDataContext.Provider>,
    )
    expect(screen.getByRole('img').getAttribute('aria-label')).toMatch(
      /not available/,
    )
  })

  it('names each approach diagram with its letter and plain name', () => {
    render(
      <HelpDataContext.Provider value={helpData('plain', null)}>
        <Blocks blocks={CHAPTER_COPY.approaches.plain} />
      </HelpDataContext.Provider>,
    )
    expect(
      screen
        .getAllByRole('figure')
        .map((figure) => within(figure).getByText(/^[ABC] · /).textContent),
    ).toEqual(['A · Text search', 'B · Graph', 'C · Graph + Ontology'])
  })

  it('names the path line as the one way a piece is shown differently', () => {
    const plain = CHAPTER_COPY.approaches.plain
      .filter((block) => typeof block === 'string')
      .join(' ')
    expect(plain).toContain(
      'and so is how a piece of evidence is shown. The one exception is a line that says how the graph reached a record (chapter 6)',
    )
  })
})
