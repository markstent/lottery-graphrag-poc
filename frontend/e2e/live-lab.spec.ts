import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, readdirSync, readFileSync } from 'node:fs'

import cancelled from '../src/run/fixtures/run-cancelled.json' with { type: 'json' }
import live from '../src/run/fixtures/run-abc.json' with { type: 'json' }
import { mockApi } from './mock-api'

/* Live Lab in a browser: a recording through the replay clock, and a live run
   whose stream is served from a captured run. SHOTS=<dir> also saves pictures. */

test.use({ viewport: { width: 1920, height: 1080 } })

const RECORDED_DIR = 'src/run/fixtures/recorded'
const RECORDED_RUNS: {
  instance_id: string
  question: string
  stratum: string
  events: { t_ms: number }[]
}[] = readdirSync(RECORDED_DIR).map((file) =>
  JSON.parse(readFileSync(`${RECORDED_DIR}/${file}`, 'utf8')),
)
const h1 = RECORDED_RUNS.find((run) => run.stratum === 'H1')!
const QUESTIONS = RECORDED_RUNS.map((run) => ({
  instance_id: run.instance_id,
  question_id: run.instance_id.slice(0, 3),
  text: run.question,
  stratum: run.stratum,
  market_scope: [],
}))

async function shot(page: Page, name: string) {
  const dir = process.env.SHOTS
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true })
}

/** The captured events as one finished event stream. */
const sse = (events: { sequence: number; event_type: string }[]) =>
  events
    .map(
      (event) =>
        `id: ${event.sequence}\nevent: ${event.event_type}\ndata: ${JSON.stringify(event)}\n\n`,
    )
    .join('')

async function serveLiveRun(page: Page, events: typeof live.events) {
  await page.route('**/api/v1/queries', (route) =>
    route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ run_id: 'RUN-E2E' }),
    }),
  )
  await page.route('**/api/v1/queries/RUN-E2E/events/stream*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: sse(events),
    }),
  )
}

test.beforeEach(async ({ page }) => {
  await mockApi(page)
  await page.route('**/api/v1/demo/questions', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(QUESTIONS),
    }),
  )
})

test('plays a recording, pauses it and scrubs through it', async ({ page }) => {
  await page.goto(`/#/live-lab?question=${h1.instance_id}`)
  await expect(page.getByRole('region', { name: 'Timeline' })).toBeVisible()
  await page.getByRole('button', { name: 'Pause' }).click()
  const duration = Math.round(h1.events.at(-1)!.t_ms - h1.events[0].t_ms)
  await page
    .getByRole('slider', { name: 'Position' })
    .fill(String(Math.round(duration * 0.55)))
  await expect(
    page
      .getByRole('region', { name: 'B · Graph' })
      .getByRole('listitem')
      .first(),
  ).toBeVisible()
  await shot(page, 'recorded-mid')
  await page.getByRole('slider', { name: 'Position' }).fill(String(duration))
  await expect(
    page.getByRole('region', { name: 'C · Graph + Ontology' }),
  ).toContainText('Done')
  await shot(page, 'recorded-end')
})

test('follows a live run and offers the timeline when it ends', async ({
  page,
}) => {
  await serveLiveRun(page, live.events)
  await page.goto('/#/live-lab')
  await page.getByRole('button', { name: h1.question }).click()
  await page.getByRole('button', { name: 'Live', exact: true }).click()
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByText('The run is complete.')).toBeVisible()
  await expect(page.getByRole('slider', { name: 'Position' })).toBeEnabled()
})

test('shows a cancelled run as it was recorded, with no score', async ({
  page,
}) => {
  await serveLiveRun(page, cancelled.events as unknown as typeof live.events)
  await page.goto('/#/live-lab')
  await page.getByRole('button', { name: h1.question }).click()
  await page.getByRole('button', { name: 'Live', exact: true }).click()
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByText('The run was cancelled.')).toBeVisible()
  await expect(page.getByRole('region', { name: 'B · Graph' })).toContainText(
    'Cancelled before it finished.',
  )
  await expect(
    page.getByRole('region', { name: 'C · Graph + Ontology' }),
  ).toContainText('Not started: the run ended first.')
  await expect(page.getByRole('region', { name: /score/i })).toHaveCount(0)
  await shot(page, 'cancelled')
})

test('says why a run could not start and offers a retry', async ({ page }) => {
  await page.route('**/api/v1/queries', (route) =>
    route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          error_code: 'CONFLICT',
          message: 'Another run is using the graph.',
          retryable: true,
        },
      }),
    }),
  )
  await page.goto('/#/live-lab')
  await page.getByRole('button', { name: h1.question }).click()
  await page.getByRole('button', { name: 'Live', exact: true }).click()
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  const alert = page.getByRole('alert')
  await expect(alert).toContainText('Another run is using the graph.')
  await expect(alert.getByRole('button', { name: 'Retry' })).toBeVisible()
  await shot(page, 'error')
})

test('presentation mode hides the navigation and keeps the timeline keys', async ({
  page,
}) => {
  await page.goto(`/?present=1#/live-lab?question=${h1.instance_id}`)
  await expect(page.getByRole('navigation', { name: 'Primary' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.keyboard.press('r')
  await expect(page.getByRole('slider', { name: 'Position' })).toHaveValue('0')
  await shot(page, 'presentation')
})
