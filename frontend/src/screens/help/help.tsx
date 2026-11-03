/**
 * Help: written for a business reader at two reading levels. It has two
 * pages (D-110): the guide, one chapter at a time with the chapter list
 * beside it and links to the chapter before and after, and the questions and
 * answers, every benchmark question with its answer key. It is the one screen
 * that shows answer keys and hidden truths. The route's `section` picks the
 * chapter or the questions page (the ids of the first Help still work, and
 * none opens the first chapter), `story` marks a story and filters the
 * questions, `stratum` filters the questions and `level` picks the reading
 * level. Only the pages that need the question bank wait for it; none waits
 * for the settings.
 */

import { useEffect, useLayoutEffect, useRef } from 'react'

import { useRoute } from '../../app/router'
import { useLoad } from '../../app/use-load'
import { loadLatest } from '../../app/latest-run'
import { Screen } from '../screen'
import { loadBank, scoreState } from './bank'
import { Chapter } from './chapter'
import {
  CHAPTERS,
  PAGES,
  QUESTIONS_PAGE,
  SECTION_ALIASES,
  type ChapterId,
} from './chapters'
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
  // The page shown: the questions and answers, the chapter the route names, or the first chapter.
  const page: ChapterId =
    PAGES.find((candidate) => candidate.id === section)?.id ?? CHAPTERS[0].id
  const story = params.get('story')
  const target = page === 'stories' && story ? `story-${story}` : section
  const ready = bank.status !== 'loading' && latest.status !== 'loading'

  // Scroll once per target, after the bank and the newest run have drawn the stories and rows.
  // A chapter is a page of its own, so it opens at the top of the screen; only a story
  // within one is scrolled to, below the sticky bar by its scroll margin.
  const scrolled = useRef<string | null>(null)
  useEffect(() => {
    if (target === null || !ready || scrolled.current === target) return
    scrolled.current = target
    const element = target === page ? null : document.getElementById(target)
    if (element) element.scrollIntoView({ block: 'start' })
    else window.scrollTo({ top: 0, behavior: 'instant' })
  }, [target, page, ready])

  // A level changes how long the chapters are, so the chapter in view is put back where it was.
  // The chapter in view is the one at the reading line, where a chapter link puts a chapter's
  // top (its scroll margin, below the sticky bar), not the end of the one before it.
  const kept = useRef<{ id: string; top: number } | null>(null)
  const choose = (next: Level) => {
    const inView = PAGES.map(({ id }) => document.getElementById(id)).find(
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

  const href = (id: ChapterId) => helpHref(params, { section: id }, level)
  const onQuestions = page === QUESTIONS_PAGE.id
  const index = CHAPTERS.findIndex((chapter) => chapter.id === page)
  const before = index > 0 ? CHAPTERS[index - 1] : null
  const after =
    index >= 0 && index < CHAPTERS.length - 1 ? CHAPTERS[index + 1] : null
  const chapter = (
    <Chapter
      key={page}
      id={page}
      copy={CHAPTER_COPY[page]}
      load={NEEDS_BANK.includes(page) ? bank : undefined}
    />
  )

  return (
    <Screen destination="help">
      <div className="z-10 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-hairline bg-background md:sticky md:top-0">
        <nav aria-label="Help pages" className="flex gap-1">
          {(
            [
              ['Guide', onQuestions ? CHAPTERS[0].id : page, !onQuestions],
              [QUESTIONS_PAGE.nav, QUESTIONS_PAGE.id, onQuestions],
            ] as const
          ).map(([label, id, current]) => (
            <a
              key={label}
              href={href(id)}
              aria-current={current ? 'page' : undefined}
              className="-mb-px border-b border-transparent px-3 py-2 text-sm text-text-secondary hover:text-text-primary aria-[current=page]:border-text-primary aria-[current=page]:font-semibold aria-[current=page]:text-text-primary"
            >
              {label}
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
          story: page === 'stories' ? story : null,
          settings,
          recorded: recordedRun,
        }}
      >
        {onQuestions ? (
          chapter
        ) : (
          <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
            <nav
              aria-label="Help chapters"
              className="lg:sticky lg:top-16 lg:self-start"
            >
              <ol className="space-y-1">
                {CHAPTERS.map(({ id, title }) => (
                  <li key={id}>
                    <a
                      href={href(id)}
                      aria-current={page === id ? 'page' : undefined}
                      className="block rounded-chip px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-raised hover:text-text-primary aria-[current=page]:bg-surface-raised aria-[current=page]:font-semibold aria-[current=page]:text-text-primary"
                    >
                      {title}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
            <div className="min-w-0 space-y-4">
              {chapter}
              <nav
                aria-label="Chapter before and after"
                className="flex flex-wrap justify-between gap-3 text-sm"
              >
                {before ? (
                  <a
                    href={href(before.id)}
                    className="text-text-primary underline"
                  >
                    {`Previous: ${before.title}`}
                  </a>
                ) : (
                  <span />
                )}
                {after && (
                  <a
                    href={href(after.id)}
                    className="text-text-primary underline"
                  >
                    {`Next: ${after.title}`}
                  </a>
                )}
              </nav>
            </div>
          </div>
        )}
      </HelpDataContext.Provider>
    </Screen>
  )
}
