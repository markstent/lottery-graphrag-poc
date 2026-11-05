import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SettingsProvider } from '../../app/settings'
import { stubApi } from '../../test/api-stub'
import { DATASET, DICTIONARY, SCHEMA, STATS } from './data-model.fixtures'
import { DataModel } from './data-model'
import { stubOntology } from './ontology.fixtures'

const ROUTES = {
  '/api/v1/datasets': [DATASET],
  '/api/v1/datasets/dev-seed2026/dictionary': DICTIONARY,
  '/api/v1/graph/schema': SCHEMA,
  '/api/v1/graph/stats': STATS,
  '/api/v1/data-model/example': { incident_id: null },
}

const renderAt = (hash: string) => {
  window.history.replaceState(null, '', `/${hash}`)
  return render(
    <SettingsProvider>
      <DataModel />
    </SettingsProvider>,
  )
}

afterEach(() => vi.unstubAllGlobals())

const current = (name: string) =>
  expect(screen.getByRole('link', { name })).toHaveAttribute(
    'aria-current',
    'page',
  )

describe('DataModel', () => {
  it('opens on the Overview tab, described by the destination purpose', async () => {
    stubApi(ROUTES)
    renderAt('#/data-model')
    expect(screen.getByRole('heading', { name: 'Data Model' })).toBeVisible()
    expect(
      screen.getByText(
        /What the warehouse, the graph and the ontology look like/,
      ),
    ).toBeVisible()
    current('Overview')
    expect(
      await screen.findByRole('region', { name: "The company's data" }),
    ).toBeVisible()
  })

  it('lists its five tabs, in order, as links that keep the tab in the address', () => {
    stubApi(ROUTES)
    renderAt('#/data-model')
    const nav = screen.getByRole('navigation', { name: 'Data Model sections' })
    const links = nav.querySelectorAll('a')
    expect(
      [...links].map((a) => [a.textContent, a.getAttribute('href')]),
    ).toEqual([
      ['Overview', '#/data-model?tab=overview'],
      ['Tables', '#/data-model?tab=tables'],
      ['Graph', '#/data-model?tab=graph'],
      ['Concepts', '#/data-model?tab=concepts'],
      ['Stories', '#/data-model?tab=stories'],
    ])
  })

  it('opens the tab the address names', async () => {
    stubApi(ROUTES)
    renderAt('#/data-model?tab=graph')
    expect(
      await screen.findByRole('button', { name: 'game, 120 records' }),
    ).toBeVisible()
    current('Graph')
    expect(screen.getByRole('link', { name: 'Overview' })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('falls back to the Overview for a tab it does not have', async () => {
    stubApi(ROUTES)
    renderAt('#/data-model?tab=nonsense')
    current('Overview')
    expect(
      await screen.findByRole('region', { name: "The company's data" }),
    ).toBeVisible()
  })

  it('opens Tables for the old warehouse address', async () => {
    stubApi(ROUTES)
    renderAt('#/data-model?tab=warehouse')
    current('Tables')
    expect(
      await screen.findByRole('heading', { name: '1 Choose a table' }),
    ).toBeVisible()
  })

  it('opens Concepts and Stories for the old ontology and scenarios addresses', async () => {
    stubOntology()
    renderAt('#/data-model?tab=ontology&concept=CONCEPT_NATIONAL_DRAW')
    expect((await screen.findAllByText('Αριθμολαχείο')).length).toBeGreaterThan(
      0,
    )
    current('Concepts')
    cleanup()
    renderAt('#/data-model?tab=scenarios')
    expect(await screen.findAllByRole('article')).toHaveLength(8)
    current('Stories')
  })

  it('opens the Concepts and Stories tabs by their own ids', async () => {
    stubOntology()
    renderAt('#/data-model?tab=concepts&concept=CONCEPT_NATIONAL_DRAW')
    expect((await screen.findAllByText('Αριθμολαχείο')).length).toBeGreaterThan(
      0,
    )
    current('Concepts')
    cleanup()
    renderAt('#/data-model?tab=stories')
    expect(await screen.findAllByRole('article')).toHaveLength(8)
    current('Stories')
  })
})
