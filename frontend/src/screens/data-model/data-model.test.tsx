import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SettingsProvider } from '../../app/settings'
import { stubApi } from '../../test/api-stub'
import { DATASET, DICTIONARY, SCHEMA, STATS } from './data-model.fixtures'
import { DataModel } from './data-model'

const ROUTES = {
  '/api/v1/datasets': [DATASET],
  '/api/v1/datasets/dev-seed2026/dictionary': DICTIONARY,
  '/api/v1/graph/schema': SCHEMA,
  '/api/v1/graph/stats': STATS,
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

describe('DataModel', () => {
  it('opens on the Warehouse tab, described by the destination purpose', async () => {
    stubApi(ROUTES)
    renderAt('#/data-model')
    expect(screen.getByRole('heading', { name: 'Data Model' })).toBeVisible()
    expect(
      screen.getByText(
        /What the warehouse, the graph and the ontology look like/,
      ),
    ).toBeVisible()
    expect(
      await screen.findByRole('button', { name: 'games, 120 rows' }),
    ).toBeVisible()
    expect(screen.getByRole('link', { name: 'Warehouse' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('lists its tabs as links that keep the tab in the address', () => {
    stubApi(ROUTES)
    renderAt('#/data-model')
    const nav = screen.getByRole('navigation', { name: 'Data Model sections' })
    const links = nav.querySelectorAll('a')
    expect(
      [...links].map((a) => [a.textContent, a.getAttribute('href')]),
    ).toEqual([
      ['Warehouse', '#/data-model?tab=warehouse'],
      ['Graph', '#/data-model?tab=graph'],
    ])
  })

  it('opens the tab the address names', async () => {
    stubApi(ROUTES)
    renderAt('#/data-model?tab=graph')
    expect(
      await screen.findByRole('button', { name: 'game, 120 nodes' }),
    ).toBeVisible()
    expect(screen.getByRole('link', { name: 'Graph' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('link', { name: 'Warehouse' })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('falls back to the Warehouse for a tab it does not have', async () => {
    stubApi(ROUTES)
    renderAt('#/data-model?tab=ontology')
    expect(
      await screen.findByRole('button', { name: 'games, 120 rows' }),
    ).toBeVisible()
  })
})
