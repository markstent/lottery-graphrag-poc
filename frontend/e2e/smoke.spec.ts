import { expect, test, type Page } from '@playwright/test'

import { h1, listRecordedQuestions } from './live-lab-fixtures'
import { expectNoUnmockedRequests, mockApi } from './mock-api'

/* The five destinations in order, with the sentence each is described by (spec 7.1). */
const DESTINATIONS = [
  {
    name: 'Overview',
    hash: '#/overview',
    purpose:
      'What we found, how the three approaches work, and questions to try',
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
      'What the warehouse, the graph and the ontology look like, how they fit together, and one real record followed through all three, with live counts',
  },
  {
    name: 'Architecture',
    hash: '#/architecture',
    purpose:
      'The tech stack: the data platform, the graph and ontology layers on top, and what each part runs on',
  },
  {
    name: 'Help',
    hash: '#/help',
    purpose:
      'How it works, every benchmark question with its answer key, glossary, how to run it',
  },
] as const

// A call the mock does not answer is refused; it must not go unnoticed.
test.afterEach(({ page }) => expectNoUnmockedRequests(page))

test('the sidebar lists the six destinations in order', async ({ page }) => {
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
    ['published', 'All runs'],
    ['official', 'Descriptive: not part of the tested family.'],
    ['none', 'No runs yet.'],
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
    ['official', 'Answer score by kind of question'],
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

test.describe('presentation mode on every destination', () => {
  const h1Size = (page: Page) =>
    page
      .getByRole('heading', { level: 1 })
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize))

  for (const { name, hash } of DESTINATIONS) {
    test(`${name} hides the navigation and enlarges the type`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1920, height: 1080 })
      await page.goto(`/${hash}`)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      const normal = await h1Size(page)
      await expect(
        page.getByRole('navigation', { name: 'Primary' }),
      ).toBeVisible()

      await page.goto(`/?present=1${hash}`)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expect(
        page.getByRole('navigation', { name: 'Primary' }),
      ).toHaveCount(0)
      expect(await h1Size(page)).toBeGreaterThan(normal)
    })
  }
})

test.describe('the approach diagrams in presentation mode', () => {
  for (const [hash, name] of [
    ['#/overview', 'How the three approaches differ'],
    // A, not C: beside Help's chapter list C is stacked at normal size, and a row only when presenting.
    ['#/help?section=approaches', /^A · Text search\./],
  ] as const) {
    test(`grow with the type scale on ${hash}`, async ({ page }) => {
      await page.setViewportSize({ width: 1920, height: 1080 })
      await mockApi(page)
      const height = async (url: string) => {
        await page.goto(url)
        const figure = page.getByRole('img', { name })
        await expect(figure).toBeVisible()
        return (await figure.boundingBox())!.height
      }
      const normal = await height(`/${hash}`)
      const presenting = await height(`/?present=1${hash}`)
      expect(presenting).toBeGreaterThan(normal * 1.05)
    })
  }
})

test('a recorded run plays to completion in Live Lab', async ({ page }) => {
  await mockApi(page)
  await listRecordedQuestions(page)
  await page.goto('/#/live-lab')
  await page.getByRole('button', { name: h1.question }).click()
  await page.getByRole('button', { name: 'Recorded run', exact: true }).click()
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  // Play it from the start at 4x, so the recording of about 71 s takes about 18 s.
  // The speed is set once the recording plays, so the click is not lost while it loads.
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()
  const fast = page.getByRole('button', { name: '4x', exact: true })
  await fast.click()
  await expect(fast).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Replay', exact: true }).click()
  await expect(fast).toHaveAttribute('aria-pressed', 'true')

  await expect(page.getByText('The run is complete.')).toBeVisible({
    timeout: 30_000,
  })
  for (const name of ['A · Text search', 'B · Graph', 'C · Graph + Ontology'])
    await expect(page.getByRole('region', { name, exact: true })).toContainText(
      'Done',
    )
  await expect(page.getByRole('region', { name: 'Scorecard' })).toBeVisible()
})

test('the sidebar stays in view when a long page is scrolled', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await mockApi(page)
  await page.goto('/#/help')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await expect(
    page.getByRole('button', { name: 'Collapse sidebar' }),
  ).toBeInViewport({ ratio: 1 })
  await expect(
    page.getByRole('navigation', { name: 'Primary' }),
  ).toBeInViewport({ ratio: 1 })
})

test('the tab icon loads, so the browser logs no missing file', async ({
  page,
}) => {
  await mockApi(page)
  const missing: string[] = []
  page.on('response', (response) => {
    if (response.status() === 404) missing.push(response.url())
  })
  await page.goto('/#/overview')
  const href = await page.locator('link[rel="icon"]').getAttribute('href')
  expect(href).toBe('/favicon.svg')
  const icon = await page.request.get(href ?? '')
  expect(icon.status()).toBe(200)
  expect(icon.headers()['content-type']).toContain('image/svg+xml')
  expect(missing).toEqual([])
})
