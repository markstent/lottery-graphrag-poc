import { expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'

import { mockApi, type LatestRun } from './mock-api'

/* Help in a browser, against the mock API. SHOTS=<dir> also saves pictures. */

test.use({ viewport: { width: 1920, height: 1080 } })

async function shot(page: Page, name: string) {
  const dir = process.env.SHOTS
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${dir}/${name}.png` })
}

async function open(page: Page, hash: string, latest: LatestRun = 'official') {
  await mockApi(page, 'published', latest)
  await page.goto(`/${hash}`)
  await expect(
    page.getByRole('table', { name: 'Benchmark questions' }),
  ).toBeVisible()
}

const SECTIONS = [
  ['what', 'What we are testing'],
  ['approaches', 'The three approaches'],
  ['data', 'The data'],
  ['stories', 'The planted stories'],
  ['questions', 'The questions'],
  ['scoring', 'How scoring works'],
  ['glossary', 'Glossary'],
  ['running', 'Running it'],
] as const

for (const [id, title] of SECTIONS) {
  test(`the ${id} section opens from its link`, async ({ page }) => {
    await open(page, `#/help?section=${id}`)
    const heading = page.getByRole('heading', {
      level: 2,
      name: new RegExp(title),
    })
    await expect(heading).toBeInViewport()
    await shot(page, `section-${id}`)
  })
}

test('the story link scrolls to the story and marks it', async ({ page }) => {
  await open(page, '#/help?section=stories&story=SCN-007')
  const card = page.getByRole('article', {
    name: 'Cross market platform incident',
  })
  await expect(card).toBeInViewport()
  await expect(card).toHaveAttribute('aria-current', 'true')
  await expect(card).toContainText('Worked example')
  await shot(page, 'story-worked-example')
})

test('the questions table filters by story, and the filter is in the address', async ({
  page,
}) => {
  await open(page, '#/help?section=questions&story=SCN-009')
  const table = page.getByRole('table', { name: 'Benchmark questions' })
  await expect(table.getByRole('row')).toHaveCount(3)
  await expect(table).toContainText('SUP_02027')
  await expect(table).toContainText('Evidence score')
  await page
    .getByRole('combobox', { name: 'Kind of question' })
    .selectOption('H5')
  await expect(page).toHaveURL(/section=questions&stratum=H5&story=SCN-009$/)
  await shot(page, 'questions-filtered-by-story')
})

test('with no official run the score column says so and shows no number', async ({
  page,
}) => {
  await open(page, '#/help?section=questions', 'none')
  const table = page.getByRole('table', { name: 'Benchmark questions' })
  await expect(table.getByText('No official run yet').first()).toBeVisible()
  await expect(table).not.toContainText('Evidence score')
  await expect(page.getByRole('link', { name: 'Go to Results' })).toBeVisible()
  await shot(page, 'questions-no-official-run')
})

test('the score column headings sit on one line each, with or without scores', async ({
  page,
}) => {
  for (const latest of ['none', 'official'] as const) {
    await open(page, '#/help?section=questions', latest)
    for (const name of ['A · Text search', 'B · Graph', 'C · Graph + Ontology'])
      expect(
        await page
          .getByRole('columnheader', { name })
          .evaluate((el) => el.getBoundingClientRect().height),
      ).toBeLessThan(40)
  }
})

test('a quick check as the newest run shows no scores either', async ({
  page,
}) => {
  await open(page, '#/help?section=questions', 'smoke')
  await expect(
    page
      .getByRole('table', { name: 'Benchmark questions' })
      .getByText('No official run yet')
      .first(),
  ).toBeVisible()
})

test('presentation mode keeps the table and the sections readable', async ({
  page,
}) => {
  await open(page, '?present=1#/help?section=questions&story=SCN-007')
  await expect(page.locator('html.presentation')).toHaveCount(1)
  await expect(
    page.getByRole('table', { name: 'Benchmark questions' }),
  ).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
  await shot(page, 'presentation-questions')
})

test('Help shows vendor names in Running it only', async ({ page }) => {
  await open(page, '#/help')
  const vendors = /Neo4j|Qdrant|Ollama/
  const text = await page.locator('#main').innerText()
  const running = await page.locator('#running').innerText()
  expect(running).toMatch(vendors)
  expect(text.replace(running, '')).not.toMatch(vendors)
})
