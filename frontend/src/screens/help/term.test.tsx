import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { GLOSSARY_TERMS } from '../../copy/glossary'
import { markTerms } from './mark-terms'
import { withoutTermHelp } from './help.fixtures'
import { Term } from './term'

afterEach(cleanup)

const world = GLOSSARY_TERMS.find(({ term }) => term === 'World')!

describe('Term', () => {
  it('links the meaning to the word at all times and shows it on keyboard focus', async () => {
    const user = userEvent.setup()
    render(<Term term="World">worlds</Term>)
    const mark = screen.getByText('worlds')
    expect(mark).toHaveAttribute('tabindex', '0')
    expect(mark).toHaveAccessibleDescription(world.meaning)
    const meaning = screen.getByText(world.meaning, { ignore: '' })
    expect(meaning).not.toBeVisible()
    await user.tab()
    expect(mark).toHaveFocus()
    expect(meaning).toBeVisible()
  })

  it('hides the meaning on Escape pressed anywhere, not only on the word', async () => {
    const user = userEvent.setup()
    render(<Term term="World">world</Term>)
    await user.hover(screen.getByText('world'))
    const meaning = screen.getByText(world.meaning)
    expect(meaning).toBeVisible()
    await user.keyboard('{Escape}')
    expect(meaning).not.toBeVisible()
  })

  it('keeps the meaning shown while the pointer moves from the word onto it', async () => {
    const user = userEvent.setup()
    render(<Term term="World">world</Term>)
    await user.hover(screen.getByText('world'))
    const meaning = screen.getByText(world.meaning)
    await user.hover(meaning)
    expect(meaning).toBeVisible()
    await user.unhover(meaning)
    expect(meaning).not.toBeVisible()
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

  it('does not use up a term the glossary does not hold', () => {
    const used = new Set<string>()
    marked('A nonesuch.', ['Nonesuch'], used)
    expect(used.size).toBe(0)
  })

  it('keeps the text unchanged and remembers what it marked', () => {
    const used = new Set<string>()
    const { container } = render(
      <p>{markTerms('Each World is built.', ['World'], used)}</p>,
    )
    expect(withoutTermHelp(container.querySelector('p')!)).toHaveTextContent(
      'Each World is built.',
    )
    expect(used.has('World')).toBe(true)
    expect(marked('Another world.', ['World'], used)).toEqual([])
  })
})
