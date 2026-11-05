import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { GLOSSARY_TERMS } from '../../copy/glossary'
import { markTerms } from './mark-terms'
import { Term } from './term'

afterEach(cleanup)

const world = GLOSSARY_TERMS.find(({ term }) => term === 'World')!

describe('Term', () => {
  it('shows the glossary meaning on keyboard focus and announces it', async () => {
    const user = userEvent.setup()
    render(<Term term="World">worlds</Term>)
    const mark = screen.getByText('worlds')
    expect(mark).toHaveAttribute('tabindex', '0')
    expect(screen.queryByText(world.meaning)).toBeNull()
    await user.tab()
    expect(mark).toHaveFocus()
    expect(screen.getByText(world.meaning)).toBeVisible()
    expect(mark).toHaveAccessibleDescription(world.meaning)
    await user.keyboard('{Escape}')
    expect(screen.queryByText(world.meaning)).toBeNull()
  })

  it('shows the meaning on hover', async () => {
    const user = userEvent.setup()
    render(<Term term="World">world</Term>)
    await user.hover(screen.getByText('world'))
    expect(screen.getByText(world.meaning)).toBeVisible()
  })

  it('shows its words plain when the glossary does not hold the term', () => {
    render(<Term term="Nonesuch">words</Term>)
    expect(screen.getByText('words')).not.toHaveAttribute('tabindex')
  })
})

describe('markTerms', () => {
  const marked = (text: string, terms: string[], used = new Set<string>()) => {
    const { container } = render(<p>{markTerms(text, terms, used)}</p>)
    return [...container.querySelectorAll('[tabindex]')].map(
      (node) => node.textContent,
    )
  }

  it('marks the first whole-word occurrence only, plural included', () => {
    expect(marked('A world, then worlds.', ['World'])).toEqual(['world'])
  })

  it('does not mark inside another word', () => {
    expect(marked('An otherworld.', ['World'])).toEqual([])
  })

  it('keeps the text unchanged and remembers what it marked', () => {
    const used = new Set<string>()
    const { container } = render(
      <p>{markTerms('Each World is built.', ['World'], used)}</p>,
    )
    expect(container.querySelector('p')).toHaveTextContent(
      'Each World is built.',
    )
    expect(used.has('World')).toBe(true)
    expect(marked('Another world.', ['World'], used)).toEqual([])
  })
})
