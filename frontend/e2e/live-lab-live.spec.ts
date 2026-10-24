import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type Request,
} from '@playwright/test'

import { sse } from './live-lab-fixtures'

/*
 * Live Lab against the real backend and the dev world. It never runs in CI:
 *
 *   cd backend && GENERATION_PROVIDER=fake uv run uvicorn app.main:app --port 8000
 *   cd frontend && LIVE_WORLD_E2E=1 node node_modules/@playwright/test/cli.js test e2e/live-lab-live.spec.ts
 *
 * The preview server proxies /api to port 8000 (vite.config.ts). The fake
 * generator keeps the run offline, but the run is real: embedding, search and
 * graph traversal all happen, and the graph is only read, never ingested.
 * The backend lets one run use the graph at a time, so the tests run in order.
 */

test.skip(
  !process.env.LIVE_WORLD_E2E,
  'LIVE_WORLD_E2E is not set: this spec needs the backend on port 8000 and the dev world',
)

test.describe.configure({ mode: 'serial' })
test.use({ viewport: { width: 1920, height: 1080 } })
// A live run takes about 20 s, and the tests below also wait for scoring.
test.setTimeout(120_000)

const RUN_TIMEOUT = 90_000

const PANELS = ['A · Text search', 'B · Graph', 'C · Graph + Ontology'] as const
const PIPELINE_IDS = ['A', 'B', 'C'] as const
const STATUS_WORDS = {
  completed: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
} as const

interface StoredRun {
  status: string
  pipeline_status: Record<string, keyof typeof STATUS_WORDS>
  [key: string]: unknown
}
interface StoredEvent {
  sequence: number
  event_type: string
  [key: string]: unknown
}

/** The bank's H1 question, as the real API lists it. */
async function h1Question(page: Page) {
  const response = await page.request.get('/api/v1/demo/questions')
  expect(response.ok()).toBe(true)
  const questions: { stratum: string; text: string }[] = await response.json()
  const question = questions.find((q) => q.stratum === 'H1')
  expect(question, 'the bank has an H1 question').toBeDefined()
  return question!.text
}

/** Chooses the question, picks Live and presses Run; resolves to the run id the API gave. */
async function startLiveRun(page: Page, question: string) {
  await page.goto('/#/live-lab')
  await expect(page.getByRole('button', { name: 'Models: Ready' })).toBeVisible(
    { timeout: 30_000 },
  )
  await page.getByRole('button', { name: question }).click()
  await page.getByRole('button', { name: 'Live', exact: true }).click()
  const started = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/v1/queries' &&
      response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  const response = await started
  expect(response.status()).toBe(202)
  return ((await response.json()) as { run_id: string }).run_id
}

/** The run has ended and its score has been written, so the scorecard says what it is scored against. */
async function expectFinishedAndScored(page: Page) {
  await expect(page.getByText('The run is complete.')).toBeVisible({
    timeout: RUN_TIMEOUT,
  })
  await expect(page.getByText('scored against the answer key')).toBeVisible({
    timeout: 30_000,
  })
}

/** What the stored run and its stored events say. */
async function stored(page: Page, runId: string) {
  const run = await page.request.get(`/api/v1/queries/${runId}`)
  const events = await page.request.get(`/api/v1/queries/${runId}/events`)
  expect(run.ok() && events.ok()).toBe(true)
  return {
    run: (await run.json()) as StoredRun,
    events: ((await events.json()) as { events: StoredEvent[] }).events,
  }
}

/** The screen state a run ends in: the columns, the scorecard, the evidence paths and the coverage. */
async function endState(page: Page) {
  const text = (locator: ReturnType<Page['getByRole']>) => locator.innerText()
  return {
    columns: await Promise.all(
      PANELS.map((name) =>
        text(page.getByRole('region', { name, exact: true })),
      ),
    ),
    scorecard: await text(page.getByRole('region', { name: 'Scorecard' })),
    answers: await Promise.all(
      PANELS.map((name) =>
        text(page.getByRole('region', { name: `${name} answer` })),
      ),
    ),
    coverage: await text(page.getByRole('table', { name: 'Market coverage' })),
  }
}

/**
 * The stored events of a run, played to a second page as a live stream, with
 * the stored results behind it: the app's own reduction of what the server
 * kept. Resolves to that page's end state.
 */
async function endStateOfStoredEvents(
  context: BrowserContext,
  question: string,
  { run, events }: Awaited<ReturnType<typeof stored>>,
  results: unknown,
) {
  const page = await context.newPage()
  try {
    await page.route('**/api/v1/queries', (route) =>
      route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ run_id: run.run_id }),
      }),
    )
    await page.route(`**/api/v1/queries/${run.run_id}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(results),
      }),
    )
    await page.route(
      `**/api/v1/queries/${run.run_id}/events/stream*`,
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: sse(events),
        }),
    )
    await page.goto('/#/live-lab')
    await expect(
      page.getByRole('button', { name: 'Models: Ready' }),
    ).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: question }).click()
    await page.getByRole('button', { name: 'Live', exact: true }).click()
    await page.getByRole('button', { name: 'Run', exact: true }).click()
    await expectFinishedAndScored(page)
    return await endState(page)
  } finally {
    await page.close()
  }
}

test('a live run against the real backend streams to completion', async ({
  page,
}) => {
  const runId = await startLiveRun(page, await h1Question(page))
  await expectFinishedAndScored(page)

  // Every pipeline ends in the status the server recorded for it.
  const { run, events } = await stored(page, runId)
  expect(run.status).toBe('completed')
  for (const [index, id] of PIPELINE_IDS.entries()) {
    const recorded = run.pipeline_status[id]
    expect(recorded, `pipeline ${id} has a recorded status`).toBeDefined()
    await expect(
      page.getByRole('region', { name: PANELS[index], exact: true }),
    ).toContainText(STATUS_WORDS[recorded])
  }
  expect(events.at(-1)?.event_type).toBe('run.completed')
  // The finished run can be scrubbed.
  await expect(page.getByRole('slider', { name: 'Position' })).toBeEnabled()
})

/** How many events of the real stream the first connection delivers before it drops. */
const EVENTS_BEFORE_DROP = 120

/**
 * Drops the stream of a real run part of the way through. The first
 * connection carries the real stream up to that many events and then ends,
 * as a connection lost mid-run does. The browser's own retry is answered with
 * a 503, so it gives up on that connection and the app opens a new one after
 * the last event it has. Every later connection goes to the backend as it is.
 */
async function dropStreamOnce(page: Page) {
  let connections = 0
  await page.route('**/api/v1/queries/*/events/stream*', async (route) => {
    connections += 1
    if (connections === 2)
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            error_code: 'RUN_ERROR',
            message: 'The server is restarting.',
            retryable: true,
          },
        }),
      })
    if (connections > 2) return route.continue()
    const { pathname, search } = new URL(route.request().url())
    const upstream = await fetch(`http://localhost:8000${pathname}${search}`, {
      headers: { accept: 'text/event-stream' },
    })
    const reader = upstream.body!.getReader()
    const decoder = new TextDecoder()
    let frames: string[] = []
    let pending = ''
    while (frames.length < EVENTS_BEFORE_DROP) {
      const { done, value } = await reader.read()
      expect(done, 'the run outlasts the events kept').toBe(false)
      pending += decoder.decode(value, { stream: true })
      const parts = pending.split('\n\n')
      pending = parts.pop()!
      frames = frames.concat(parts)
    }
    await reader.cancel()
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: frames.slice(0, EVENTS_BEFORE_DROP).join('\n\n') + '\n\n',
    })
  })
}

test('live run resumes after a dropped stream', async ({ page, context }) => {
  const streams: Request[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.endsWith('/events/stream'))
      streams.push(request)
  })
  await dropStreamOnce(page)

  const question = await h1Question(page)
  const runId = await startLiveRun(page, question)
  await expectFinishedAndScored(page)

  // Three connections: the one that dropped, the browser's retry that was
  // refused, and the app's own, which resumed after the last event it had.
  expect(streams).toHaveLength(3)
  expect(streams[0].url()).not.toContain('after=')
  expect(streams[1].url()).not.toContain('after=')
  expect(new URL(streams[2].url()).searchParams.get('after')).toBe(
    String(EVENTS_BEFORE_DROP),
  )

  // Nothing is missing or twice: the screen shows what the server stored.
  const kept = await stored(page, runId)
  const sequences = kept.events.map((event) => event.sequence)
  expect(sequences).toEqual(sequences.map((_, index) => index + 1))
  expect(sequences.length).toBeGreaterThan(EVENTS_BEFORE_DROP)
  const results = await (
    await page.request.get(`/api/v1/queries/${runId}`)
  ).json()
  expect(await endState(page)).toEqual(
    await endStateOfStoredEvents(context, question, kept, results),
  )
})

test('the final state equals the replay of the stored events', async ({
  page,
  context,
}) => {
  const question = await h1Question(page)
  const runId = await startLiveRun(page, question)
  await expectFinishedAndScored(page)
  const live = await endState(page)

  // The stored events are whole and in order.
  const kept = await stored(page, runId)
  const sequences = kept.events.map((event) => event.sequence)
  expect(sequences.length).toBeGreaterThan(0)
  expect(sequences).toEqual(sequences.map((_, index) => index + 1))
  expect(kept.events.at(-1)?.event_type).toBe('run.completed')

  // The finished run replays on its own timeline, to the same end state.
  const slider = page.getByRole('slider', { name: 'Position' })
  await slider.fill('0')
  await expect(page.getByText(/^Paused at 0 s/)).toBeVisible()
  const end = (await slider.getAttribute('max'))!
  await slider.fill(end)
  await expect(slider).toHaveValue(end)
  await expect(page.getByText('The run is complete.')).toBeVisible()
  expect(await endState(page)).toEqual(live)

  // And the server's stored events, played as a stream on a fresh page, end the same way.
  const results = await (
    await page.request.get(`/api/v1/queries/${runId}`)
  ).json()
  expect(
    await endStateOfStoredEvents(context, question, kept, results),
  ).toEqual(live)
})
