import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SettingsProvider } from '../../app/settings'
import { GLOSSARY_TERMS } from '../../copy/glossary'
import { SECTION_ALIASES, CHAPTERS, PAGES } from './chapters'
import { Help } from './help'
import { BRING_UP, MODELS, RECOVERY } from './running-data'
import {
  QUICK_CHECK_NEWER,
  RECORDED_RUNS,
  OFFICIAL_STRATA,
  OFFICIAL_SUBSET,
  OFFICIAL,
  SCENARIOS,
  SCORED,
  SMOKE,
  stubBank,
  UNSCORED,
  type BankStub,
  withoutTermHelp,
} from './help.fixtures'
import { PLAIN_STORIES } from './copy/stories'

/** A dataset code, such as INC_041, MKT_GR or PLAYER_GR_000165, or a scenario id. */
const DATASET_CODE = /\b[A-Z]{2,}_[A-Z0-9_]+\b|SCN-\d/

const CHAPTER_TITLES = [
  '1. Why this exists',
  '2. The made-up company',
  '3. The planted stories',
  '4. The three approaches',
  '5. How evidence is chosen',
  '6. The answer and the judge',
  '7. How scoring works',
  '8. Reading the results',
  '9. Assumptions and limits',
  '10. Glossary',
  '11. Running it',
  '12. What the results teach',
]

/** Names only Running it may use: its own commands and settings, and the vendors and models it names. */
const KNOWN_VENDOR_NAMES = [
  'Neo4j',
  'Qdrant',
  'Ollama',
  'Docker',
  'qwen',
  'bge-',
  'litellm',
  'localhost',
  '.env',
]
const RUNNING_ONLY = [
  ...BRING_UP.map(([command]) => command),
  ...RECOVERY.map(([, command]) => command),
  ...MODELS.flatMap(([, settings]) => settings.split(', ')),
  ...KNOWN_VENDOR_NAMES,
]

async function renderHelp(hash = '#/help', stub: BankStub = {}) {
  window.history.replaceState(null, '', `/${hash}`)
  stubBank(stub)
  const view = render(
    <SettingsProvider>
      <Help />
    </SettingsProvider>,
  )
  // Every page has the "Help pages" nav and its chapter's region; a page that reads the bank has drawn it once nothing is loading.
  await screen.findByRole('navigation', { name: 'Help pages' })
  await screen.findByRole('heading', { level: 2 })
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  return view
}

/** Opens the questions and answers page, which `renderHelp` leaves once its table is drawn. */
async function renderQuestions(query = '', stub: BankStub = {}) {
  const view = await renderHelp(`#/help?section=questions${query}`, stub)
  await screen.findByRole('table', { name: 'Benchmark questions' })
  return view
}

const questionTable = () =>
  screen.getByRole('table', { name: 'Benchmark questions' })

const section = (name: string) => screen.getByRole('region', { name })

const { scrollBy } = window

// jsdom has no scrollIntoView, which a page opened on a section calls.
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  window.localStorage.clear()
  window.history.replaceState(null, '', '/')
  window.scrollBy = scrollBy
})

describe('Help', () => {
  it('has the twelve chapters of the specification in order, one page each', async () => {
    await renderHelp()
    const nav = screen.getByRole('navigation', { name: 'Help chapters' })
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(CHAPTER_TITLES)
    expect(
      screen
        .getAllByRole('heading', { level: 2 })
        .map((heading) => heading.textContent),
    ).toEqual([CHAPTER_TITLES[0]])
  })

  it('opens with the purpose sentence and links to the guide and to the questions and answers', async () => {
    await renderHelp()
    const nav = screen.getByRole('navigation', { name: 'Help pages' })
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => [link.textContent, link.getAttribute('href')]),
    ).toEqual([
      ['Guide', '#/help?section=why'],
      ['Questions and answers', '#/help?section=questions'],
    ])
    expect(withoutTermHelp(section('1. Why this exists'))).toHaveTextContent(
      /official run started on 2026-10-29/,
    )
  })

  it('with no section opens chapter 1, marked as the current chapter and the Guide as the current page', async () => {
    await renderHelp()
    const pages = screen.getByRole('navigation', { name: 'Help pages' })
    expect(within(pages).getByRole('link', { name: 'Guide' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(
      within(pages).getByRole('link', { name: 'Questions and answers' }),
    ).not.toHaveAttribute('aria-current')
    const chapters = screen.getByRole('navigation', { name: 'Help chapters' })
    expect(
      within(chapters)
        .getAllByRole('link')
        .filter((link) => link.getAttribute('aria-current') === 'page')
        .map((link) => link.textContent),
    ).toEqual(['1. Why this exists'])
    expect(
      screen.queryByRole('table', { name: 'Benchmark questions' }),
    ).toBeNull()
  })

  it('links to the chapter before and after, none before the first and none after the last', async () => {
    const around = () =>
      screen.getByRole('navigation', { name: 'Chapter before and after' })
    await renderHelp()
    expect(within(around()).queryByText(/^Previous:/)).toBeNull()
    expect(
      within(around()).getByRole('link', {
        name: 'Next: 2. The made-up company',
      }),
    ).toHaveAttribute('href', '#/help?section=company')
    cleanup()

    await renderHelp('#/help?section=scoring')
    expect(
      within(around()).getByRole('link', {
        name: 'Previous: 6. The answer and the judge',
      }),
    ).toHaveAttribute('href', '#/help?section=answer')
    expect(
      within(around()).getByRole('link', {
        name: 'Next: 8. Reading the results',
      }),
    ).toHaveAttribute('href', '#/help?section=results')
    cleanup()

    await renderHelp('#/help?section=lessons&level=technical')
    expect(
      within(around()).getByRole('link', {
        name: 'Previous: 11. Running it',
      }),
    ).toHaveAttribute('href', '#/help?section=running&level=technical')
    expect(within(around()).queryByText(/^Next:/)).toBeNull()
  })

  it('opens the questions and answers on its own, with no chapter list', async () => {
    await renderHelp('#/help?section=questions')
    await screen.findByRole('table', { name: 'Benchmark questions' })
    expect(
      screen.queryByRole('navigation', { name: 'Help chapters' }),
    ).toBeNull()
    expect(
      screen.queryByRole('navigation', { name: 'Chapter before and after' }),
    ).toBeNull()
    const pages = screen.getByRole('navigation', { name: 'Help pages' })
    expect(
      within(pages).getByRole('link', { name: 'Questions and answers' }),
    ).toHaveAttribute('aria-current', 'page')
    expect(
      within(pages).getByRole('link', { name: 'Guide' }),
    ).not.toHaveAttribute('aria-current')
    expect(
      screen
        .getAllByRole('heading', { level: 2 })
        .map((heading) => heading.textContent),
    ).toEqual(['Questions and answers'])
  })

  it('goes from the questions and answers back to chapter 1 by the Guide link', async () => {
    const user = userEvent.setup()
    await renderHelp('#/help?section=questions')
    await user.click(
      within(screen.getByRole('navigation', { name: 'Help pages' })).getByRole(
        'link',
        { name: 'Guide' },
      ),
    )
    await waitFor(() => expect(window.location.hash).toBe('#/help?section=why'))
  })

  it('an old section id opens the chapter it names', async () => {
    await renderHelp('#/help?section=what')
    expect(section('1. Why this exists')).toBeVisible()
    const chapters = screen.getByRole('navigation', { name: 'Help chapters' })
    expect(
      within(chapters).getByRole('link', { name: '1. Why this exists' }),
    ).toHaveAttribute('aria-current', 'page')
    cleanup()
    await renderHelp('#/help?section=data')
    expect(section('2. The made-up company')).toBeVisible()
  })

  it('states the official result in chapter 1 as it is, with its dates', async () => {
    await renderHelp()
    const why = section('1. Why this exists')
    expect(withoutTermHelp(why)).toHaveTextContent(
      /official run started on 2026-10-29/,
    )
    expect(withoutTermHelp(why)).toHaveTextContent(
      /We fixed 14 comparisons before the run\. One showed a clear difference/,
    )
    expect(withoutTermHelp(why)).toHaveTextContent(
      /text search \(A\) got 42 of every 100 needed facts to the answer model, the graph \(B\) 45 and the graph with the ontology \(C\) 57/,
    )
    // A newcomer meets the word world first in chapter 2, where it is explained.
    expect(withoutTermHelp(why)).toHaveTextContent(
      /six new copies of the made-up company/,
    )
    expect(withoutTermHelp(why)).not.toHaveTextContent(/\bworlds?\b/i)
    expect(withoutTermHelp(why)).not.toHaveTextContent(/v0\.2|old method/)
  })

  it('draws each approach as a picture named by its letter and plain name', async () => {
    await renderHelp('#/help?section=approaches')
    const figures = within(section('4. The three approaches')).getAllByRole(
      'figure',
    )
    expect(
      figures.map((figure) => figure.querySelector('figcaption')!.textContent),
    ).toEqual(['A · Text search', 'B · Graph', 'C · Graph + Ontology'])
    for (const figure of figures)
      expect(within(figure).getByRole('img')).toHaveAccessibleName(/one budget/)
  })

  it('links the data tour to the Data Model tabs', async () => {
    await renderHelp('#/help?section=company')
    const links = within(section('2. The made-up company')).getAllByRole('link')
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '#/data-model?tab=overview',
      '#/data-model?tab=tables',
      '#/data-model?tab=graph',
      '#/data-model?tab=concepts',
      '#/data-model?tab=stories',
    ])
  })
})

describe('the planted stories', () => {
  const withTruth = SCORED.filter((q) => q.hidden_truth !== null)
  const cardOf = (stories: HTMLElement, scenarioId: string) =>
    within(stories)
      .getByRole('heading', {
        name: SCENARIOS.find((s) => s.scenario_id === scenarioId)!.title,
      })
      .closest('article')!

  it('shows each hidden truth verbatim under its scenario title at Technical', async () => {
    await renderHelp('#/help?section=stories&level=technical')
    const stories = section('3. The planted stories')
    expect(withTruth).toHaveLength(8)
    for (const question of withTruth) {
      const card = cardOf(stories, question.scenario_id!)
      expect(within(card).getByText(question.hidden_truth!)).toBeVisible()
      expect(card).toHaveTextContent(question.scenario_id!)
      expect(card).toHaveTextContent(PLAIN_STORIES[question.scenario_id!]!)
    }
  })

  it('tells each story in plain words at Plain, with no dataset code and no hidden truth', async () => {
    await renderHelp('#/help?section=stories')
    const stories = section('3. The planted stories')
    for (const question of withTruth) {
      const card = cardOf(stories, question.scenario_id!)
      expect(card).toHaveTextContent(PLAIN_STORIES[question.scenario_id!]!)
      expect(card).not.toHaveTextContent(question.hidden_truth!)
      // The worked example's question names its incident by code, as data; the rest of every card names none.
      const own = card.cloneNode(true) as HTMLElement
      own.querySelectorAll('dd[data-api]').forEach((node) => node.remove())
      expect(own.textContent, question.scenario_id!).not.toMatch(DATASET_CODE)
    }
  })

  it('names in each plain story exactly the countries its hidden truth and answer key hold', () => {
    const COUNTRIES: Record<string, string> = {
      UK: 'United Kingdom',
      GR: 'Greece',
      AT: 'Austria',
      CZ: 'Czech Republic',
    }
    for (const question of withTruth) {
      const data = `${question.hidden_truth} ${question.expected_answer}`
      const codes = new Set(
        [...data.matchAll(/(?:^|[^A-Z])[A-Z]+_(UK|GR|AT|CZ)(?=_|\b)/g)].map(
          (match) => match[1]!,
        ),
      )
      const story = PLAIN_STORIES[question.scenario_id!]!
      const named = Object.keys(COUNTRIES).filter((code) =>
        story.includes(COUNTRIES[code]!),
      )
      expect(new Set(named), question.scenario_id!).toEqual(codes)
    }
  })

  it('says so when no question describes a story', async () => {
    await renderHelp('#/help?section=stories', {
      questions: SCORED.filter((q) => q.scenario_id !== 'SCN-010'),
    })
    const card = within(section('3. The planted stories'))
      .getByRole('heading', { name: 'Game mechanic affinity' })
      .closest('article')!
    expect(card).toHaveTextContent(
      "No question in the bank describes this story's hidden truth.",
    )
  })

  it('tells SCN-007 once, as the worked example, with its question and answer key', async () => {
    await renderHelp('#/help?section=stories')
    const l18 = SCORED.find((q) => q.scenario_id === 'SCN-007')!
    const worked = () => {
      const stories = section('3. The planted stories')
      expect(within(stories).getAllByText('Worked example')).toHaveLength(1)
      const card = within(stories)
        .getByText('Worked example')
        .closest('article')!
      expect(card).toHaveTextContent('Cross market platform incident')
      expect(within(card).getByText(l18.text)).toBeVisible()
      return card
    }
    // At Plain the answer key names the countries; the codes it holds are the bank's.
    expect(
      within(worked()).getByText(
        'Incidents on the same platform version as INC_042 were seen in Austria and the Czech Republic, and the United Kingdom was unaffected.',
      ),
    ).toBeVisible()
    expect(screen.queryByText(l18.hidden_truth!)).toBeNull()
    cleanup()

    await renderHelp('#/help?section=stories&level=technical')
    expect(within(worked()).getByText(l18.expected_answer)).toBeVisible()
    expect(screen.getAllByText(l18.hidden_truth!)).toHaveLength(1)
  })

  it('highlights and scrolls to the story named in the link', async () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    await renderHelp('#/help?section=stories&story=SCN-009')
    const card = within(section('3. The planted stories'))
      .getByRole('heading', { name: 'Payment provider degradation' })
      .closest('article')!
    expect(card).toHaveAttribute('aria-current', 'true')
    await waitFor(() => expect(scroll).toHaveBeenCalled())
    expect(scroll.mock.contexts.at(-1)).toBe(card)
  })

  it('opens a chapter at the top of the screen, and scrolls to a story named in the link', async () => {
    const scroll = vi.fn()
    const toTop = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    Element.prototype.scrollIntoView = scroll
    await renderHelp('#/help?section=glossary')
    await waitFor(() =>
      expect(toTop).toHaveBeenCalledWith({ top: 0, behavior: 'instant' }),
    )
    expect(scroll).not.toHaveBeenCalled()
    cleanup()

    await renderHelp('#/help?section=stories&story=SCN-007')
    await waitFor(() => expect(scroll).toHaveBeenCalled())
    expect((scroll.mock.contexts.at(-1) as HTMLElement).id).toBe(
      'story-SCN-007',
    )
    toTop.mockRestore()
  })
})

describe('the questions table', () => {
  const rows = () =>
    [...questionTable().querySelectorAll('tbody tr')].filter((row) =>
      row.querySelector('td'),
    ) as HTMLElement[]
  const groups = () => questionTable().querySelectorAll('tbody')

  it('groups instances under their question, with what it tests', async () => {
    await renderQuestions()
    expect(groups()).toHaveLength(22)
    expect(rows()).toHaveLength(SCORED.length)
    const first = SCORED[0]
    // Plain names no question id; Technical does.
    const head = () => groups()[0].querySelector('th')!
    expect(head()).toHaveTextContent(first.tests)
    expect(head()).not.toHaveTextContent(first.question_id)
    expect(rows()[0]).toHaveTextContent(first.text)
    expect(rows()[0]).toHaveTextContent(first.expected_answer)
    expect(questionTable().querySelectorAll('thead th')).toHaveLength(5)
    expect(screen.getByText('22 questions, 50 instances')).toBeVisible()
    cleanup()
    await renderQuestions('&level=technical')
    expect(head()).toHaveTextContent(`${first.question_id} · Single fact`)
  })

  it('writes market codes as countries at Plain and keeps the bank text at Technical', async () => {
    const l05 = SCORED.find((q) => /\bMKT_/.test(q.expected_answer))!
    await renderQuestions(`&stratum=${l05.stratum}`)
    const row = rows().find((r) => r.textContent!.includes(l05.text))!
    expect(row).not.toHaveTextContent(/\bMKT_/)
    expect(row).toHaveTextContent(
      /Czech Republic|Austria|Greece|United Kingdom/,
    )
    cleanup()
    await renderQuestions(`&stratum=${l05.stratum}&level=technical`)
    expect(
      rows().find((r) => r.textContent!.includes(l05.text)),
    ).toHaveTextContent(l05.expected_answer)
  })

  it('names the ontology-dependent kind in full', async () => {
    await renderQuestions()
    expect(
      within(
        screen.getByRole('combobox', { name: 'Kind of question' }),
      ).getByRole('option', { name: 'Ontology-dependent' }),
    ).toHaveValue('H2')
  })

  it('filters by kind of question and keeps the filter in the URL', async () => {
    const user = userEvent.setup()
    await renderQuestions()
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Kind of question' }),
      'H5',
    )
    expect(rows()).toHaveLength(8)
    expect(window.location.hash).toBe('#/help?section=questions&stratum=H5')
    expect(
      screen.getByText(
        'Showing 8 questions, 8 instances of 22 questions, 50 instances',
      ),
    ).toBeVisible()
  })

  it('filters by story, and the link from Data Model preselects it', async () => {
    await renderQuestions('&story=SCN-007')
    expect(screen.getByRole('combobox', { name: 'Story' })).toHaveValue(
      'SCN-007',
    )
    expect(rows()).toHaveLength(1)
    expect(rows()[0]).toHaveTextContent('INC_042')
  })

  it('keeps the kind filter on a story link in the table', async () => {
    await renderQuestions('&stratum=H5')
    expect(
      within(groups()[0]).getByRole('link', {
        name: 'App release conversion failure',
      }),
    ).toHaveAttribute('href', '#/help?section=stories&story=SCN-001&stratum=H5')
  })

  it('says so when no question matches both filters, and clears them', async () => {
    const user = userEvent.setup()
    await renderQuestions('&story=SCN-007&stratum=H1')
    expect(screen.getByText('No question matches these filters.')).toBeVisible()
    await user.click(screen.getByRole('link', { name: 'Clear the filters' }))
    await waitFor(() => expect(rows()).toHaveLength(SCORED.length))
  })

  it('ignores a story or kind that does not exist', async () => {
    await renderQuestions('&story=SCN-999&stratum=H9')
    expect(rows()).toHaveLength(SCORED.length)
  })

  /** The one multi-market instance the captured run scored, and its row among the H2 questions. */
  const L09 = 'L09-2026-GAME_AT_05'
  const l09Row = () =>
    rows()[
      SCORED.filter((q) => q.stratum === 'H2').findIndex(
        (q) => q.instance_id === L09,
      )
    ]

  it('shows each instance its own answer and evidence recall, worded as in Live Lab', async () => {
    await renderQuestions('&stratum=H2')
    const row = l09Row()
    // A: answer 0.4, recall 0.67; B and C: answer 0.5, recall 0.33.
    expect(within(row).getByText('Answer: Partly correct (40%)')).toBeVisible()
    expect(within(row).getByText('Evidence recall: 0.67')).toBeVisible()
    expect(
      within(row).getAllByText('Answer: Partly correct (50%)'),
    ).toHaveLength(2)
    expect(within(row).getAllByText('Evidence recall: 0.33')).toHaveLength(2)
  })

  it('shows Missing where the instance has no evidence recall, and says why', async () => {
    await renderQuestions('&stratum=H3')
    expect(
      within(rows()[0]).getAllByText('Evidence recall: Missing'),
    ).toHaveLength(3)
    expect(within(rows()[0]).getAllByText('Answer: Correct')).toHaveLength(3)
    cleanup()
    await renderHelp('#/help?section=scoring')
    expect(
      within(section('7. How scoring works')).getByText(/read Missing/),
    ).toBeVisible()
  })

  it('shows evidence recall, never F1', async () => {
    const questions = structuredClone(SCORED)
    for (const question of questions)
      for (const score of Object.values(question.scores ?? {}))
        if (score) score.evidence_f1 = 0.99
    await renderQuestions('&stratum=H2', { questions })
    expect(l09Row()).not.toHaveTextContent('0.99')
  })

  it('says the newest official run scored none of these questions, never that there is none', async () => {
    await renderQuestions('', {
      questions: UNSCORED,
      latest: OFFICIAL,
    })
    const questions = section('Questions and answers')
    expect(
      within(questions).getByText(
        /^The newest official run scored none of these world 2026 questions; its scores are on Results\./,
      ),
    ).toBeVisible()
    expect(within(questions).queryByText(/No official run yet/)).toBeNull()
  })

  it('hides the score columns when the newest official run scored none of these questions, and keeps the note and its link', async () => {
    await renderQuestions('', {
      questions: UNSCORED,
      latest: OFFICIAL,
    })
    const questions = section('Questions and answers')
    const table = within(questions).getByRole('table', {
      name: 'Benchmark questions',
    })
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Question', 'Answer key'])
    expect(
      within(questions).queryByText('Not scored by the newest official run'),
    ).toBeNull()
    const note = within(questions).getByText(
      /^The newest official run scored none of these world 2026 questions/,
    )
    expect(
      within(note).getByRole('link', { name: 'Go to Results' }),
    ).toHaveAttribute('href', '#/results')
  })

  it('hides the score columns when there is no official run', async () => {
    await renderQuestions('', {
      questions: UNSCORED,
      latest: null,
    })
    const table = within(section('Questions and answers')).getByRole('table', {
      name: 'Benchmark questions',
    })
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Question', 'Answer key'])
  })

  it('keeps the score columns when the newest official run scored these questions', async () => {
    await renderQuestions()
    const table = within(section('Questions and answers')).getByRole('table', {
      name: 'Benchmark questions',
    })
    expect(within(table).getAllByRole('columnheader')).toHaveLength(5)
  })

  it('says an instance was not part of the run when it has no scores', async () => {
    await renderQuestions()
    const unscored = SCORED.findIndex((q) => q.scores === null)
    expect(unscored).toBeGreaterThan(-1)
    expect(rows()[unscored]).toHaveTextContent('Not scored in this run')
  })

  it.each([
    ['no run at all', { questions: UNSCORED, latest: null }],
    ['a quick check as the newest run', { questions: UNSCORED, latest: SMOKE }],
    [
      'scores the newest run does not stand behind',
      { questions: SCORED, latest: SMOKE },
    ],
    [
      'an official run of part of the bank, limited in size',
      { questions: SCORED, latest: OFFICIAL_SUBSET },
    ],
    [
      'an official run of some kinds of question only',
      { questions: SCORED, latest: OFFICIAL_STRATA },
    ],
  ])(
    'says "No official run yet" once, above the table, for %s',
    async (_, stub) => {
      await renderQuestions('', stub)
      const questions = section('Questions and answers')
      expect(
        within(questions).getByText(
          /^No official run yet\. Scores appear after a full official run\./,
        ),
      ).toBeVisible()
      expect(
        within(questions).getByRole('link', { name: 'Go to Results' }),
      ).toHaveAttribute('href', '#/results')
      const table = questionTable()
      expect(table).not.toHaveTextContent(/Answer:|Evidence score/)
      // With nothing to score, the table has no score columns at all.
      expect(within(table).queryByText('No official run yet')).toBeNull()
      expect(
        within(table)
          .getAllByRole('columnheader')
          .map((cell) => cell.textContent),
      ).toEqual(['Question', 'Answer key'])
    },
  )

  it('still has the question text and answer keys with no official run', async () => {
    await renderQuestions('', { questions: UNSCORED, latest: null })
    expect(rows()[0]).toHaveTextContent(UNSCORED[0].expected_answer)
  })

  it('keeps the stories and questions when the newest run cannot be read, and hides scores', async () => {
    await renderQuestions('', {
      questions: SCORED,
      failLatest: true,
    })
    expect(
      screen.getByText(
        /The latest run could not be read, so scores are hidden\./,
      ),
    ).toBeVisible()
    expect(rows()).toHaveLength(SCORED.length)
    expect(questionTable()).not.toHaveTextContent(/Answer:|Evidence score/)
    cleanup()
    await renderHelp('#/help?section=stories', {
      questions: SCORED,
      failLatest: true,
    })
    expect(
      within(section('3. The planted stories')).getAllByRole('article'),
    ).toHaveLength(SCENARIOS.length)
  })
})

describe('states', () => {
  const open = (hash: string) => {
    window.history.replaceState(null, '', `/${hash}`)
    render(
      <SettingsProvider>
        <Help />
      </SettingsProvider>,
    )
  }

  it('keeps the chapters that need no data when the bank fails to load', async () => {
    stubBank({ failQuestions: true })
    open('#/help?section=scoring')
    expect(
      await screen.findByRole('region', { name: '7. How scoring works' }),
    ).toBeVisible()
    expect(screen.queryByRole('alert')).toBeNull()
    cleanup()
    open('#/help?section=glossary')
    expect(
      await screen.findByRole('region', { name: '10. Glossary' }),
    ).toBeVisible()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText('The bank is unavailable.')).toBeNull()
  })

  it('shows the error in each page that needs the bank, with a retry', async () => {
    for (const hash of ['#/help?section=stories', '#/help?section=questions']) {
      stubBank({ failQuestions: true })
      open(hash)
      expect(
        (await screen.findAllByRole('alert')).length,
        hash,
      ).toBeGreaterThan(0)
      expect(screen.getAllByText('The bank is unavailable.').length, hash).toBe(
        1,
      )
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
      cleanup()
    }
  })

  it('shows a loading state in each page that needs the bank, and not in the others', async () => {
    vi.stubGlobal('fetch', () => new Promise(() => undefined))
    for (const hash of ['#/help?section=stories', '#/help?section=questions']) {
      open(hash)
      expect(screen.getAllByRole('status'), hash).toHaveLength(1)
      cleanup()
    }
    open('#/help?section=scoring')
    expect(screen.queryByRole('status')).toBeNull()
    expect(section('7. How scoring works')).toBeVisible()
  })
})

/** Matches a paragraph or list item by its whole text, which a marked glossary term splits across elements. */
const textOfElement =
  (pattern: RegExp) => (_: string, element: Element | null) =>
    element !== null &&
    ['P', 'LI'].includes(element.tagName) &&
    pattern.test(withoutTermHelp(element).textContent ?? '')

describe('scoring and glossary', () => {
  it('defines the evidence score on the scale Overview uses', async () => {
    await renderHelp('#/help?section=scoring')
    expect(
      within(section('7. How scoring works')).getByText(
        textOfElement(
          /Evidence recall is the share of the claims that the chosen evidence covers, from 0 to 1/,
        ),
      ),
    ).toBeVisible()
  })

  it('shows every glossary term with its plain meaning', async () => {
    await renderHelp('#/help?section=glossary')
    const glossary = section('10. Glossary')
    expect(within(glossary).getAllByRole('term')).toHaveLength(
      GLOSSARY_TERMS.length,
    )
    expect(within(glossary).getAllByRole('definition')).toHaveLength(
      GLOSSARY_TERMS.length,
    )
  })
})

describe('one name for the record a question names', () => {
  it('calls it the starting record in scoring and the glossary, and never an anchor', async () => {
    await renderHelp('#/help?section=scoring')
    const scoring = within(section('7. How scoring works'))
    expect(
      scoring.getByText(
        textOfElement(/The starting record \(the record the question names\)/),
      ),
    ).toBeVisible()
    cleanup()
    await renderHelp('#/help?section=glossary')
    const glossary = section('10. Glossary')
    const meaning = (term: string) =>
      within(glossary).getByText(term).nextElementSibling!.textContent
    expect(meaning('Starting record')).toMatch(
      /^The record the question names\. The evidence score leaves it out, because the approach was given it\./,
    )
    expect(meaning('Starting record')).toContain('Not the graph')
    expect(meaning('Starting point')).toContain('Where the graph walk begins')
    expect(meaning('Starting point')).toContain('Not the starting record')
    // No page of Help uses the old word.
    for (const { id } of PAGES) {
      cleanup()
      const { container } = await renderHelp(`#/help?section=${id}`)
      const rest = container.cloneNode(true) as HTMLElement
      rest.querySelectorAll('[data-api]').forEach((node) => node.remove())
      expect(rest.textContent, id).not.toMatch(/\banchor/i)
    }
  })
})

describe('Running it and the vendor names', () => {
  it('names vendors and engineering commands in Running it at Technical, and nowhere at Plain', async () => {
    // Every page but Running it, read at Plain, names none of them and has no code.
    for (const { id } of PAGES.filter((page) => page.id !== 'running')) {
      const { container } = await renderHelp(`#/help?section=${id}`)
      for (const name of RUNNING_ONLY)
        expect(
          container.textContent!.toLowerCase(),
          `${id} ${name}`,
        ).not.toContain(name.toLowerCase())
      expect(container.querySelectorAll('code'), id).toHaveLength(0)
      cleanup()
    }
    const { container } = await renderHelp('#/help?section=running')
    for (const name of RUNNING_ONLY)
      expect(container.textContent!.toLowerCase(), name).not.toContain(
        name.toLowerCase(),
      )
    expect(container.querySelectorAll('code')).toHaveLength(0)
    expect(section('11. Running it')).toHaveTextContent(/operators/)
    cleanup()

    await renderHelp('#/help?section=running&level=technical')
    const running = section('11. Running it')
    for (const name of RUNNING_ONLY)
      expect(running.textContent, name).toContain(name)
  })

  it('gives a real remedy for a model the server does not list', async () => {
    await renderHelp('#/help?section=running&level=technical')
    const table = within(section('11. Running it')).getByRole('table', {
      name: 'Recovery',
    })
    expect(within(table).getByText('ollama pull <model>')).toBeVisible()
  })

  it('has a recovery table with the graph ingest command and the world note', async () => {
    await renderHelp('#/help?section=running&level=technical')
    const table = within(section('11. Running it')).getByRole('table', {
      name: 'Recovery',
    })
    expect(within(table).getByText('make ingest-graph')).toBeVisible()
    expect(table).toHaveTextContent(/graph must hold the presentation world/i)
  })

  it('gives commands that exist in the Makefile', async () => {
    const makefile = readFileSync(resolve(process.cwd(), '../Makefile'), 'utf8')
    await renderHelp('#/help?section=running&level=technical')
    const targets = [
      ...within(section('11. Running it')).getAllByText(/^make [a-z-]+$/),
    ].map((element) => element.textContent!.slice('make '.length))
    expect(targets.length).toBeGreaterThan(20)
    for (const target of targets)
      expect(makefile).toMatch(new RegExp(`^${target}:`, 'm'))
  })
})

describe('reading levels', () => {
  const radio = (name: string) => screen.getByRole('radio', { name })
  const detail = () =>
    screen.queryAllByRole('heading', { name: 'Technical detail' })

  it('level defaults to plain', async () => {
    await renderHelp()
    expect(radio('Plain')).toBeChecked()
    expect(radio('Technical')).not.toBeChecked()
  })

  it('?level=technical opens at technical', async () => {
    await renderHelp('#/help?level=technical')
    expect(radio('Technical')).toBeChecked()
    expect(detail().length).toBeGreaterThan(0)
  })

  it('shows the plain text before the technical detail at technical', async () => {
    await renderHelp('#/help?section=running&level=technical')
    const running = section('11. Running it')
    const plain = within(running).getByText(/is for operators/)
    const heading = within(running).getByRole('heading', {
      name: 'Technical detail',
    })
    expect(
      plain.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    cleanup()
    await renderHelp('#/help?level=technical')
    expect(
      within(section('1. Why this exists')).getAllByRole('paragraph').length,
    ).toBeGreaterThan(0)
  })

  it('the switch changes the level and keeps the chapter in view', async () => {
    const user = userEvent.setup()
    await renderHelp('#/help?section=scoring')
    const chapter = document.getElementById('scoring')!
    // The chapter sits 120px from the top before the switch and 480px after the longer text above it.
    const top = () =>
      window.location.hash.includes('level=technical') ? 480 : 120
    vi.spyOn(chapter, 'getBoundingClientRect').mockImplementation(
      () => ({ top: top(), bottom: top() + 300 }) as DOMRect,
    )
    // Only the chapter shown is in the page.
    for (const other of CHAPTERS.filter((c) => c.id !== 'scoring'))
      expect(document.getElementById(other.id), other.id).toBeNull()
    const scrolled = vi.fn()
    window.scrollBy = scrolled
    await user.click(radio('Technical'))
    await waitFor(() => expect(radio('Technical')).toBeChecked())
    await waitFor(() => expect(scrolled).toHaveBeenCalled())
    expect(scrolled.mock.calls.at(-1)![0]).toMatchObject({ top: 360 })
    expect(window.location.hash).toBe('#/help?section=scoring&level=technical')
  })

  it('storage that throws falls back to plain', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const user = userEvent.setup()
    await renderHelp()
    expect(radio('Plain')).toBeChecked()
    await user.click(radio('Technical'))
    await waitFor(() => expect(radio('Technical')).toBeChecked())
  })

  it('remembers the level in storage and the URL wins over it', async () => {
    window.localStorage.setItem('help-level', 'technical')
    await renderHelp()
    expect(radio('Technical')).toBeChecked()
    cleanup()
    await renderHelp('#/help?level=plain')
    expect(radio('Plain')).toBeChecked()
  })

  it('a deep link opens at Plain whatever storage holds, a bare Help uses storage, and ?level wins', async () => {
    window.localStorage.setItem('help-level', 'technical')
    for (const link of [
      '#/help?section=scoring',
      '#/help?story=SCN-007',
      '#/help?stratum=H5',
    ]) {
      await renderHelp(link)
      expect(radio('Plain'), link).toBeChecked()
      cleanup()
    }
    await renderHelp('#/help')
    expect(radio('Technical')).toBeChecked()
    cleanup()
    await renderHelp('#/help?section=scoring&level=technical')
    expect(radio('Technical')).toBeChecked()
  })

  it('keeps a level that came from storage through a chapter link, a filter and a story link', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem('help-level', 'technical')
    await renderHelp('#/help')
    const nav = screen.getByRole('navigation', { name: 'Help pages' })
    const link = within(nav).getByRole('link', {
      name: 'Questions and answers',
    })
    expect(link).toHaveAttribute(
      'href',
      '#/help?section=questions&level=technical',
    )
    await user.click(link)
    await waitFor(() => expect(radio('Technical')).toBeChecked())
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Kind of question' }),
      'H5',
    )
    await waitFor(() =>
      expect(window.location.hash).toContain('level=technical'),
    )
    expect(radio('Technical')).toBeChecked()
    const story = within(questionTable()).getAllByRole('link', {
      name: 'App release conversion failure',
    })[0]
    expect(story.getAttribute('href')).toContain('level=technical')
    await user.click(story)
    await waitFor(() => expect(window.location.hash).toContain('story=SCN-001'))
    expect(radio('Technical')).toBeChecked()
  })

  it('presentation mode ignores storage but honours ?level', async () => {
    window.localStorage.setItem('help-level', 'technical')
    await renderHelp('?present=1#/help')
    expect(radio('Plain')).toBeChecked()
    cleanup()
    await renderHelp('?present=1#/help?level=technical')
    expect(radio('Technical')).toBeChecked()
  })

  it('points to Technical at Plain only, and not once Technical is chosen', async () => {
    await renderHelp('#/help?section=running')
    expect(section('11. Running it')).toHaveTextContent(/Choose Technical/)
    cleanup()
    await renderHelp('#/help?section=running&level=technical')
    expect(section('11. Running it')).not.toHaveTextContent(/Choose Technical/)
    expect(document.body).not.toHaveTextContent(/Choose Technical/)
  })

  it('the switch is a labelled radio group operable by keyboard', async () => {
    const user = userEvent.setup()
    await renderHelp()
    const group = screen.getByRole('radiogroup', { name: 'Reading level' })
    expect(within(group).getAllByRole('radio')).toHaveLength(2)
    radio('Plain').focus()
    await user.keyboard('{ArrowRight}')
    await waitFor(() => expect(radio('Technical')).toBeChecked())
    expect(radio('Technical')).toHaveFocus()
  })

  it('keeps the level in the links and filters of Help when the URL names it', async () => {
    const user = userEvent.setup()
    await renderHelp('#/help?section=questions&level=technical')
    const nav = screen.getByRole('navigation', { name: 'Help pages' })
    expect(
      within(nav).getByRole('link', { name: 'Questions and answers' }),
    ).toHaveAttribute('href', '#/help?section=questions&level=technical')
    expect(within(nav).getByRole('link', { name: 'Guide' })).toHaveAttribute(
      'href',
      '#/help?section=why&level=technical',
    )
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Kind of question' }),
      'H5',
    )
    expect(window.location.hash).toBe(
      '#/help?section=questions&stratum=H5&level=technical',
    )
  })
})

describe('section links', () => {
  it('every old section id lands on its chapter', async () => {
    const toTop = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    for (const [old, chapter] of Object.entries(SECTION_ALIASES)) {
      toTop.mockClear()
      await renderHelp(`#/help?section=${old}`)
      // It opens at the top, as any chapter does.
      await waitFor(() => expect(toTop).toHaveBeenCalled())
      // The page shows that chapter alone.
      expect(
        screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent),
      ).toEqual([PAGES.find((page) => page.id === chapter)!.title])
      cleanup()
    }
    toTop.mockRestore()
    expect(SECTION_ALIASES.what).toBe('why')
    expect(SECTION_ALIASES.data).toBe('company')
  })

  it('?story= still marks the story and filters the questions', async () => {
    await renderHelp('#/help?section=stories&story=SCN-007&level=technical')
    const card = within(section('3. The planted stories'))
      .getByRole('heading', { name: 'Cross market platform incident' })
      .closest('article')!
    expect(card).toHaveAttribute('aria-current', 'true')
    cleanup()
    await renderQuestions('&story=SCN-007&level=technical')
    expect(screen.getByRole('combobox', { name: 'Story' })).toHaveValue(
      'SCN-007',
    )
  })
})

describe('settings in Help', () => {
  // The table in Running it; chapters 4 to 6 have tables of their own.
  const settingsRow = (key: string) =>
    within(section('11. Running it')).getByRole('row', {
      name: new RegExp(`^${key}\\b`),
    })

  it('shows the setting now beside the newest official run, and marks a difference', async () => {
    await renderHelp('#/help?section=running&level=technical', {
      ...RECORDED_RUNS,
    })
    const row = settingsRow('generation_model')
    await within(row).findByText('model-now')
    expect(within(row).getByText('model-then')).toBeVisible()
    expect(within(row).getByText('Differs')).toBeVisible()
    const same = settingsRow('top_k')
    expect(within(same).getAllByText('20')).toHaveLength(2)
    expect(within(same).queryByText('Differs')).toBeNull()
  })

  it('reads a nested setting by its dotted name', async () => {
    await renderHelp('#/help?section=running&level=technical', {
      ...RECORDED_RUNS,
    })
    const row = settingsRow('context.dedupe_threshold')
    expect(await within(row).findAllByText('0.85')).toHaveLength(2)
  })

  it('a setting the run did not record reads Not recorded', async () => {
    await renderHelp('#/help?section=running&level=technical', {
      ...RECORDED_RUNS,
    })
    const row = settingsRow('max_tokens')
    await within(row).findByText('1,024')
    expect(within(row).getByText('Not recorded')).toBeVisible()
    expect(within(row).queryByText('Differs')).toBeNull()
  })

  it('a setting that differs from the run is marked different', async () => {
    await renderHelp('#/help?section=running&level=technical', {
      ...RECORDED_RUNS,
    })
    const row = settingsRow('context_budget_tokens')
    await within(row).findByText('2,000')
    expect(within(row).getByText('1,500')).toBeVisible()
    expect(within(row).getByText('Differs')).toBeVisible()
  })

  it('takes the recorded values from the newest official run, not from a newer quick check', async () => {
    await renderHelp('#/help?section=running&level=technical', {
      latest: SMOKE,
      ...QUICK_CHECK_NEWER,
    })
    const row = settingsRow('generation_model')
    await within(row).findByText('model-now')
    expect(within(row).getByText('model-then')).toBeVisible()
    expect(within(settingsRow('top_k')).queryByText('99')).toBeNull()
    expect(within(settingsRow('top_k')).getAllByText('20')).toHaveLength(2)
  })

  it('reads Not available, with a retry, when the recorded settings cannot be loaded', async () => {
    const user = userEvent.setup()
    await renderHelp('#/help?section=running&level=technical', {
      failRuns: true,
    })
    const row = settingsRow('top_k')
    await within(row).findByText('20')
    expect(within(row).getByText('Not available')).toBeVisible()
    expect(within(row).queryByText('Not recorded')).toBeNull()
    const retry = within(section('11. Running it')).getByRole('button', {
      name: 'Retry loading settings',
    })
    expect(retry).toBeVisible()
    stubBank({ ...RECORDED_RUNS })
    await user.click(retry)
    const generation = settingsRow('generation_model')
    await within(generation).findByText('model-then')
    expect(within(generation).queryByText('Not available')).toBeNull()
    expect(screen.queryByText('The run list is unavailable.')).toBeNull()
  })

  it('shows both errors when neither load works', async () => {
    await renderHelp('#/help?section=running&level=technical', {
      failSettings: true,
      failRuns: true,
    })
    const running = section('11. Running it')
    expect(
      await within(running).findByText('The settings are invalid.'),
    ).toBeVisible()
    expect(
      within(running).getByText('The run list is unavailable.'),
    ).toBeVisible()
  })

  it('reads Not recorded for every setting when no run is official', async () => {
    await renderHelp('#/help?section=running&level=technical', {
      latest: SMOKE,
    })
    const row = settingsRow('top_k')
    await within(row).findByText('20')
    expect(within(row).getByText('Not recorded')).toBeVisible()
  })

  it('settings that fail to load show Not available with a retry and every chapter still renders', async () => {
    const user = userEvent.setup()
    await renderHelp('#/help?section=running&level=technical', {
      failSettings: true,
    })
    const running = section('11. Running it')
    expect(
      (await within(running).findAllByText('Not available')).length,
    ).toBeGreaterThan(0)
    // The other chapters are one link away, whatever the settings did.
    const chapters = screen.getByRole('navigation', { name: 'Help chapters' })
    expect(
      within(chapters)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(CHAPTER_TITLES)
    const fetchMock = vi.mocked(fetch)
    const before = fetchMock.mock.calls.length
    await user.click(
      within(running).getByRole('button', { name: 'Retry loading settings' }),
    )
    await waitFor(() =>
      expect(
        fetchMock.mock.calls
          .slice(before)
          .some(([url]) => String(url).endsWith('/api/v1/settings')),
      ).toBe(true),
    )
  })
})
