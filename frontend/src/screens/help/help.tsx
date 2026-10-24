/**
 * Help: written for a business reader, in the order of spec 7.7. It is the
 * one screen that shows answer keys and hidden truths. The route's `section`
 * scrolls to a section, `story` marks a story and filters the questions, and
 * `stratum` filters the questions. Only the two sections that need the
 * question bank wait for it.
 */

import { useEffect, useRef } from 'react'

import { hrefFor, useRoute } from '../../app/router'
import { useLoad } from '../../app/use-load'
import { Screen } from '../screen'
import { Approaches } from './approaches'
import { loadBank } from './bank'
import { Data } from './data'
import { Glossary } from './glossary'
import { Questions } from './questions'
import { Running } from './running'
import { Scoring } from './scoring'
import { SECTIONS } from './sections'
import { Stories } from './stories'
import { What } from './what'

export function Help() {
  const { params } = useRoute()
  const bank = useLoad(loadBank, 'help-bank')
  const section = params.get('section')
  const story = params.get('story')
  const target = section === 'stories' && story ? `story-${story}` : section
  const ready = bank.status !== 'loading'

  // Scroll once per target, after the bank has drawn the stories and rows.
  const scrolled = useRef<string | null>(null)
  useEffect(() => {
    if (target === null || !ready || scrolled.current === target) return
    scrolled.current = target
    const element =
      document.getElementById(target) ??
      (section ? document.getElementById(section) : null)
    element?.scrollIntoView({ block: 'start' })
  }, [target, section, ready])

  return (
    <Screen destination="help">
      <nav
        aria-label="Help sections"
        className="flex flex-wrap gap-x-4 gap-y-1"
      >
        {SECTIONS.map(({ id, nav }) => (
          <a
            key={id}
            href={hrefFor('help', { section: id })}
            aria-current={section === id ? 'location' : undefined}
            className="text-sm text-text-secondary underline aria-[current=location]:font-semibold aria-[current=location]:text-text-primary"
          >
            {nav}
          </a>
        ))}
      </nav>
      <What />
      <Approaches />
      <Data />
      <Stories load={bank} story={section === 'stories' ? story : null} />
      <Questions load={bank} />
      <Scoring />
      <Glossary />
      <Running />
    </Screen>
  )
}
