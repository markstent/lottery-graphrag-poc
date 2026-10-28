import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Blocks } from './blocks'
import { Chapter } from './chapter'
import { DIAGRAM_NAMES, type Block, type ChapterId } from './chapters'
import { CHAPTER_COPY } from './copy'
import { HelpDataContext, type HelpData } from './help-data'

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
    // The current settings win over the run's, and no budget is typed in; 12 pieces is dated history.
    expect(plain).not.toMatch(/\b(?:2000|2,000)\b/)
    expect(plain).toMatch(
      /v0\.2\.0 used the old method: the answer model saw at most 12 pieces/,
    )
    cleanup()

    // The technical detail states the same settings from the settings, beside dated history.
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
    expect(sentences).toContain('the 12 places bound in all 1,350 prompts')
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
})
