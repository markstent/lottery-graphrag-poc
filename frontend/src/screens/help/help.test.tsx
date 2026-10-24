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
import { HELP_WORD_CAP, wordsIn } from '../../copy/budget'
import { Help } from './help'
import { BRING_UP, MODELS, RECOVERY } from './running-data'
import {
  OFFICIAL_STRATA,
  OFFICIAL_SUBSET,
  SCENARIOS,
  SCORED,
  SMOKE,
  stubBank,
  UNSCORED,
  type BankStub,
} from './help.fixtures'

const SECTIONS = [
  '1. What we are testing',
  '2. The three approaches',
  '3. The data',
  '4. The planted stories',
  '5. The questions',
  '6. How scoring works',
  '7. Glossary',
  '8. Running it',
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
  it('has its eight sections in the order of the specification', async () => {
    await renderHelp()
    const headings = screen
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent)
    expect(headings).toEqual(SECTIONS)
  })

  it('opens with the purpose sentence and links to each section', async () => {
    await renderHelp()
    const nav = screen.getByRole('navigation', { name: 'Help sections' })
    expect(within(nav).getAllByRole('link')).toHaveLength(8)
    expect(
      within(nav).getByRole('link', { name: 'The questions' }),
    ).toHaveAttribute('href', '#/help?section=questions')
  })

  it('says what is tested in three sentences and one diagram', async () => {
    await renderHelp()
    const what = section('1. What we are testing')
    expect(within(what).getAllByRole('paragraph')).toHaveLength(1)
    const sentences = within(what)
      .getByRole('paragraph')
      .textContent!.split(/(?<=\.)\s+/)
    expect(sentences).toHaveLength(3)
    expect(
      within(what).getByRole('img', {
        name: 'How the three approaches differ',
      }),
    ).toBeVisible()
  })

  it('gives each approach a card with its letter, plain name and one line', async () => {
    await renderHelp()
    const cards = within(section('2. The three approaches')).getAllByRole(
      'article',
    )
    expect(
      cards.map((card) => within(card).getByRole('heading').textContent),
    ).toEqual(['A · Text search', 'B · Graph', 'C · Graph + Ontology'])
  })

  it('links the data tour to the Data Model tabs', async () => {
    await renderHelp()
    const links = within(section('3. The data')).getAllByRole('link')
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
    const stories = section('4. The planted stories')
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
    const card = within(section('4. The planted stories'))
      .getByRole('heading', { name: 'Game mechanic affinity' })
      .closest('article')!
    expect(card).toHaveTextContent(
      "No question in the bank describes this story's hidden truth.",
    )
  })

  it('tells SCN-007 once, as the worked example, with its question and answer key', async () => {
    await renderHelp()
    const l18 = SCORED.find((q) => q.scenario_id === 'SCN-007')!
    const stories = section('4. The planted stories')
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
    const card = within(section('4. The planted stories'))
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
      within(section('6. How scoring works')).getByText(/reads Missing/),
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
      const questions = section('5. The questions')
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
      within(section('4. The planted stories')).getAllByRole('article'),
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
    expect(section('6. How scoring works')).toBeVisible()
    expect(section('7. Glossary')).toBeVisible()
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
  it('defines the evidence score in one line, on the scale Overview uses', async () => {
    await renderHelp()
    expect(
      within(section('6. How scoring works')).getByText(
        /Evidence score runs from 0 to 1/,
      ),
    ).toBeVisible()
  })

  it('has one short part each for evidence, answer, judge and intervals', async () => {
    await renderHelp()
    expect(
      within(section('6. How scoring works'))
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent),
    ).toEqual(['Evidence found', 'Correct answer', 'Judge', 'Intervals'])
  })

  it('has twelve glossary terms of about twelve words each', async () => {
    await renderHelp()
    const terms = within(section('7. Glossary')).getAllByRole('term')
    const meanings = within(section('7. Glossary')).getAllByRole('definition')
    expect(terms).toHaveLength(12)
    for (const meaning of meanings) {
      const words = meaning.textContent!.trim().split(/\s+/).length
      expect(words).toBeGreaterThanOrEqual(8)
      expect(words).toBeLessThanOrEqual(16)
    }
  })
})

describe('one name for the record a question names', () => {
  it('calls it the starting record in scoring and the glossary, and never an anchor', async () => {
    const { container } = await renderHelp()
    const scoring = within(section('6. How scoring works'))
    expect(
      scoring.getByText(
        /The starting record \(the record the question names\)/,
      ),
    ).toBeVisible()
    const glossary = section('7. Glossary')
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

describe('section 8 and the vendor names', () => {
  it('names vendors and engineering commands in Running it and nowhere else', async () => {
    const { container } = await renderHelp()
    const running = section('8. Running it')
    for (const name of RUNNING_ONLY)
      expect(running.textContent, name).toContain(name)
    // Everything else: the purpose sentence, the section links and sections 1 to 7.
    const rest = container.cloneNode(true) as HTMLElement
    rest.querySelector('#running')!.remove()
    for (const name of RUNNING_ONLY)
      expect(rest.textContent!.toLowerCase(), name).not.toContain(
        name.toLowerCase(),
      )
    expect(rest.querySelectorAll('code')).toHaveLength(0)
    expect(rest.textContent).toContain('How it works in plain language')
  })

  it('gives a real remedy for a model the server does not list', async () => {
    await renderHelp()
    const table = within(section('8. Running it')).getByRole('table', {
      name: 'Recovery',
    })
    expect(within(table).getByText('ollama pull <model>')).toBeVisible()
  })

  it('has a recovery table with the graph ingest command and the world note', async () => {
    await renderHelp()
    const table = within(section('8. Running it')).getByRole('table', {
      name: 'Recovery',
    })
    expect(within(table).getByText('make ingest-graph')).toBeVisible()
    expect(table).toHaveTextContent(/graph must hold the presentation world/i)
  })

  it('gives bring-up commands that exist in the Makefile', async () => {
    const makefile = readFileSync(resolve(process.cwd(), '../Makefile'), 'utf8')
    await renderHelp()
    const targets = [
      ...within(section('8. Running it')).getAllByText(/^make [a-z-]+$/),
    ].map((element) => element.textContent!.slice('make '.length))
    expect(targets.length).toBeGreaterThan(6)
    for (const target of targets)
      expect(makefile).toMatch(new RegExp(`^${target}:`, 'm'))
  })
})

describe('copy budget', () => {
  it('keeps Help prose within its word cap, leaving out text from the API', async () => {
    const { container } = await renderHelp()
    const clone = container.cloneNode(true) as HTMLElement
    clone.querySelectorAll('[data-api]').forEach((node) => node.remove())
    clone.querySelectorAll('svg').forEach((node) => node.remove())
    const words = wordsIn(clone.textContent!)
    expect(words).toBeLessThanOrEqual(HELP_WORD_CAP)
    expect(words).toBeGreaterThan(800)
  })
})
