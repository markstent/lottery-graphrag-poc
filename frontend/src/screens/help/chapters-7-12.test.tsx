import { cleanup, render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { GLOSSARY_TERMS } from '../../copy/glossary'
import { Blocks } from './blocks'
import { PAGES, type Block, type ChapterId } from './chapters'
import { CHAPTER_COPY } from './copy'
import { REGISTER } from './copy/limits'
import { HelpDataContext, type HelpData } from './help-data'
import { BRING_UP, COMMAND_GROUPS, MODELS, RECOVERY } from './running-data'

afterEach(cleanup)

const LAST_SIX: readonly ChapterId[] = [
  'scoring',
  'results',
  'limits',
  'questions',
  'glossary',
  'running',
]

/** Settings now of 1500 tokens, a duplicate threshold of 0.9 and depth 2. */
function helpData(level: HelpData['level']): HelpData {
  return {
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
          context_budget_tokens: 1500,
          context: { dedupe_threshold: 0.9 },
          graph_limits: { depth: 2 },
          repeats: 3,
        },
      },
    },
    recorded: { status: 'ready', retry: () => undefined, data: null },
  }
}

function show(level: HelpData['level'], blocks: readonly Block[]) {
  render(
    <HelpDataContext.Provider value={helpData(level)}>
      <Blocks blocks={blocks} />
    </HelpDataContext.Provider>,
  )
}

function showRegister(level: HelpData['level']) {
  show(level, [{ kind: 'component', name: 'register' }])
  return screen.getByRole('table', { name: 'Assumptions and limits' })
}

/** Every string a list of blocks holds: paragraphs and list items. */
const strings = (blocks: readonly Block[]): string[] =>
  blocks.flatMap((block) =>
    typeof block === 'string' ? [block] : 'kind' in block ? [] : [...block],
  )

/** All the text of a chapter that Help writes itself, at both levels, with the data its widgets show. */
function chapterText(id: ChapterId): string {
  const { plain, technical } = CHAPTER_COPY[id]
  const own = [...strings(plain), ...strings(technical)]
  if (id === 'limits')
    own.push(
      ...REGISTER.flatMap((row) => [
        row.item,
        row.plain,
        row.reason,
        row.cost,
        row.decision ?? '',
      ]),
    )
  if (id === 'glossary')
    own.push(
      ...GLOSSARY_TERMS.flatMap(({ term, meaning, technical }) => [
        term,
        meaning,
        technical ?? '',
      ]),
    )
  if (id === 'running')
    own.push(
      ...BRING_UP.flat(),
      ...RECOVERY.flat(),
      ...MODELS.flat(),
      ...COMMAND_GROUPS.flatMap(({ rows }) => rows.flat()),
    )
  return own.join('\n')
}

const allHelpText = () => PAGES.map(({ id }) => chapterText(id)).join('\n')

describe('chapters 7 to 12', () => {
  it('chapters 7, 8, 9, 10 and 12 have plain and technical prose, and 11 a plain framing', () => {
    for (const id of [
      'scoring',
      'results',
      'limits',
      'questions',
      'running',
    ] as const) {
      expect(strings(CHAPTER_COPY[id].plain).length, id).toBeGreaterThan(0)
      expect(strings(CHAPTER_COPY[id].technical).length, id).toBeGreaterThan(0)
    }
    expect(strings(CHAPTER_COPY.glossary.plain).length).toBeGreaterThan(0)
  })

  it('the register has every required row', () => {
    const ids = REGISTER.map((row) => row.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(
      expect.arrayContaining([
        'synthetic-data',
        'one-company-shape',
        'evidence-limits',
        'graph-order',
        'reasoning-off',
        'answer-model',
        'judge-is-a-model',
        'judge-agreement',
        'bank-size',
        'question-groups',
        'interval-and-test',
        'bank-authors',
      ]),
    )
    for (const row of REGISTER)
      for (const field of ['item', 'plain', 'reason', 'cost'] as const)
        expect(row[field].trim(), `${row.id} ${field}`).not.toBe('')
  })

  it("the register states the official run's own limits with their source", () => {
    const row = (id: string) => REGISTER.find((r) => r.id === id)!
    const agreement = row('judge-agreement')
    // The official run (official-2026-10-29) is the result.
    expect(agreement.plain).toContain('88 percent')
    expect(agreement.plain).toContain('70 percent')
    expect(agreement.reason).toMatch(/weighted kappa 0\.77/)
    expect(agreement.reason).toMatch(/weighted kappa 0\.25/)
    expect(agreement.reason).toContain('2026-10-29')
    expect(agreement.reason).toContain('D-096')
    expect(row('question-groups').plain).toContain('24 groups')
    expect(row('interval-and-test').plain).toContain('five tested comparisons')
  })

  it('describes one method and one official run, with no word of an earlier method or run (D-104)', () => {
    const help = [
      allHelpText(),
      ...GLOSSARY_TERMS.flatMap(({ meaning, technical }) => [
        meaning,
        technical ?? '',
      ]),
      ...COMMAND_GROUPS.flatMap(({ rows }) => rows.flat()),
    ].join('\n')
    expect(help).not.toMatch(
      /\bv0\.[0-9]|method 0\.[0-9]|official-2026-10-26|old method|earlier (?:official )?run|first method|second method|method was changed|after seeing/i,
    )
    for (const id of ['why', 'results'] as const) {
      const text = chapterText(id)
      expect(text, id).toContain('official run')
      expect(text, id).toContain('2026-10-29')
      expect(text, id).not.toMatch(
        /result so far|will use six worlds|will be published whatever/,
      )
    }
    expect(chapterText('why')).toContain('22.1 percentage points')
  })

  it('plain shows item and plain only, technical adds reason and cost', () => {
    const plainTable = showRegister('plain')
    expect(
      within(plainTable)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Assumption or limit', 'What it means'])
    const first = REGISTER[0]!
    expect(plainTable).toHaveTextContent(first.item)
    expect(plainTable).not.toHaveTextContent(first.reason)
    expect(plainTable).not.toHaveTextContent(first.cost)
    cleanup()

    const technicalTable = showRegister('technical')
    expect(
      within(technicalTable)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual([
      'Assumption or limit',
      'What it means',
      'Why',
      'Cost if wrong',
      'Decision or source',
    ])
    expect(technicalTable).toHaveTextContent(first.reason)
    expect(technicalTable).toHaveTextContent(first.cost)
    expect(within(technicalTable).getAllByRole('row')).toHaveLength(
      REGISTER.length + 1,
    )
  })

  it('the register fills current settings into its rows and types none of them', () => {
    const table = showRegister('plain')
    const budget = within(table).getByRole('row', {
      name: /^The evidence budget/,
    })
    expect(budget).toHaveTextContent('1,500 tokens')
    expect(table).not.toHaveTextContent(/not available/)
    // Every cell the register fills, at both levels, takes current settings from placeholders.
    const cells = REGISTER.flatMap((row) => [
      row.item,
      row.plain,
      row.reason,
      row.cost,
    ]).join(' ')
    expect(cells).not.toMatch(
      /\b(?:12 places|2,?000 tokens|6 of|depth 2|(?:three|3) (?:repeats|tries))\b/i,
    )
  })

  /** Targets that act only on a run the site does not show, so Running it leaves them out (D-104). */
  const EARLIER_RUN_TARGETS = new Set(['addendum-v020'])

  it('every command in Help is a Makefile target, and every target but those of a run the site does not show is listed in Running it', () => {
    const makefile = readFileSync(resolve(process.cwd(), '../Makefile'), 'utf8')
    const defined = [...makefile.matchAll(/^([a-z0-9-]+):.*##/gm)].map(
      (match) => match[1]!,
    )
    const named = [...allHelpText().matchAll(/\bmake ([a-z0-9-]+)/g)].map(
      (match) => match[1]!,
    )
    expect(named.length).toBeGreaterThan(20)
    for (const target of named) expect(defined, target).toContain(target)
    const listed = COMMAND_GROUPS.flatMap(({ rows }) =>
      rows.map(([command]) => command),
    )
    for (const target of defined.filter((t) => !EARLIER_RUN_TARGETS.has(t)))
      expect(listed, target).toContain(`make ${target}`)
    for (const target of EARLIER_RUN_TARGETS)
      expect(listed, target).not.toContain(`make ${target}`)
  })

  it('terms used in chapters are in the glossary', () => {
    const glossary = new Set(
      GLOSSARY_TERMS.map(({ term }) => term.toLowerCase()),
    )
    for (const { id } of PAGES) {
      const terms = CHAPTER_COPY[id].terms ?? []
      if (id !== 'glossary') expect(terms.length, id).toBeGreaterThan(0)
      const text = chapterText(id).toLowerCase()
      for (const term of terms) {
        expect(glossary, `${id}: ${term}`).toContain(term.toLowerCase())
        expect(text, `${id} uses ${term}`).toContain(term.toLowerCase())
      }
    }
  })

  it('every glossary term is used by some chapter', () => {
    const used = new Set(
      PAGES.flatMap(({ id }) =>
        (CHAPTER_COPY[id].terms ?? []).map((term) => term.toLowerCase()),
      ),
    )
    for (const { term } of GLOSSARY_TERMS)
      expect(used, term).toContain(term.toLowerCase())
  })

  it('the glossary shows plain definitions at plain and adds the technical ones at technical', () => {
    const withTechnical = GLOSSARY_TERMS.find(({ technical }) => technical)!
    show('plain', [{ kind: 'component', name: 'glossary' }])
    expect(screen.getAllByRole('term')).toHaveLength(GLOSSARY_TERMS.length)
    expect(document.body).toHaveTextContent(withTechnical.meaning)
    expect(document.body).not.toHaveTextContent(withTechnical.technical!)
    cleanup()

    show('technical', [{ kind: 'component', name: 'glossary' }])
    expect(document.body).toHaveTextContent(withTechnical.meaning)
    expect(document.body).toHaveTextContent(withTechnical.technical!)
  })

  it('chapter 9 shows the register at both levels', () => {
    for (const level of ['plain', 'technical'] as const) {
      show(level, CHAPTER_COPY.limits.plain)
      expect(
        screen.getByRole('table', { name: 'Assumptions and limits' }),
      ).toBeVisible()
      cleanup()
    }
  })

  it('chapter 12 at Plain is a note for operators with no command', () => {
    show('plain', CHAPTER_COPY.running.plain)
    expect(document.body.textContent).not.toMatch(/\bmake [a-z]/)
    expect(document.querySelectorAll('code, table')).toHaveLength(0)
  })

  it('chapters 7 to 12 state the current settings through placeholders only', () => {
    for (const id of LAST_SIX) {
      const prose = [
        ...strings(CHAPTER_COPY[id].plain),
        ...strings(CHAPTER_COPY[id].technical),
      ].join(' ')
      expect(prose, id).not.toMatch(
        /\b2,?000[- ]tokens?\b|\b12 (?:places|pieces|evidence)\b|\b6 graph\b/,
      )
    }
  })

  it('states the facts of the official run', () => {
    // Running it: the official run is the six unseen worlds, each question once (D-097).
    show('technical', [{ kind: 'component', name: 'running' }])
    expect(
      screen.getByText(/runs every question once on the six unseen worlds/),
    ).toHaveTextContent(
      'runs every question once on the six unseen worlds, 2029 to 2034 (D-097); REPEATS=N asks each N times.',
    )
    expect(document.body).not.toHaveTextContent(/on three worlds/)
    cleanup()
    // The questions: the official run grounded 300 instances over six worlds.
    const questions = chapterText('questions')
    expect(questions).toContain('its six worlds gave 300, 50 in each')
    expect(questions).not.toMatch(/the three official worlds/)
    // A token is charged for the whole block, not the bare text.
    const token = GLOSSARY_TERMS.find(({ term }) => term === 'Token')!
    expect(token.technical).toContain('over the whole block the prompt shows')
    expect(token.technical).not.toContain('text only')
    // The approaches differ in their graph order and turns too, and say so.
    const approaches = strings(CHAPTER_COPY.approaches.plain).join(' ')
    expect(approaches).not.toMatch(/chosen and answered is the same/)
    expect(approaches).toContain("in the graph's own order")
  })

  it('names every declared difference rather than one', () => {
    const answer = strings(CHAPTER_COPY.answer.plain).join(' ')
    expect(answer).not.toMatch(/the one thing B and C show/)
    expect(answer).toContain('only B and C can pick')
    expect(answer).toContain('the shared concepts only C shows')
    const why = strings(CHAPTER_COPY.why.technical).join(' ')
    expect(why).not.toMatch(/the one declared extra/)
    expect(why).toContain('target-type tier')
    expect(why).toContain("C's concept text")
  })

  it('states the scoring rules as the official run applied them', () => {
    const scoring = strings(CHAPTER_COPY.scoring.plain).join(' ')
    // 3 of 72 single-fact instances kept a claim in that run (results.json); not every one reads Missing.
    expect(scoring).toContain('almost every single-fact question')
    expect(scoring).toContain('3 of the 72 single-fact questions')
    expect(scoring).not.toMatch(/case for every single-fact question/)
    // Detectable needs the Holm test and an interval that leaves out zero (statistics.py).
    expect(scoring).toContain('its margin of error leaves out zero')
    expect(scoring).toContain('once by default')
    const term = (name: string) =>
      GLOSSARY_TERMS.find(({ term }) => term === name)!
    expect(term('Detectable difference').meaning).toContain(
      'margin of error leaves out zero',
    )
    expect(term('Judge').technical).toContain('judge prompt 1.2.0 (D-096)')
    expect(chapterText('glossary')).not.toContain('2026-10-27.')
  })

  it("says only B shares A's first block, and that turns are one for one", () => {
    const evidence = chapterText('evidence')
    expect(evidence).not.toMatch(/so their first block is A's first block/)
    expect(evidence).toContain("so B's first block is A's first block")
    expect(evidence).toContain('its ontology terms')
    for (const text of [evidence, chapterText('limits')]) {
      expect(text).not.toMatch(/share to choose|a share that someone/)
      expect(text).toMatch(/one for one/)
    }
    expect(chapterText('scoring')).toContain(
      'it is computed the same way for all three approaches',
    )
  })
})
