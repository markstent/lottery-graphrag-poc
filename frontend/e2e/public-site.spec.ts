import { expect, test } from '@playwright/test'

import { h1, listRecordedQuestions } from './live-lab-fixtures'
import { expectNoUnmockedRequests, mockApi, mockPublicSite } from './mock-api'

/* The public read-only site (D-117): everything live is greyed out and says
   why, and the recorded runs and published results stay fully usable. */

test.use({ viewport: { width: 1440, height: 900 } })

const LIVE_OFF =
  'Live answers are off on the public site. Pick a tested question above to replay its recorded run.'

let writes: string[]

test.beforeEach(async ({ page }) => {
  await mockApi(page)
  await listRecordedQuestions(page)
  writes = await mockPublicSite(page)
})

test.afterEach(({ page }) => {
  expectNoUnmockedRequests(page)
  expect(writes, 'writes the page tried').toEqual([])
})

test('the header reads Public read-only and says what that means', async ({
  page,
}) => {
  await page.goto('/#/overview')
  const status = page.getByRole('button', { name: 'Models: Public read-only' })
  await expect(status).toHaveText('Public read-only')
  await status.click()
  await expect(
    page.getByText(/This is the public read-only site/),
  ).toBeVisible()
  const checks = page.getByRole('list', { name: 'Readiness checks' })
  await expect(checks).toContainText('World data')
  await expect(checks).toContainText('Graph database')
})

test('Settings names the models and says they are off on the public site', async ({
  page,
}) => {
  await page.goto('/#/overview')
  await page.getByRole('button', { name: 'Settings' }).click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await expect(dialog.getByText('Off on the public site')).toHaveCount(4)
})

test('Live Lab greys out the live controls and replays a recorded run', async ({
  page,
}) => {
  await page.goto('/#/live-lab')
  const box = page.getByRole('textbox', { name: 'Or ask your own question' })
  await expect(box).toBeDisabled()
  await expect(page.getByText(LIVE_OFF)).toBeVisible()
  await expect(box).toHaveAccessibleDescription(LIVE_OFF)
  const source = page.getByRole('group', { name: 'Source' })
  await expect(source.getByRole('button', { name: 'Live' })).toBeDisabled()
  await expect(
    source.getByRole('button', { name: 'Recorded run' }),
  ).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: h1.question }).click()
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Timeline' })).toBeVisible()
  // Pause before seeking, as live-lab.spec.ts does: seeking while the replay
  // plays races its playback loop on a slow machine.
  await page.getByRole('button', { name: 'Pause' }).click()
  await page
    .getByRole('slider', { name: 'Position' })
    .fill(String(Math.ceil(h1.events.at(-1)!.t_ms - h1.events[0].t_ms)))
  await expect(
    page.getByRole('region', { name: 'C · Graph + Ontology', exact: true }),
  ).toContainText('Done')
})

test('Results greys out Start a run and says why, and still shows the runs', async ({
  page,
}) => {
  await page.goto('/#/results')
  // The published run's charts still draw.
  await expect(page.locator('[data-bar]').first()).toBeVisible()
  const start = page.getByRole('button', { name: 'Start a run' })
  await expect(start).toBeDisabled()
  await expect(start).toHaveAccessibleDescription(
    'Runs cannot be started on the public site.',
  )
  await expect(
    page.getByText('Runs cannot be started on the public site.'),
  ).toBeVisible()
})
