import { expect, test } from '@playwright/test'

import { mockApi } from './mock-api'

/* The five destinations in order, with the sentence each is described by (spec 7.1). */
const DESTINATIONS = [
  {
    name: 'Overview',
    hash: '#/overview',
    purpose:
      'The verdict from the latest official run, how the three approaches differ, and a button to run a question',
  },
  {
    name: 'Live Lab',
    hash: '#/live-lab',
    purpose:
      'Run one question through all three approaches and watch them work',
  },
  {
    name: 'Results',
    hash: '#/results',
    purpose: 'Every official run, every question, every score, with intervals',
  },
  {
    name: 'Data Model',
    hash: '#/data-model',
    purpose:
      'What the warehouse, the graph and the ontology look like, with live counts and sample rows',
  },
  {
    name: 'Help',
    hash: '#/help',
    purpose:
      'How it works in plain language, every benchmark question with its answer key, glossary, how to run it',
  },
] as const

test('the sidebar lists the five destinations in order', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Semantic Context Lab')).toBeVisible()
  const links = page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('link')
  await expect(links).toHaveText(DESTINATIONS.map(({ name }) => name))
})

test('the bare address opens Overview', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/#\/overview$/)
  await expect(
    page.getByRole('link', { name: 'Overview', exact: true }),
  ).toHaveAttribute('aria-current', 'page')
})

for (const { name, hash, purpose } of DESTINATIONS) {
  test(`${name} opens from its link and is described by its purpose`, async ({
    page,
  }) => {
    await page.goto('/')
    const link = page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('link', { name, exact: true })
    await expect(link).toHaveAccessibleDescription(purpose)
    await expect(link).toHaveAttribute('title', purpose)
    await link.click()
    await expect(page).toHaveURL(new RegExp(`${hash}$`))
    await expect(link).toHaveAttribute('aria-current', 'page')
  })
}

test('a destination whose chunk fails to load shows a message and keeps the shell', async ({
  page,
}) => {
  await page.route('**/assets/help-*.js', (route) => route.abort())
  await page.goto('/')
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('link', { name: 'Help', exact: true })
    .click()
  await expect(page.getByRole('alert')).toContainText(
    'This page could not be loaded.',
  )
  await expect(page.getByRole('button', { name: 'Reload page' })).toBeVisible()
  await expect(page.getByText('Semantic Context Lab')).toBeVisible()
  // Another destination still opens.
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('link', { name: 'Data Model', exact: true })
    .click()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test.describe('Results run list', () => {
  const RUN_LIST = [
    ['published', 'Reproducibility record (JSON)'],
    ['none', 'No benchmark runs yet.'],
    ['unavailable', 'The run list is unavailable.'],
  ] as const
  for (const [runs, text] of RUN_LIST) {
    test(`shows the ${runs} state`, async ({ page }) => {
      await mockApi(page, runs)
      await page.goto('/#/results')
      await expect(page.getByText(text).first()).toBeVisible()
    })
  }
})

test.describe('Overview latest run', () => {
  const LATEST = [
    ['official', 'Intervals are given for the differences in the headlines.'],
    ['smoke', 'Latest run: scorer smoke test'],
    ['none', 'No official run yet'],
    ['unavailable', 'The latest run is unavailable.'],
  ] as const
  for (const [latest, text] of LATEST) {
    test(`shows the ${latest} state`, async ({ page }) => {
      await mockApi(page, 'published', latest)
      await page.goto('/#/overview')
      await expect(page.getByText(text).first()).toBeVisible()
    })
  }
})
