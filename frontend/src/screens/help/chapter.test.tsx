import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Chapter } from './chapter'
import type { ChapterCopy } from './chapters'
import { HelpDataContext, type HelpData } from './help-data'

afterEach(cleanup)

const copy: ChapterCopy = {
  plain: [
    'The model sees {context.evidence_slots} items.',
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
          context: { evidence_slots: 8 },
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
    expect(within(chapter).getByText('The model sees 8 items.')).toBeVisible()
    expect(within(chapter).getByText('10 candidates')).toBeVisible()
    expect(within(chapter).getByText('and not available here')).toBeVisible()
  })

  it('falls back to the newest official run for a setting not known now', () => {
    const chapter = show('technical', { context_budget_tokens: 1500 })
    expect(
      within(chapter).getByText('The budget is 1500 tokens.'),
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
    expect(within(technical).getByText('The model sees 8 items.')).toBeVisible()
  })
})
