import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { failure, json, stubApi } from '../../test/api-stub'
import { NATIONAL_DRAW, ONTOLOGY, stubOntology } from './ontology.fixtures'
import { OntologyTab } from './ontology-tab'

const renderAt = (query = '') => {
  window.history.replaceState(null, '', `/#/data-model?tab=ontology${query}`)
  const view = () => (
    <OntologyTab
      params={new URLSearchParams(window.location.hash.split('?')[1])}
    />
  )
  const result = render(view())
  // The tab reads the route; follow hash changes as the shell would.
  const onChange = () => result.rerender(view())
  window.addEventListener('hashchange', onChange)
  stops.push(() => window.removeEventListener('hashchange', onChange))
  return {
    ...result,
    stop: () => window.removeEventListener('hashchange', onChange),
  }
}

const goTo = (query: string) =>
  act(() => {
    window.location.hash = `#/data-model?tab=ontology${query}`
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })

const stops: (() => void)[] = []

beforeEach(() => window.history.replaceState(null, '', '/#/data-model'))
afterEach(() => {
  vi.unstubAllGlobals()
  stops.splice(0).forEach((stop) => stop())
})

describe('OntologyTab', () => {
  it('shows the national-draw concept with its four labels, in each language', async () => {
    stubOntology()
    renderAt(`&concept=${NATIONAL_DRAW}`)
    const card = await screen.findByRole('region', { name: 'Concept' })
    expect(
      within(card).getByText('National Draw', { selector: 'h3' }),
    ).toBeVisible()
    const labels = within(card).getByRole('list', {
      name: 'Names in each language',
    })
    expect(within(labels).getByText('National Draw')).toBeVisible()
    expect(within(labels).getByText('Αριθμολαχείο')).toHaveAttribute(
      'lang',
      'el',
    )
    expect(within(labels).getByText('Zahlenziehung')).toHaveAttribute(
      'lang',
      'de',
    )
    expect(within(labels).getByText('Číselná loterie')).toHaveAttribute(
      'lang',
      'cs',
    )
  })

  it('shows the definition the API gives, under the name', async () => {
    stubOntology()
    renderAt(`&concept=${NATIONAL_DRAW}`)
    const card = await screen.findByRole('region', { name: 'Concept' })
    expect(
      within(card).getByText(
        'The flagship number draw run by a single market for its own players.',
      ),
    ).toBeVisible()
  })

  it('shows synonyms the API gives, by language', async () => {
    const withSynonyms = {
      ...ONTOLOGY,
      concepts: ONTOLOGY.concepts.map((c) =>
        c.concept_id === NATIONAL_DRAW
          ? { ...c, synonyms: { en: ['lotto'], de: ['Lotto', '6 aus 49'] } }
          : c,
      ),
    }
    stubOntology({ '/api/v1/ontology': withSynonyms })
    renderAt(`&concept=${NATIONAL_DRAW}`)
    const synonyms = await screen.findByRole('list', { name: 'Other names' })
    expect(
      within(synonyms)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['English: lotto', 'German: Lotto, 6 aus 49'])
  })

  it('writes relationships in plain words and never shows a relationship type', async () => {
    stubOntology()
    renderAt(`&concept=${NATIONAL_DRAW}`)
    const card = await screen.findByRole('region', { name: 'Concept' })
    const relationships = within(card).getByRole('list', {
      name: 'Relationships',
    })
    expect(within(relationships).getByText(/is a kind of/)).toBeVisible()
    expect(
      within(relationships).getByText(
        'Bound to 4 local terms across 4 markets',
      ),
    ).toBeVisible()
    expect(
      within(relationships).getByRole('link', { name: 'Draw game' }),
    ).toHaveAttribute(
      'href',
      `#/data-model?tab=ontology&concept=CONCEPT_DRAW_GAME`,
    )
    expect(document.body.textContent).not.toMatch(/MAPS_TO|IS_A/)
    expect(card.textContent).not.toMatch(/[A-Z]+_[A-Z]+/)
  })

  it('lists the bound instances of every market with their local names', async () => {
    stubOntology()
    renderAt(`&concept=${NATIONAL_DRAW}`)
    const members = await screen.findByRole('region', {
      name: 'Local terms bound to it',
    })
    for (const [market, name] of [
      ['United Kingdom', 'National Draw'],
      ['Greece', 'Αριθμολαχείο'],
      ['Austria', 'Zahlenziehung'],
      ['Czech Republic', 'Číselná loterie'],
    ])
      expect(
        within(
          await within(members).findByRole('group', { name: market }),
        ).getByText(name),
      ).toBeVisible()
  })

  it('filters the bound instances by market and asks the API for that market', async () => {
    const { requested } = stubOntology()
    renderAt(`&concept=${NATIONAL_DRAW}`)
    const members = await screen.findByRole('region', {
      name: 'Local terms bound to it',
    })
    await within(members).findByText('Zahlenziehung')
    await userEvent.click(screen.getByRole('button', { name: 'Greece' }))
    expect(await within(members).findByText('Αριθμολαχείο')).toBeVisible()
    expect(within(members).queryByText('Zahlenziehung')).toBeNull()
    expect(screen.getByRole('button', { name: 'Greece' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(requested).toContain(
      `/api/v1/ontology/concepts/${NATIONAL_DRAW}/members?market=MKT_GR`,
    )
    await userEvent.click(screen.getByRole('button', { name: 'All markets' }))
    expect(await within(members).findByText('Zahlenziehung')).toBeVisible()
  })

  it('groups shared codes apart from the markets', async () => {
    stubOntology()
    renderAt('&concept=CONCEPT_DIGITAL_CHANNEL')
    const members = await screen.findByRole('region', {
      name: 'Local terms bound to it',
    })
    const shared = await within(members).findByRole('group', {
      name: 'Shared by every market',
    })
    expect(within(shared).getByText('Mobile application')).toBeVisible()
  })

  it('counts shared terms in the binding line and in the terms panel', async () => {
    stubOntology()
    renderAt('&concept=CONCEPT_PAYMENT_INCIDENT')
    const card = await screen.findByRole('region', { name: 'Concept' })
    expect(
      within(card).getByText(
        'Bound to 4 local terms across 4 markets and 1 shared by every market',
      ),
    ).toBeVisible()
    const shared = await screen.findByRole('group', {
      name: 'Shared by every market',
    })
    expect(within(shared).getByRole('heading')).toHaveTextContent(
      'Shared by every market1',
    )
  })

  it('says a concept bound only to shared codes is shared by every market', async () => {
    stubOntology()
    renderAt('&concept=CONCEPT_DIGITAL_CHANNEL')
    const card = await screen.findByRole('region', { name: 'Concept' })
    expect(
      within(card).getByText('Bound to 2 local terms shared by every market'),
    ).toBeVisible()
    expect(screen.queryByRole('group', { name: 'Show terms from' })).toBeNull()
  })

  it('keeps shared terms visible whichever market is chosen', async () => {
    const { requested } = stubOntology()
    renderAt('&concept=CONCEPT_PAYMENT_INCIDENT&market=MKT_GR')
    const members = await screen.findByRole('region', {
      name: 'Local terms bound to it',
    })
    const shared = await within(members).findByRole('group', {
      name: 'Shared by every market',
    })
    expect(shared).toBeVisible()
    expect(within(members).getByRole('group', { name: 'Greece' })).toBeVisible()
    expect(within(members).queryByRole('group', { name: 'Austria' })).toBeNull()
    expect(requested).toContain(
      '/api/v1/ontology/concepts/CONCEPT_PAYMENT_INCIDENT/members?market=MKT_GR',
    )
    expect(requested).toContain(
      '/api/v1/ontology/concepts/CONCEPT_PAYMENT_INCIDENT/members',
    )
  })

  it('asks only for the market when the concept has no shared terms', async () => {
    const { requested } = stubOntology()
    renderAt(`&concept=${NATIONAL_DRAW}&market=MKT_GR`)
    await screen.findByText('Αριθμολαχείο', { selector: 'span.font-medium' })
    // The label also shows on the concept card, so wait for the request itself.
    await waitFor(() =>
      expect(requested.filter((path) => path.includes('/members'))).toEqual([
        `/api/v1/ontology/concepts/${NATIONAL_DRAW}/members?market=MKT_GR`,
      ]),
    )
  })

  it('says so when a market has no terms bound to the concept', async () => {
    const { fetchMock } = stubOntology()
    const answer = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((input) =>
      String(input).includes('market=')
        ? Promise.resolve(json([]))
        : answer(input),
    )
    renderAt(`&concept=${NATIONAL_DRAW}&market=MKT_GR`)
    expect(
      await screen.findByText('No local terms from this market.'),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Greece' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('falls back to all markets when the address names a market the concept is not bound in', async () => {
    const { requested } = stubOntology()
    renderAt('&concept=CONCEPT_ANNUITY_DRAW&market=MKT_GR')
    expect(
      await screen.findByRole('button', { name: 'All markets' }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(
      await within(
        await screen.findByRole('region', { name: 'Local terms bound to it' }),
      ).findByText('Annuity Draw'),
    ).toBeVisible()
    expect(requested.filter((path) => path.includes('/members'))).toEqual([
      '/api/v1/ontology/concepts/CONCEPT_ANNUITY_DRAW/members',
    ])
  })

  it('says so when nothing is bound to a concept', async () => {
    stubOntology()
    renderAt('&concept=CONCEPT_LOTTERY_PRODUCT')
    expect(
      await screen.findByText('No local terms are bound directly.'),
    ).toBeVisible()
  })

  it('opens on the first concept when the address names none or an unknown one', async () => {
    stubOntology()
    renderAt('&concept=CONCEPT_NOPE')
    const tree = await screen.findByRole('tree', { name: 'Concepts' })
    expect(
      within(tree).getByRole('treeitem', { selected: true }),
    ).toHaveTextContent('Lottery product')
  })

  it('selects a concept by click and keeps it in the address', async () => {
    stubOntology()
    const { stop } = renderAt(`&concept=${NATIONAL_DRAW}`)
    await userEvent.click(
      await screen.findByRole('treeitem', { name: /Draw game/ }),
    )
    expect(window.location.hash).toBe(
      '#/data-model?tab=ontology&concept=CONCEPT_DRAW_GAME',
    )
    stop()
  })

  it('keeps the chosen market in the address and clears it for another concept', async () => {
    stubOntology()
    const { stop } = renderAt(`&concept=${NATIONAL_DRAW}`)
    await userEvent.click(
      await screen.findByRole('button', { name: 'Austria' }),
    )
    expect(window.location.hash).toBe(
      `#/data-model?tab=ontology&concept=${NATIONAL_DRAW}&market=MKT_AT`,
    )
    await userEvent.click(screen.getByRole('treeitem', { name: /Draw game/ }))
    expect(window.location.hash).toBe(
      '#/data-model?tab=ontology&concept=CONCEPT_DRAW_GAME',
    )
    stop()
  })

  it('shows a skeleton while loading', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => undefined)),
    )
    renderAt()
    expect(screen.getByRole('status')).toHaveTextContent('Loading Concepts')
  })

  it('says so when the ontology has no concepts', async () => {
    stubApi({ '/api/v1/ontology': { version: '2.0.0', concepts: [] } })
    renderAt()
    expect(await screen.findByText('None yet.')).toBeVisible()
  })

  it('shows the API error with a retry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(failure('The ontology is unavailable.', true)),
      ),
    )
    renderAt()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The ontology is unavailable.',
    )
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible()
  })

  it('shows an error for the bound terms alone when they cannot load', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        Promise.resolve(
          String(input).endsWith('/ontology')
            ? json(ONTOLOGY)
            : failure('The terms are unavailable.', true),
        ),
      ),
    )
    renderAt(`&concept=${NATIONAL_DRAW}`)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The terms are unavailable.',
    )
    expect(screen.getByRole('region', { name: 'Concept' })).toBeVisible()
  })

  it('follows a changed address to another concept', async () => {
    stubOntology()
    const { stop } = renderAt(`&concept=${NATIONAL_DRAW}`)
    await screen.findByRole('region', { name: 'Concept' })
    goTo('&concept=CONCEPT_QUICK_PICK')
    expect(await screen.findByText('Τυχαία επιλογή')).toBeVisible()
    stop()
  })
})
