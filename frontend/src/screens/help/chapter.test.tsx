import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { Chapter } from './chapter'
import type { ChapterCopy } from './chapters'
import { withoutTermHelp } from './help.fixtures'
import { HelpDataContext, type HelpData } from './help-data'

afterEach(cleanup)

const copy: ChapterCopy = {
  plain: [
    'Duplicates from {context.dedupe_threshold}.',
    ['{top_k} candidates', 'and {missing_key} here'],
  ],
  technical: ['The budget is {context_budget_tokens} tokens.'],
}

function show(
  level: HelpData['level'],
  recorded: Record<string, unknown> | null,
) {
  const data: HelpData = {
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
          top_k: 10,
          context: { dedupe_threshold: 0.8 },
        },
      },
    },
    recorded: { status: 'ready', retry: () => undefined, data: recorded },
  }
  render(
    <HelpDataContext.Provider value={data}>
      <Chapter id="evidence" copy={copy} />
    </HelpDataContext.Provider>,
  )
  return screen.getByRole('region', { name: '5. How evidence is chosen' })
}

describe('Chapter', () => {
  it('fills each setting in a paragraph and a list item from the settings now', () => {
    const chapter = show('plain', null)
    expect(within(chapter).getByText('Duplicates from 0.8.')).toBeVisible()
    expect(within(chapter).getByText('10 candidates')).toBeVisible()
    expect(within(chapter).getByText('and not available here')).toBeVisible()
  })

  it('falls back to the newest official run for a setting not known now', () => {
    const chapter = show('technical', { context_budget_tokens: 1500 })
    expect(
      within(chapter).getByText('The budget is 1,500 tokens.'),
    ).toBeVisible()
  })

  it('shows the technical blocks only at the technical level, after the plain ones', () => {
    const plain = show('plain', null)
    expect(within(plain).queryByText('Technical detail')).toBeNull()
    cleanup()
    const technical = show('technical', null)
    expect(
      within(technical).getByRole('heading', { name: 'Technical detail' }),
    ).toBeVisible()
    expect(within(technical).getByText('Duplicates from 0.8.')).toBeVisible()
  })
})

function showCopy(chapterCopy: ChapterCopy) {
  const data: HelpData = {
    level: 'plain',
    bank: { status: 'loading', retry: () => undefined },
    scores: 'none',
    story: null,
    settings: { status: 'loading', retry: () => undefined },
    recorded: { status: 'ready', retry: () => undefined, data: null },
  }
  render(
    <HelpDataContext.Provider value={data}>
      <Chapter id="evidence" copy={chapterCopy} />
    </HelpDataContext.Provider>,
  )
  return screen.getByRole('region', { name: '5. How evidence is chosen' })
}

describe('Chapter blocks', () => {
  it('draws a key line as a box labelled "In one line"', () => {
    const chapter = showCopy({
      plain: [{ kind: 'key', text: 'A thing in a line.' }],
      technical: [],
    })
    expect(within(chapter).getByText('In one line:')).toBeVisible()
    expect(within(chapter).getByText('A thing in a line.')).toBeVisible()
  })

  it('draws steps as a numbered list', () => {
    const chapter = showCopy({
      plain: [{ kind: 'steps', items: ['First do this.', 'Then that.'] }],
      technical: [],
    })
    const list = within(chapter).getByRole('list')
    expect(list.tagName).toBe('OL')
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
  })

  it('draws more detail closed, opened from the keyboard, with a default summary', async () => {
    const user = userEvent.setup()
    const chapter = showCopy({
      plain: [{ kind: 'more', summary: '', blocks: ['Hidden body.'] }],
      technical: [],
    })
    const summary = within(chapter).getByText('More detail')
    expect(summary.closest('details')).not.toHaveAttribute('open')
    expect(within(chapter).getByText('Hidden body.')).not.toBeVisible()
    await user.tab()
    expect(summary).toHaveFocus()
    // A summary is opened by Enter in a browser; jsdom opens it on the click Enter makes.
    await user.click(summary)
    expect(within(chapter).getByText('Hidden body.')).toBeVisible()
  })

  it('uses the given summary of a more-detail block', () => {
    const chapter = showCopy({
      plain: [{ kind: 'more', summary: 'The maths', blocks: ['Body.'] }],
      technical: [],
    })
    expect(within(chapter).getByText('The maths')).toBeVisible()
  })

  it('marks a term at its first body occurrence only, not in another word or a heading', () => {
    const chapter = showCopy({
      plain: [
        { kind: 'heading', text: 'Every world' },
        'An otherworld is no world. Two worlds.',
        'Another world.',
      ],
      technical: [],
      terms: ['World'],
    })
    const marks = chapter.querySelectorAll('[tabindex="0"]')
    expect(marks).toHaveLength(1)
    expect(marks[0]).toHaveTextContent('world')
    expect(chapter.querySelector('h3 [tabindex]')).toBeNull()
    expect(
      withoutTermHelp(within(chapter).getByText(/An otherworld is no/)),
    ).toHaveTextContent('An otherworld is no world. Two worlds.')
  })

  const marksIn = (chapter: HTMLElement) =>
    [...chapter.querySelectorAll('[tabindex="0"]')].map(
      (node) => node.parentElement?.parentElement?.textContent ?? '',
    )
  const markedAt = (chapter: HTMLElement) =>
    [...chapter.querySelectorAll('[tabindex="0"]')].map(
      (node) => withoutTermHelp(node.closest('p, li, div')!).textContent,
    )

  it('marks terms in key and steps text and not twice across blocks', () => {
    const chapter = showCopy({
      plain: [
        { kind: 'key', text: 'A world is built.' },
        { kind: 'steps', items: ['Build a world.'] },
      ],
      technical: [],
      terms: ['World'],
    })
    expect(marksIn(chapter)).toHaveLength(1)
    expect(markedAt(chapter)).toEqual(['In one line: A world is built.'])
  })

  it('marks the visible use, not an earlier one inside a more block', () => {
    const chapter = showCopy({
      plain: [
        { kind: 'more', summary: '', blocks: ['Hidden world.'] },
        'Body world.',
      ],
      technical: [],
      terms: ['World'],
    })
    expect(markedAt(chapter)).toEqual(['Body world.'])
  })

  it('marks a term used only in more blocks once, in the first', () => {
    const chapter = showCopy({
      plain: [
        { kind: 'more', summary: '', blocks: ['First world.'] },
        { kind: 'more', summary: '', blocks: ['Second world.'] },
      ],
      technical: [],
      terms: ['World'],
    })
    expect(markedAt(chapter)).toEqual(['First world.'])
  })

  it('marks the later visible use at the technical level, not one in a more block', () => {
    const data: HelpData = {
      level: 'technical',
      bank: { status: 'loading', retry: () => undefined },
      scores: 'none',
      story: null,
      settings: { status: 'loading', retry: () => undefined },
      recorded: { status: 'ready', retry: () => undefined, data: null },
    }
    render(
      <HelpDataContext.Provider value={data}>
        <Chapter
          id="evidence"
          copy={{
            plain: [{ kind: 'more', summary: '', blocks: ['Hidden world.'] }],
            technical: ['Later world.'],
            terms: ['World'],
          }}
        />
      </HelpDataContext.Provider>,
    )
    const chapter = screen.getByRole('region', {
      name: '5. How evidence is chosen',
    })
    expect(markedAt(chapter)).toEqual(['Later world.'])
  })
})
