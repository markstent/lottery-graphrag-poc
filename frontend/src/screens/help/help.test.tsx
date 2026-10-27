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
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SettingsProvider } from '../../app/settings'
import { GLOSSARY_TERMS } from '../../copy/glossary'
import { SECTION_ALIASES, CHAPTERS } from './chapters'
import { Help } from './help'
import { BRING_UP, MODELS, RECOVERY } from './running-data'
import {
  QUICK_CHECK_NEWER,
  RECORDED_RUNS,
  OFFICIAL_STRATA,
  OFFICIAL_SUBSET,
  SCENARIOS,
  SCORED,
  SMOKE,
  stubBank,
  UNSCORED,
  type BankStub,
} from './help.fixtures'

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
  '10. The questions',
  '11. Glossary',
  '12. Running it',
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
  await screen.findByRole('table', { name: 'Benchmark questions' })
  return view
}

const questionTable = () =>
  screen.getByRole('table', { name: 'Benchmark questions' })

const section = (name: string) => screen.getByRole('region', { name })

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Help', () => {
  it('has its twelve chapters in the order of the specification', async () => {
    await renderHelp()
    const headings = screen
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent)
    expect(headings).toEqual(CHAPTER_TITLES)
  })

  it('opens with the purpose sentence and links to each section', async () => {
    await renderHelp()
    const nav = screen.getByRole('navigation', { name: 'Help sections' })
    expect(within(nav).getAllByRole('link')).toHaveLength(12)
    expect(
      within(nav).getByRole('link', { name: 'The questions' }),
    ).toHaveAttribute('href', '#/help?section=questions')
  })

  it('states the official result in chapter 1 as it is, with its dates', async () => {
    await renderHelp()
    const why = section('1. Why this exists')
    expect(why).toHaveTextContent(
      /from 2026-10-26 to 2026-10-27, found no detectable difference/,
    )
    expect(why).toHaveTextContent(/0\.44 for all three/)
  })

  it('draws each approach as a picture named by its letter and plain name', async () => {
    await renderHelp()
    const figures = within(section('4. The three approaches')).getAllByRole(
      'figure',
    )
    expect(
      figures.map((figure) => figure.querySelector('figcaption')!.textContent),
    ).toEqual(['A · Text search', 'B · Graph', 'C · Graph + Ontology'])
    for (const figure of figures)
      expect(within(figure).getByRole('img')).toHaveAccessibleName(
        /re-ordering model/,
      )
  })

  it('links the data tour to the Data Model tabs', async () => {
    await renderHelp()
    const links = within(section('2. The made-up company')).getAllByRole('link')
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '#/data-model?tab=warehouse',
      '#/data-model?tab=graph',
      '#/data-model?tab=ontology',
      '#/data-model?tab=scenarios',
    ])
  })
})

describe('the planted stories', () => {
  it('shows each hidden truth verbatim under its scenario title', async () => {
    await renderHelp()
    const stories = section('3. The planted stories')
    const withTruth = SCORED.filter((q) => q.hidden_truth !== null)
    expect(withTruth).toHaveLength(8)
    for (const question of withTruth) {
      const title = SCENARIOS.find(
        (s) => s.scenario_id === question.scenario_id,
      )!.title
      const card = within(stories)
        .getByRole('heading', { name: title })
        .closest('article')!
      expect(within(card).getByText(question.hidden_truth!)).toBeVisible()
    }
  })

  it('says so when no question describes a story', async () => {
    await renderHelp('#/help', {
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
    await renderHelp()
    const l18 = SCORED.find((q) => q.scenario_id === 'SCN-007')!
    const stories = section('3. The planted stories')
    expect(within(stories).getAllByText('Worked example')).toHaveLength(1)
    const card = within(stories).getByText('Worked example').closest('article')!
    expect(card).toHaveTextContent('Cross market platform incident')
    expect(within(card).getByText(l18.text)).toBeVisible()
    expect(within(card).getByText(l18.expected_answer)).toBeVisible()
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

  it('scrolls to the section named in the link', async () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    await renderHelp('#/help?section=glossary')
    await waitFor(() => expect(scroll).toHaveBeenCalled())
    expect((scroll.mock.contexts.at(-1) as HTMLElement).id).toBe('glossary')
  })
})

describe('the questions table', () => {
  const rows = () =>
    [...questionTable().querySelectorAll('tbody tr')].filter((row) =>
      row.querySelector('td'),
    ) as HTMLElement[]
  const groups = () => questionTable().querySelectorAll('tbody')

  it('groups instances under their question, with what it tests', async () => {
    await renderHelp()
    expect(groups()).toHaveLength(22)
    expect(rows()).toHaveLength(SCORED.length)
    const first = SCORED[0]
    expect(groups()[0]).toHaveTextContent(first.question_id)
    expect(groups()[0]).toHaveTextContent(first.tests)
    expect(rows()[0]).toHaveTextContent(first.text)
    expect(rows()[0]).toHaveTextContent(first.expected_answer)
    expect(questionTable().querySelectorAll('thead th')).toHaveLength(5)
    expect(screen.getByText('22 questions, 50 instances')).toBeVisible()
  })

  it('names the ontology-dependent kind in full', async () => {
    await renderHelp()
    expect(
      within(
        screen.getByRole('combobox', { name: 'Kind of question' }),
      ).getByRole('option', { name: 'Ontology-dependent' }),
    ).toHaveValue('H2')
  })

  it('filters by kind of question and keeps the filter in the URL', async () => {
    const user = userEvent.setup()
    await renderHelp()
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
    await renderHelp('#/help?section=questions&story=SCN-007')
    expect(screen.getByRole('combobox', { name: 'Story' })).toHaveValue(
      'SCN-007',
    )
    expect(rows()).toHaveLength(1)
    expect(rows()[0]).toHaveTextContent('INC_042')
  })

  it('keeps the kind filter on a story link in the table', async () => {
    await renderHelp('#/help?section=questions&stratum=H5')
    expect(
      within(groups()[0]).getByRole('link', {
        name: 'App release conversion failure',
      }),
    ).toHaveAttribute('href', '#/help?section=stories&story=SCN-001&stratum=H5')
  })

  it('says so when no question matches both filters, and clears them', async () => {
    const user = userEvent.setup()
    await renderHelp('#/help?section=questions&story=SCN-007&stratum=H1')
    expect(screen.getByText('No question matches these filters.')).toBeVisible()
    await user.click(screen.getByRole('link', { name: 'Clear the filters' }))
    await waitFor(() => expect(rows()).toHaveLength(SCORED.length))
  })

  it('ignores a story or kind that does not exist', async () => {
    await renderHelp('#/help?section=questions&story=SCN-999&stratum=H9')
    expect(rows()).toHaveLength(SCORED.length)
  })

  it('shows each instance its own answer and evidence scores, worded as in Live Lab', async () => {
    await renderHelp('#/help?section=questions&story=SCN-007')
    const row = rows()[0]
    // A: answer 0.33, evidence 0.45; B and C: answer 0.33, evidence 0.37.
    expect(
      within(row).getAllByText('Answer: Partly correct (33%)'),
    ).toHaveLength(3)
    expect(within(row).getByText('Evidence score: 0.45')).toBeVisible()
    expect(within(row).getAllByText('Evidence score: 0.37')).toHaveLength(2)
  })

  it('shows Missing where the instance has no evidence score, and says why', async () => {
    await renderHelp('#/help?section=questions&stratum=H3')
    expect(
      within(rows()[0]).getAllByText('Evidence score: Missing'),
    ).toHaveLength(3)
    expect(within(rows()[0]).getAllByText('Answer: Correct')).toHaveLength(3)
    expect(
      within(section('7. How scoring works')).getByText(/reads Missing/),
    ).toBeVisible()
  })

  it('says an instance was not part of the run when it has no scores', async () => {
    await renderHelp()
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
      await renderHelp('#/help?section=questions', stub)
      const questions = section('10. The questions')
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
      // The cells are visibly empty and carry the words for a screen reader.
      const labels = within(table).getAllByText('No official run yet')
      expect(labels).toHaveLength(SCORED.length * 3)
      for (const label of labels) expect(label).toHaveClass('sr-only')
    },
  )

  it('still has the question text and answer keys with no official run', async () => {
    await renderHelp('#/help', { questions: UNSCORED, latest: null })
    expect(rows()[0]).toHaveTextContent(UNSCORED[0].expected_answer)
  })

  it('keeps the stories and questions when the newest run cannot be read, and hides scores', async () => {
    await renderHelp('#/help?section=questions', {
      questions: SCORED,
      failLatest: true,
    })
    expect(
      within(section('3. The planted stories')).getAllByRole('article'),
    ).toHaveLength(SCENARIOS.length)
    expect(
      screen.getByText(
        /The latest run could not be read, so scores are hidden\./,
      ),
    ).toBeVisible()
    expect(rows()).toHaveLength(SCORED.length)
    expect(questionTable()).not.toHaveTextContent(/Answer:|Evidence score/)
  })
})

describe('states', () => {
  it('keeps the sections that need no data when the bank fails to load', async () => {
    window.history.replaceState(null, '', '/#/help')
    stubBank({ failQuestions: true })
    render(
      <SettingsProvider>
        <Help />
      </SettingsProvider>,
    )
    expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('The bank is unavailable.').length).toBe(2)
    expect(section('7. How scoring works')).toBeVisible()
    expect(section('11. Glossary')).toBeVisible()
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0])
  })

  it('shows a loading state in the two sections that need the bank', async () => {
    window.history.replaceState(null, '', '/#/help')
    vi.stubGlobal('fetch', () => new Promise(() => undefined))
    render(
      <SettingsProvider>
        <Help />
      </SettingsProvider>,
    )
    expect(screen.getAllByRole('status')).toHaveLength(2)
  })
})

describe('scoring and glossary', () => {
  it('defines the evidence score on the scale Overview uses', async () => {
    await renderHelp()
    expect(
      within(section('7. How scoring works')).getByText(
        /The evidence score runs from 0 to 1/,
      ),
    ).toBeVisible()
  })

  it('shows every glossary term with its plain meaning', async () => {
    await renderHelp()
    const glossary = section('11. Glossary')
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
    const { container } = await renderHelp()
    const scoring = within(section('7. How scoring works'))
    expect(
      scoring.getByText(
        /The starting record \(the record the question names\)/,
      ),
    ).toBeVisible()
    const glossary = section('11. Glossary')
    const meaning = (term: string) =>
      within(glossary).getByText(term).nextElementSibling!.textContent
    expect(meaning('Starting record')).toMatch(
      /^The record the question names, which the evidence must start from\./,
    )
    expect(meaning('Starting record')).toContain('Not the graph')
    expect(meaning('Starting point')).toContain('Where the graph walk begins')
    expect(meaning('Starting point')).toContain('Not the starting record')
    const rest = container.cloneNode(true) as HTMLElement
    rest.querySelectorAll('[data-api]').forEach((node) => node.remove())
    expect(rest.textContent).not.toMatch(/\banchor/i)
  })
})

describe('Running it and the vendor names', () => {
  it('names vendors and engineering commands in Running it at Technical, and nowhere at Plain', async () => {
    const { container } = await renderHelp()
    for (const name of RUNNING_ONLY)
      expect(container.textContent!.toLowerCase(), name).not.toContain(
        name.toLowerCase(),
      )
    expect(container.querySelectorAll('code')).toHaveLength(0)
    expect(section('12. Running it')).toHaveTextContent(/operators/)
    cleanup()

    await renderHelp('#/help?level=technical')
    const running = section('12. Running it')
    for (const name of RUNNING_ONLY)
      expect(running.textContent, name).toContain(name)
  })

  it('gives a real remedy for a model the server does not list', async () => {
    await renderHelp('#/help?level=technical')
    const table = within(section('12. Running it')).getByRole('table', {
      name: 'Recovery',
    })
    expect(within(table).getByText('ollama pull <model>')).toBeVisible()
  })

  it('has a recovery table with the graph ingest command and the world note', async () => {
    await renderHelp('#/help?level=technical')
    const table = within(section('12. Running it')).getByRole('table', {
      name: 'Recovery',
    })
    expect(within(table).getByText('make ingest-graph')).toBeVisible()
    expect(table).toHaveTextContent(/graph must hold the presentation world/i)
  })

  it('gives commands that exist in the Makefile', async () => {
    const makefile = readFileSync(resolve(process.cwd(), '../Makefile'), 'utf8')
    await renderHelp('#/help?level=technical')
    const targets = [
      ...within(section('12. Running it')).getAllByText(/^make [a-z-]+$/),
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
    await renderHelp('#/help?level=technical')
    const running = section('12. Running it')
    const plain = within(running).getByText(/is for operators/)
    const heading = within(running).getByRole('heading', {
      name: 'Technical detail',
    })
    expect(
      plain.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
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
    for (const other of CHAPTERS.filter((c) => c.id !== 'scoring'))
      vi.spyOn(
        document.getElementById(other.id)!,
        'getBoundingClientRect',
      ).mockImplementation(() => ({ top: -900, bottom: -10 }) as DOMRect)
    const scrollBy = vi.fn()
    window.scrollBy = scrollBy
    scrollBy.mockImplementation(() => undefined)
    await user.click(radio('Technical'))
    await waitFor(() => expect(radio('Technical')).toBeChecked())
    await waitFor(() => expect(scrollBy).toHaveBeenCalled())
    expect(scrollBy.mock.calls.at(-1)![0]).toMatchObject({ top: 360 })
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
    vi.restoreAllMocks()
  })

  it('remembers the level in storage and the URL wins over it', async () => {
    window.localStorage.setItem('help-level', 'technical')
    await renderHelp()
    expect(radio('Technical')).toBeChecked()
    cleanup()
    await renderHelp('#/help?level=plain')
    expect(radio('Plain')).toBeChecked()
    window.localStorage.removeItem('help-level')
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
    window.localStorage.removeItem('help-level')
  })

  it('keeps a level that came from storage through a chapter link, a filter and a story link', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem('help-level', 'technical')
    await renderHelp('#/help')
    const nav = screen.getByRole('navigation', { name: 'Help sections' })
    const link = within(nav).getByRole('link', { name: 'The questions' })
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
    window.localStorage.removeItem('help-level')
  })

  it('presentation mode ignores storage but honours ?level', async () => {
    window.localStorage.setItem('help-level', 'technical')
    await renderHelp('?present=1#/help')
    expect(radio('Plain')).toBeChecked()
    cleanup()
    await renderHelp('?present=1#/help?level=technical')
    expect(radio('Technical')).toBeChecked()
    window.localStorage.removeItem('help-level')
    window.history.replaceState(null, '', '/')
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
    const nav = screen.getByRole('navigation', { name: 'Help sections' })
    expect(
      within(nav).getByRole('link', { name: 'The questions' }),
    ).toHaveAttribute('href', '#/help?section=questions&level=technical')
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
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    for (const [old, chapter] of Object.entries(SECTION_ALIASES)) {
      scroll.mockClear()
      await renderHelp(`#/help?section=${old}`)
      await waitFor(() => expect(scroll).toHaveBeenCalled())
      expect((scroll.mock.contexts.at(-1) as HTMLElement).id).toBe(chapter)
      cleanup()
    }
    expect(SECTION_ALIASES.what).toBe('why')
    expect(SECTION_ALIASES.data).toBe('company')
  })

  it('?story= still marks the story and filters the questions', async () => {
    await renderHelp('#/help?section=stories&story=SCN-007&level=technical')
    const card = within(section('3. The planted stories'))
      .getByRole('heading', { name: 'Cross market platform incident' })
      .closest('article')!
    expect(card).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('combobox', { name: 'Story' })).toHaveValue(
      'SCN-007',
    )
  })
})

describe('settings in Help', () => {
  // The table in Running it; chapters 4 to 6 have tables of their own.
  const settingsRow = (key: string) =>
    within(section('12. Running it')).getByRole('row', {
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
    const row = settingsRow('context.graph_slots')
    expect(await within(row).findAllByText('6')).toHaveLength(2)
  })

  it('a setting the run did not record reads Not recorded', async () => {
    await renderHelp('#/help?section=running&level=technical', {
      ...RECORDED_RUNS,
    })
    const row = settingsRow('max_tokens')
    await within(row).findByText('1024')
    expect(within(row).getByText('Not recorded')).toBeVisible()
    expect(within(row).queryByText('Differs')).toBeNull()
  })

  it('a setting that differs from the run is marked different', async () => {
    await renderHelp('#/help?section=running&level=technical', {
      ...RECORDED_RUNS,
    })
    const row = settingsRow('context_budget_tokens')
    await within(row).findByText('2000')
    expect(within(row).getByText('1500')).toBeVisible()
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
    const retry = within(section('12. Running it')).getByRole('button', {
      name: 'Retry loading settings',
    })
    expect(retry).toBeVisible()
    await user.click(retry)
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
    const running = section('12. Running it')
    expect(
      (await within(running).findAllByText('Not available')).length,
    ).toBeGreaterThan(0)
    const headings = screen
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent)
    expect(headings).toEqual(CHAPTER_TITLES)
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
