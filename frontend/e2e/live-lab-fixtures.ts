import type { Page } from '@playwright/test'
import { readdirSync, readFileSync } from 'node:fs'

import cancelled from '../src/run/fixtures/run-cancelled.json' with { type: 'json' }
import adhoc from '../src/run/fixtures/run-adhoc.json' with { type: 'json' }
import live from '../src/run/fixtures/run-abc.json' with { type: 'json' }
import world from './fixtures/world-shell.json' with { type: 'json' }

/* What the Live Lab specs share: the recorded runs on disk, the questions the
   mock API lists for them, and a live run whose stream is served from a capture. */

export { adhoc, cancelled, live }

const RECORDED_DIR = 'src/run/fixtures/recorded'
export const RECORDED_RUNS: {
  instance_id: string
  question: string
  stratum: string
  events: { t_ms: number }[]
}[] = readdirSync(RECORDED_DIR)
  .filter((file) => file !== 'index.json')
  .map((file) => JSON.parse(readFileSync(`${RECORDED_DIR}/${file}`, 'utf8')))
export const h1 = RECORDED_RUNS.find((run) => run.stratum === 'H1')!
// Each saved question's easy-to-read wording, as the API capture serves it (D-108).
const EASY = new Map(
  world.demo_questions.map((q) => [q.instance_id, q.easy_text ?? null]),
)

export const QUESTIONS = RECORDED_RUNS.map((run) => ({
  instance_id: run.instance_id,
  question_id: run.instance_id.slice(0, 3),
  text: run.question,
  stratum: run.stratum,
  market_scope: [],
  easy_text: EASY.get(run.instance_id) ?? null,
}))

/** Stored results whose answers carry plain text, so pictures show no fixture tokens. */
export function plainAnswers<T extends { results?: Record<string, unknown> }>(
  results: T,
): T {
  const copy = structuredClone(results)
  for (const result of Object.values(copy.results ?? {})) {
    const answer = (result as { answer: { text: string; raw_text: string } })
      .answer
    answer.text =
      'Incident INC_021 shares platform version PLV_IDENTITY_2 with incident INC_022 in Greece [1].'
    answer.raw_text = answer.text
  }
  return copy
}

/** The captured events as one finished event stream. */
export const sse = (events: { sequence: number; event_type: string }[]) =>
  events
    .map(
      (event) =>
        `id: ${event.sequence}\nevent: ${event.event_type}\ndata: ${JSON.stringify(event)}\n\n`,
    )
    .join('')

export async function serveLiveRun(
  page: Page,
  events: typeof live.events,
  results?: unknown,
) {
  if (results !== undefined)
    await page.route('**/api/v1/queries/RUN-E2E', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(results),
      }),
    )
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

/** Lists the recorded runs' questions instead of the mock API's own demo questions. */
export async function listRecordedQuestions(page: Page) {
  await page.route('**/api/v1/demo/questions', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(QUESTIONS),
    }),
  )
}

/**
 * A live run that is part of the way through: the first `count` events of a
 * captured run arrive, and then the connection stays quiet, so the screen
 * stays in its "in progress" state for as long as the test looks at it.
 */
export async function serveRunInProgress(
  page: Page,
  events: typeof live.events,
  count: number,
) {
  await page.route('**/api/v1/queries', (route) =>
    route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ run_id: 'RUN-E2E' }),
    }),
  )
  let connections = 0
  await page.route('**/api/v1/queries/RUN-E2E/events/stream*', (route) => {
    connections += 1
    // The first connection carries the events so far; the browser's retry never gets an answer.
    if (connections > 1) return new Promise<void>(() => undefined)
    return route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: sse(events.slice(0, count)),
    })
  })
}

/**
 * Runs a typed question live. The run fixtures are runs of typed questions
 * on the tiny world (backend/tests/test_run_fixtures.py), so the screen shows
 * the question each was made for.
 */
export async function runTyped(page: Page, question: string) {
  await page.goto('/#/live-lab')
  await page
    .getByRole('textbox', { name: 'Or ask your own question' })
    .fill(question)
  await page.getByRole('button', { name: 'Run', exact: true }).click()
}
