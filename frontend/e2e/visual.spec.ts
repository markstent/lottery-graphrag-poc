import { expect, test } from '@playwright/test'

/**
 * Visual regression baselines (docs/08 Phase 7). Run locally only:
 *   pnpm e2e:visual -- --update-snapshots
 * Committed baselines are the HITL-07 approved screenshots. Fonts differ
 * across platforms, so this project is excluded from CI.
 */

test.use({ viewport: { width: 1920, height: 1080 } })

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
})

test('live lab idle', async ({ page }) => {
  await page.goto('/#/lab')
  await expect(page.getByRole('button', { name: 'Run' })).toBeVisible()
  await expect(page).toHaveScreenshot('lab-idle.png', { fullPage: true })
})

test('live lab completed run with score strip', async ({ page }) => {
  await page.goto('/#/lab')
  await page.getByRole('button', { name: 'Run' }).click()
  await expect(
    page.getByRole('region', { name: 'Evaluation scores' }),
  ).toBeVisible()
  await expect(page).toHaveScreenshot('lab-completed.png', { fullPage: true })
})

test('evidence explorer', async ({ page }) => {
  await page.goto('/#/evidence?run=RUN-2026-10-07-01&evidence=INC_S007_GR')
  await expect(
    page.getByRole('heading', { name: 'Evidence Explorer' }),
  ).toBeVisible()
  await expect(page).toHaveScreenshot('evidence.png', { fullPage: true })
})

test('results dashboard', async ({ page }) => {
  await page.goto('/#/results')
  await expect(
    page.getByRole('heading', { name: 'Results Dashboard' }),
  ).toBeVisible()
  await expect(page).toHaveScreenshot('results.png', { fullPage: true })
})

test('semantic layer', async ({ page }) => {
  await page.goto('/#/semantic')
  await expect(
    page.getByRole('heading', {
      name: 'How raw tables & documents become connected graph concepts',
    }),
  ).toBeVisible()
  await expect(page).toHaveScreenshot('semantic.png', { fullPage: true })
})

test('help', async ({ page }) => {
  await page.goto('/#/help')
  await expect(
    page.getByRole('heading', {
      name: 'How the Semantic Context Lab works',
      level: 1,
    }),
  ).toBeVisible()
  await expect(page).toHaveScreenshot('help.png', { fullPage: true })
})

test('help graph diagram', async ({ page }) => {
  await page.goto('/#/help')
  await page.getByRole('tab', { name: '2 · Concrete Data Example' }).click()
  const diagram = page.getByLabel(
    'Diagram of one graph neighbourhood around incident INC_S007_GR',
  )
  await expect(diagram).toBeVisible()
  await diagram.scrollIntoViewIfNeeded()
  await expect(diagram).toHaveScreenshot('help-graph-diagram.png')
})

test('data dictionary', async ({ page }) => {
  await page.goto('/#/dictionary')
  await expect(
    page.getByRole('heading', {
      name: 'Inspect the synthetic enterprise data, graph and ontology',
      level: 1,
    }),
  ).toBeVisible()
  await expect(page).toHaveScreenshot('dictionary.png', { fullPage: true })
})
