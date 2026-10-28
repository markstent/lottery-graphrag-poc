/**
 * Help: written for a business reader at two reading levels, in the order of
 * the twelve chapters of the Help v2 design. It is the one screen that shows
 * answer keys and hidden truths. The route's `section` scrolls to a chapter
 * (the ids of the first Help still work), `story` marks a story and filters
 * the questions, `stratum` filters the questions and `level` picks the
 * reading level. Only the two chapters that need the question bank wait for
 * it; no chapter waits for the settings.
 */

import { useEffect, useLayoutEffect, useRef } from 'react'

import { evidenceMetric, OLD_METHOD } from '../../app/method'
import { useRoute } from '../../app/router'
import { useLoad } from '../../app/use-load'
import { loadLatest } from '../../app/latest-run'
import { Screen } from '../screen'
import { loadBank, scoreState } from './bank'
import { Chapter } from './chapter'
import { CHAPTERS, SECTION_ALIASES } from './chapters'
import { CHAPTER_COPY } from './copy'
import { HelpDataContext } from './help-data'
import { helpHref, useLevel, type Level } from './level'
import { loadRecorded, useSettings } from './settings'

const LEVEL_NAMES: Record<Level, string> = {
  plain: 'Plain',
  technical: 'Technical',
}

function LevelSwitch({
  level,
  onChange,
}: {
  level: Level
  onChange: (level: Level) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Reading level"
      className="flex items-center gap-4 text-sm text-text-secondary"
    >
      <span aria-hidden="true">Reading level</span>
      {(Object.keys(LEVEL_NAMES) as Level[]).map((value) => (
        <label
          key={value}
          className="flex items-center gap-1.5 text-text-primary"
        >
          <input
            type="radio"
            name="help-level"
            value={value}
            checked={level === value}
            onChange={() => onChange(value)}
          />
          {LEVEL_NAMES[value]}
        </label>
      ))}
    </div>
  )
}

/** The chapters that read the question bank, and so show its loading and error states. */
const NEEDS_BANK: readonly string[] = ['stories', 'questions']

export function Help() {
  const { params } = useRoute()
  const [level, setLevel] = useLevel()
  const bank = useLoad(loadBank, 'help-bank')
  const latest = useLoad(loadLatest, 'help-latest')
  const settings = useSettings()
  const recordedRun = useLoad(loadRecorded, 'help-recorded')
  const requested = params.get('section')
  const section = requested ? (SECTION_ALIASES[requested] ?? requested) : null
  const story = params.get('story')
  const target = section === 'stories' && story ? `story-${story}` : section
  const ready = bank.status !== 'loading' && latest.status !== 'loading'

  // Scroll once per target, after the bank and the newest run have drawn the stories and rows.
  const scrolled = useRef<string | null>(null)
  useEffect(() => {
    if (target === null || !ready || scrolled.current === target) return
    scrolled.current = target
    const element =
      document.getElementById(target) ??
      (section ? document.getElementById(section) : null)
    element?.scrollIntoView({ block: 'start' })
  }, [target, section, ready])

  // A level changes how long the chapters are, so the chapter in view is put back where it was.
  // The chapter in view is the one at the reading line, where a chapter link puts a chapter's
  // top (its scroll margin, below the sticky bar), not the end of the one before it.
  const kept = useRef<{ id: string; top: number } | null>(null)
  const choose = (next: Level) => {
    const inView = CHAPTERS.map(({ id }) => document.getElementById(id)).find(
      (element) =>
        element &&
        element.getBoundingClientRect().bottom >
          (parseFloat(getComputedStyle(element).scrollMarginTop) || 0) + 1,
    )
    kept.current = inView
      ? { id: inView.id, top: inView.getBoundingClientRect().top }
      : null
    setLevel(next)
  }
  useLayoutEffect(() => {
    const place = kept.current
    kept.current = null
    const element = place ? document.getElementById(place.id) : null
    if (place && element)
      window.scrollBy({
        top: element.getBoundingClientRect().top - place.top,
        behavior: 'instant',
      })
  }, [level])

  return (
    <Screen destination="help">
      <div className="z-10 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-hairline bg-background py-2 md:sticky md:top-0">
        <nav
          aria-label="Help sections"
          className="flex flex-wrap gap-x-4 gap-y-1"
        >
          {CHAPTERS.map(({ id, nav }) => (
            <a
              key={id}
              href={helpHref(params, { section: id }, level)}
              aria-current={section === id ? 'location' : undefined}
              className="text-sm text-text-secondary underline aria-[current=location]:font-semibold aria-[current=location]:text-text-primary"
            >
              {nav}
            </a>
          ))}
        </nav>
        <LevelSwitch level={level} onChange={choose} />
      </div>
      <HelpDataContext.Provider
        value={{
          level,
          bank,
          scores: scoreState(latest, bank),
          evidence: evidenceMetric(
            latest.status === 'ready' && latest.data
              ? latest.data.method_version
              : OLD_METHOD,
          ),
          story: section === 'stories' ? story : null,
          settings,
          recorded: recordedRun,
        }}
      >
        {CHAPTERS.map(({ id }) => (
          <Chapter
            key={id}
            id={id}
            copy={CHAPTER_COPY[id]}
            load={NEEDS_BANK.includes(id) ? bank : undefined}
          />
        ))}
      </HelpDataContext.Provider>
    </Screen>
  )
}
