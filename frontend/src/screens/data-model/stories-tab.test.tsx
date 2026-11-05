import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { failure, stubApi } from '../../test/api-stub'
import { SCENARIOS, stubOntology } from './ontology.fixtures'
import source from './stories-tab.tsx?raw'
import { StoriesTab } from './stories-tab'

const renderAt = (query = '') => {
  window.history.replaceState(null, '', `/#/data-model?tab=stories${query}`)
  const view = () => (
    <StoriesTab
      params={new URLSearchParams(window.location.hash.split('?')[1])}
    />
  )
  const result = render(view())
  const onChange = () => result.rerender(view())
  window.addEventListener('hashchange', onChange)
  stops.push(() => window.removeEventListener('hashchange', onChange))
}

const stops: (() => void)[] = []

beforeEach(() => window.history.replaceState(null, '', '/#/data-model'))
afterEach(() => {
  vi.unstubAllGlobals()
  stops.splice(0).forEach((stop) => stop())
})

describe('StoriesTab', () => {
  it('lists the eight stories with their strength, the first one chosen', async () => {
    stubOntology()
    renderAt()
    const first = await screen.findByRole('button', {
      name: /App release conversion failure/,
    })
    expect(SCENARIOS).toHaveLength(8)
    expect(first).toHaveAttribute('aria-pressed', 'true')
    expect(first).toHaveTextContent('0.8')
    expect(
      screen
        .getAllByRole('button')
        .filter((b) => b.hasAttribute('aria-pressed')),
    ).toHaveLength(8)
  })

  it('shows the chosen story with its description, strength explained, noise and rows added', async () => {
    stubOntology()
    renderAt(`&story=${SCENARIOS[2].scenario_id}`)
    const middle = await screen.findByRole('region', {
      name: /2 What was planted/,
    })
    expect(
      within(middle).getByRole('heading', { name: SCENARIOS[2].title }),
    ).toBeVisible()
    expect(within(middle).getByText(SCENARIOS[2].description)).toBeVisible()
    expect(
      within(middle).getByText(
        'How clear the signal is, from 0.2 subtle to 1.0 obvious.',
      ),
    ).toBeVisible()
    expect(within(middle).getByText('Noise level')).toBeVisible()
    const rows = within(middle).getByRole('list', { name: 'Rows added' })
    expect(within(rows).getAllByRole('listitem').length).toBeGreaterThan(0)
  })

  it('chooses a story by click and keeps it in the address', async () => {
    stubOntology()
    renderAt()
    await userEvent.click(
      await screen.findByRole('button', {
        name: new RegExp(SCENARIOS[1].title),
      }),
    )
    expect(window.location.hash).toBe(
      `#/data-model?tab=stories&story=${SCENARIOS[1].scenario_id}`,
    )
    expect(
      await screen.findByRole('heading', { name: SCENARIOS[1].title }),
    ).toBeVisible()
  })

  it('opens on the first story when the address names an unknown one', async () => {
    stubOntology()
    renderAt('&story=SCN-999')
    expect(
      await screen.findByRole('heading', { name: SCENARIOS[0].title }),
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
    renderAt()
    expect(await screen.findByText('Not planted in this world')).toBeVisible()
    expect(screen.getByText('No rows added.')).toBeVisible()
    expect(screen.getByText('Strength').nextSibling).toHaveTextContent(
      'not set',
    )
  })

  it('links the chosen story to its Help narrative and its questions', async () => {
    stubOntology()
    renderAt(`&story=${SCENARIOS[3].scenario_id}`)
    const next = await screen.findByRole('region', { name: /3 Where next/ })
    expect(
      within(next).getByRole('link', { name: /Read the full story/ }),
    ).toHaveAttribute(
      'href',
      `#/help?section=stories&story=${SCENARIOS[3].scenario_id}`,
    )
    expect(
      within(next).getByRole('link', { name: /See its questions/ }),
    ).toHaveAttribute(
      'href',
      `#/help?section=questions&story=${SCENARIOS[3].scenario_id}`,
    )
    expect(next.querySelectorAll('a')).toHaveLength(2)
  })

  it('opens About this with the stories copy', async () => {
    stubOntology()
    renderAt()
    await userEvent.click(
      await screen.findByRole('button', { name: 'About this' }),
    )
    expect(
      await screen.findByText('What the planted stories are'),
    ).toBeVisible()
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
    renderAt()
    await screen.findByRole('heading', { name: SCENARIOS[0].title })
    expect(document.body.textContent).not.toMatch(
      /SECRET|expected|answer|truth|claim/i,
    )
  })

  it('never reaches for the questions endpoint', async () => {
    const { requested } = stubOntology()
    renderAt()
    await screen.findByRole('heading', { name: SCENARIOS[0].title })
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
    renderAt()
    expect(screen.getByRole('status')).toHaveTextContent('Loading Stories')
  })

  it('says so when there are no stories', async () => {
    stubApi({ '/api/v1/scenarios': [] })
    renderAt()
    expect(await screen.findByText('No stories are defined.')).toBeVisible()
  })

  it('shows the API error with a retry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(failure('The stories are unavailable.', true)),
      ),
    )
    renderAt()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The stories are unavailable.',
    )
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible()
  })
})
