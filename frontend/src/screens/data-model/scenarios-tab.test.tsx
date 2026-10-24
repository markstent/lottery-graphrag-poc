import { render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { failure, stubApi } from '../../test/api-stub'
import source from './scenarios-tab.tsx?raw'
import { SCENARIOS, stubOntology } from './ontology.fixtures'
import { ScenariosTab } from './scenarios-tab'

afterEach(() => vi.unstubAllGlobals())

describe('ScenariosTab', () => {
  it('shows each scenario of the world as a card', async () => {
    stubOntology()
    render(<ScenariosTab />)
    const cards = await screen.findAllByRole('article')
    expect(cards).toHaveLength(SCENARIOS.length)
    expect(SCENARIOS).toHaveLength(8)
    expect(
      within(cards[0]).getByRole('heading', {
        name: 'App release conversion failure',
      }),
    ).toBeVisible()
  })

  it('says in words whether the story is planted, with its rows by table, strength and noise', async () => {
    stubOntology()
    render(<ScenariosTab />)
    const card = (await screen.findAllByRole('article'))[0]
    expect(within(card).queryByText(/planted in this world/i)).toBeNull()
    const rows = within(card).getByRole('list', { name: 'Planted rows' })
    expect(within(rows).getByText('sessions').nextSibling).toHaveTextContent(
      '150',
    )
    expect(within(card).getByText('Strength').nextSibling).toHaveTextContent(
      '0.8',
    )
    expect(within(card).getByText('Noise level').nextSibling).toHaveTextContent(
      'moderate',
    )
    expect(card).not.toHaveTextContent('SCN-001-')
  })

  it('explains strength and noise once, at the top', async () => {
    stubOntology()
    render(<ScenariosTab />)
    expect(
      await screen.findByText(/Strength is how obvious the signal is/),
    ).toBeVisible()
  })

  it('says when a story is not planted and has no rows', async () => {
    stubApi({
      '/api/v1/scenarios': [
        {
          ...SCENARIOS[0],
          planted: false,
          planted_rows: {},
          strength: null,
          noise_level: null,
        },
      ],
    })
    render(<ScenariosTab />)
    const card = await screen.findByRole('article')
    expect(within(card).getByText('Not planted in this world')).toBeVisible()
    expect(within(card).getByText('No rows planted.')).toBeVisible()
    expect(within(card).getByText('Strength').nextSibling).toHaveTextContent(
      'not set',
    )
  })

  it('links each story to its Help narrative and to the questions that test it', async () => {
    stubOntology()
    render(<ScenariosTab />)
    for (const [index, scenario] of SCENARIOS.entries()) {
      const card = (await screen.findAllByRole('article'))[index]
      expect(
        within(card).getByRole('link', { name: 'Read the story' }),
      ).toHaveAttribute(
        'href',
        `#/help?section=stories&story=${scenario.scenario_id}`,
      )
      expect(
        within(card).getByRole('link', {
          name: 'See the questions that test it',
        }),
      ).toHaveAttribute(
        'href',
        `#/help?section=questions&story=${scenario.scenario_id}`,
      )
    }
  })

  it('shows no truth content, even if the API sent some', async () => {
    stubApi({
      '/api/v1/scenarios': [
        {
          ...SCENARIOS[0],
          expected_answer: 'SECRET-ANSWER',
          hidden_truth: 'SECRET-TRUTH',
          claims: ['SECRET-CLAIM'],
        },
      ],
    })
    render(<ScenariosTab />)
    await screen.findByRole('article')
    expect(document.body.textContent).not.toMatch(
      /SECRET|expected|answer|truth|claim/i,
    )
  })

  it('never reaches for the questions endpoint', async () => {
    const { requested } = stubOntology()
    render(<ScenariosTab />)
    await screen.findAllByRole('article')
    expect(requested.filter((path) => path.includes('questions'))).toEqual([])
    expect(source).not.toMatch(
      /getBenchmarkQuestions|getDemoQuestions|\/questions/,
    )
    expect(source).not.toMatch(/truth/i)
  })

  it('shows a skeleton while loading', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => undefined)),
    )
    render(<ScenariosTab />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading Scenarios')
  })

  it('says so when there are no scenarios', async () => {
    stubApi({ '/api/v1/scenarios': [] })
    render(<ScenariosTab />)
    expect(await screen.findByText('No scenarios are defined.')).toBeVisible()
  })

  it('shows the API error with a retry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(failure('The scenarios are unavailable.', true)),
      ),
    )
    render(<ScenariosTab />)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The scenarios are unavailable.',
    )
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible()
  })
})
