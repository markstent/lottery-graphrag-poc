import { expect, test, type Locator, type Page } from '@playwright/test'

import { mockApi } from './mock-api'

/**
 * Visual regression baselines for the foundation. Run locally only:
 *   pnpm e2e:visual --update-snapshots
 * Fonts differ across platforms, so this project is excluded from CI.
 *
 * Two kinds of baseline. The shell is baselined around each destination with
 * the view's own content hidden, because the views are rebuilt in Phase 6.
 * Every primitive in every state is baselined from the development gallery
 * (src/dev/gallery.tsx), one image per state.
 */

test.use({
  viewport: { width: 1920, height: 1080 },
  reducedMotion: 'reduce',
})

test.beforeEach(async ({ page }) => {
  await mockApi(page)
})

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(250)
}

/**
 * The shell with the view's own content hidden, once the header has its data.
 * Hidden rather than masked, so a drawer or menu over the content is not
 * painted over.
 */
async function shellShot(page: Page, name: string) {
  await expect(
    page.getByRole('banner').getByText('dev world, 2026'),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Models: Ready' }),
  ).toBeVisible()
  await page.addStyleTag({
    content: '#main, #main * { visibility: hidden !important }',
  })
  await settle(page)
  await expect(page).toHaveScreenshot(name)
}

const DESTINATIONS = [
  ['overview', 'Overview'],
  ['live-lab', 'Live Lab'],
  ['results', 'Results'],
  ['data-model', 'Data Model'],
  ['help', 'Help'],
] as const

test.describe('shell', () => {
  for (const [route] of DESTINATIONS) {
    test(`on ${route}`, async ({ page }) => {
      await page.goto(`/#/${route}`)
      await shellShot(page, `shell-${route}.png`)
    })
  }

  test('with the sidebar collapsed', async ({ page }) => {
    await page.goto('/#/overview')
    await page.getByRole('button', { name: 'Collapse sidebar' }).click()
    await shellShot(page, 'shell-collapsed.png')
  })

  test('with the model status open', async ({ page }) => {
    await page.goto('/#/overview')
    await page.getByRole('button', { name: 'Models: Ready' }).click()
    await expect(
      page.getByRole('list', { name: 'Readiness checks' }),
    ).toBeVisible()
    await shellShot(page, 'shell-model-status.png')
  })

  test('with Settings open', async ({ page }) => {
    await page.goto('/#/overview')
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(page.getByText('Ontology version')).toBeVisible()
    await shellShot(page, 'shell-settings.png')
  })

  test('with the evidence drawer open', async ({ page }) => {
    await page.goto('/#/__graph?shell=1&evidence=1')
    await page.locator('[data-node-id]').first().click()
    await expect(page.getByRole('dialog', { name: 'Evidence' })).toBeVisible()
    await expect(page.getByText('Payment outage')).toBeVisible()
    await shellShot(page, 'shell-evidence-drawer.png')
  })

  test('in presentation mode', async ({ page }) => {
    await page.goto('/?present=1#/overview')
    await expect(
      page.getByRole('button', { name: 'Presentation mode' }),
    ).toHaveAttribute('aria-pressed', 'true')
    await shellShot(page, 'shell-presentation.png')
  })
})

/** What to do to a block before it is photographed, where drawing it is not enough. */
const PREPARE: Record<string, (block: Locator) => Promise<void>> = {
  'chart-grouped-bars-table': showAsTable,
  'chart-interval-plot-table': showAsTable,
  'chart-grouped-bars-tooltip': hoverFirstMark,
  'chart-interval-plot-tooltip': hoverFirstMark,
}

async function showAsTable(block: Locator) {
  await block.getByRole('button', { name: 'Show as table' }).click()
  await expect(block.getByRole('table')).toBeVisible()
}

async function hoverFirstMark(block: Locator) {
  await block.locator('[data-mark="hit"]').nth(2).hover()
  await expect(block.getByRole('tooltip')).toBeVisible()
}

const SECTIONS = [
  'tokens',
  'evidence-states',
  'charts',
  'panel',
  'graph',
  'paths',
] as const

test.describe('gallery', () => {
  for (const section of SECTIONS) {
    test(`section ${section}`, async ({ page }) => {
      await page.goto(`/#/__gallery?section=${section}`)
      const blocks = page.locator('[data-gallery]')
      await expect(blocks.first()).toBeVisible()
      if (section === 'graph')
        await expect(page.locator('[data-node-id]').first()).toBeVisible()
      await settle(page)
      if (section === 'graph') await page.waitForTimeout(1500)
      const ids = await blocks.evaluateAll((els) =>
        els.map((el) => el.getAttribute('data-gallery')!),
      )
      expect(ids.length).toBeGreaterThan(0)
      for (const id of ids) {
        const block = page.locator(`[data-gallery="${id}"]`)
        await block.scrollIntoViewIfNeeded()
        await PREPARE[id]?.(block)
        await expect(block).toHaveScreenshot(`gallery-${id}.png`)
        // Move off the block so a tooltip does not carry to the next one.
        await page.mouse.move(0, 0)
      }
    })
  }

  const DRAWERS = [
    ['settings', 'Open Settings', 'Ontology version'],
    ['plain', 'Open a plain drawer', 'Drawer text.'],
    ['evidence', 'Open evidence, ready', 'Payment outage'],
    ['evidence-loading', 'Open evidence, loading', 'Loading Record'],
    ['evidence-error', 'Open evidence, error', 'The graph is not answering.'],
    [
      'evidence-no-source',
      'Open evidence, without a source record',
      'This node has no source record.',
    ],
  ] as const
  for (const [id, button, text] of DRAWERS) {
    test(`drawer ${id}`, async ({ page }) => {
      await page.goto('/#/__gallery?section=drawers')
      await page.getByRole('button', { name: button }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await expect(page.getByRole('dialog').getByText(text)).toBeAttached()
      await settle(page)
      await expect(page).toHaveScreenshot(`gallery-drawer-${id}.png`)
    })
  }
})
