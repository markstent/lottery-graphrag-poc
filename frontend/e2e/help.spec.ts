import { expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'

import { expectNoUnmockedRequests, mockApi, type LatestRun } from './mock-api'

/* Help in a browser, against the mock API. SHOTS=<dir> also saves pictures. */

test.use({ viewport: { width: 1920, height: 1080 } })

// A call the mock does not answer is refused; it must not go unnoticed.
test.afterEach(({ page }) => expectNoUnmockedRequests(page))

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
  ['what', '1. Why this exists'],
  ['data', '2. The made-up company'],
  ['stories', '3. The planted stories'],
  ['approaches', '4. The three approaches'],
  ['scoring', '7. How scoring works'],
  ['questions', '10. The questions'],
  ['glossary', '11. Glossary'],
  ['running', '12. Running it'],
  ['lessons', '13. What the results teach'],
] as const

for (const [id, title] of SECTIONS) {
  test(`the ${id} link opens its chapter`, async ({ page }) => {
    await open(page, `#/help?section=${id}`)
    const heading = page.getByRole('heading', { level: 2, name: title })
    await expect(heading).toBeInViewport()
    await shot(page, `section-${id}`)
  })
}

test('Overview links to chapter 13, which shows the kinds of question and, at Technical, every question', async ({
  page,
}) => {
  await mockApi(page, 'published', 'official')
  await page.goto('/#/')
  await page.getByRole('link', { name: 'what the results teach' }).click()
  await expect(page).toHaveURL(/#\/help\?section=lessons$/)
  const chapter = page.locator('#lessons')
  await expect(
    chapter.getByRole('heading', {
      level: 2,
      name: '13. What the results teach',
    }),
  ).toBeInViewport()
  const kinds = chapter.getByRole('table', {
    name: 'Which approach did best, by kind of question',
  })
  await expect(
    kinds.getByRole('row', { name: /^Multi-hop questions/ }),
  ).toContainText('43%, 65%, 64%')
  await expect(
    chapter.getByRole('table', { name: 'Means for each question' }),
  ).toHaveCount(0)
  await shot(page, 'lessons')

  await page.getByRole('radio', { name: 'Technical' }).click()
  await expect(
    chapter
      .getByRole('table', { name: 'Means for each question' })
      .getByRole('row'),
  ).toHaveCount(23)
})

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

test('the story cards tell each story in plain words, and the hidden truth with its codes at Technical', async ({
  page,
}) => {
  await open(page, '#/help?section=stories')
  const cards = page.locator('#stories article')
  await expect(cards).toHaveCount(8)
  for (const card of await cards.all()) {
    // At Plain a card names no dataset code outside the worked example's question and answer key.
    const own = await card.evaluate((element) => {
      const copy = element.cloneNode(true) as HTMLElement
      copy.querySelectorAll('dd').forEach((node) => node.remove())
      return copy.textContent ?? ''
    })
    expect(own).not.toMatch(/\b[A-Z]{2,}_[A-Z0-9_]+\b|SCN-\d/)
  }
  const worked = page.getByRole('article', {
    name: 'Cross market platform incident',
  })
  await expect(worked).toContainText('Greece, the main market affected')
  await expect(worked).not.toContainText('Hidden truth')
  await shot(page, 'stories-plain')
  await page.getByRole('radio', { name: 'Technical' }).click()
  await expect(worked).toContainText('SCN-007')
  await expect(worked).toContainText('Hidden truth: Platform version')
  await shot(page, 'stories-technical')
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

test('with no official run the screen says so above the table, which has no score columns', async ({
  page,
}) => {
  await open(page, '#/help?section=questions', 'none')
  const table = page.getByRole('table', { name: 'Benchmark questions' })
  await expect(page.getByText(/^No official run yet\./)).toBeVisible()
  await expect(table.getByRole('columnheader')).toHaveText([
    'Question',
    'Answer key',
  ])
  await expect(table).not.toContainText('Evidence score')
  await expect(page.getByRole('link', { name: 'Go to Results' })).toBeVisible()
  await shot(page, 'questions-no-official-run')
})

test('the score column headings sit on one line each', async ({ page }) => {
  await open(page, '#/help?section=questions', 'official')
  for (const name of ['A · Text search', 'B · Graph', 'C · Graph + Ontology'])
    expect(
      await page
        .getByRole('columnheader', { name })
        .evaluate((el) => el.getBoundingClientRect().height),
    ).toBeLessThan(40)
})

test('a quick check as the newest run shows no scores either', async ({
  page,
}) => {
  await open(page, '#/help?section=questions', 'smoke')
  await expect(page.getByText(/^No official run yet\./)).toBeVisible()
  await expect(
    page
      .getByRole('table', { name: 'Benchmark questions' })
      .getByRole('columnheader'),
  ).toHaveText(['Question', 'Answer key'])
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

test('the level switch shows the technical detail and keeps the chapter in view', async ({
  page,
}) => {
  await open(page, '#/help?section=scoring')
  const heading = page.getByRole('heading', {
    level: 2,
    name: '7. How scoring works',
  })
  await expect(heading).toBeInViewport()
  await expect(
    page.getByRole('heading', { name: 'Technical detail' }),
  ).toHaveCount(0)
  await page.getByRole('radio', { name: 'Technical' }).click()
  await expect(page).toHaveURL(/level=technical$/)
  await expect(
    page.getByRole('heading', { name: 'Technical detail' }),
  ).not.toHaveCount(0)
  await expect(heading).toBeInViewport()
  await shot(page, 'technical-level')
  await page.reload()
  await expect(page.getByRole('radio', { name: 'Technical' })).toBeChecked()
})

test('the settings table shows the settings now and Not recorded for a run without them', async ({
  page,
}) => {
  await open(page, '#/help?section=running&level=technical')
  const row = page.locator('#running').getByRole('row', { name: /^top_k/ })
  await expect(row).toContainText('40')
  await expect(row).toContainText('Not recorded')
  await shot(page, 'running-settings')
})

test('chapter 5 draws and states its budget from the settings', async ({
  page,
}) => {
  await open(page, '#/help?section=evidence')
  const chapter = page.locator('#evidence')
  await expect(chapter).toContainText('a budget of 2,000 tokens')
  await expect(chapter).toContainText(
    'There is no other limit on the number of pieces',
  )
  await expect(
    chapter.getByRole('img', { name: /one budget of 2,000 tokens/ }),
  ).toBeVisible()
  await shot(page, 'evidence-plain')
  await page.getByRole('radio', { name: 'Technical' }).click()
  await expect(chapter).toContainText('until the 2,000-token budget is full')
  await expect(chapter).toContainText('a Jaccard index of 0.85 or more')
  await shot(page, 'evidence-technical')
})

// The app is built for 16:9 screens and has no phone layout; at half that width
// and at tablet width, beside the sidebar, the diagrams must stay whole and readable.
for (const width of [960, 768])
  test(`the diagrams fit a column ${width} pixels wide, with their text still legible`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1080 })
    await open(page, '#/help?section=approaches')
    for (const name of [/^A · /, /^B · /, /^C · /, /^How evidence is chosen/]) {
      const picture = page.getByRole('img', { name })
      await expect(picture).toBeVisible()
      const fit = await picture.evaluate((element) => {
        const svg = [...element.querySelectorAll('svg')].find(
          (drawing) => drawing.getBoundingClientRect().width > 0,
        )!
        const box = svg.getBoundingClientRect()
        const panel = element.closest('section')!.getBoundingClientRect()
        // Text is drawn at 14 units, so this is the size of a 14 px label on screen.
        const text = (14 * box.width) / svg.viewBox.baseVal.width
        return {
          inside: box.left >= panel.left && box.right <= panel.right,
          text,
        }
      })
      expect(fit.inside).toBe(true)
      expect(fit.text).toBeGreaterThanOrEqual(11)
    }
    await shot(page, `approaches-${width}`)
  })

test('Help names vendors at the Technical level only', async ({ page }) => {
  const vendors = /Neo4j|Qdrant|Ollama/
  await open(page, '#/help')
  expect(await page.locator('#main').innerText()).not.toMatch(vendors)
  await open(page, '#/help?level=technical')
  expect(await page.locator('#running').innerText()).toMatch(vendors)
})

test.describe('at phone width', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  for (const [name, hash] of [
    ['top', '#/help'],
    ['limits-technical', '#/help?section=limits&level=technical'],
    ['register', '#/help?section=limits'],
    ['running-technical', '#/help?section=running&level=technical'],
    ['lessons-technical', '#/help?section=lessons&level=technical'],
  ] as const)
    test(`${name} fits the page, and wide tables scroll inside their own box`, async ({
      page,
    }) => {
      await open(page, hash)
      await shot(page, `phone-${name}`)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true)
      // Every table box that scrolls can take focus.
      for (const box of await page
        .locator('[role="group"].overflow-x-auto')
        .all())
        if (await box.evaluate((el) => el.scrollWidth > el.clientWidth))
          await expect(box).toHaveAttribute('tabindex', '0')
      expect(
        await page
          .getByRole('navigation', { name: 'Primary' })
          .evaluate((nav) => nav.getBoundingClientRect().width),
      ).toBeLessThan(100)
    })
})
