import type { Page } from '@playwright/test'
import { readdirSync, readFileSync } from 'node:fs'

import cancelled from '../src/run/fixtures/run-cancelled.json' with { type: 'json' }
import adhoc from '../src/run/fixtures/run-adhoc.json' with { type: 'json' }
import live from '../src/run/fixtures/run-abc.json' with { type: 'json' }

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
export const QUESTIONS = RECORDED_RUNS.map((run) => ({
  instance_id: run.instance_id,
  question_id: run.instance_id.slice(0, 3),
  text: run.question,
  stratum: run.stratum,
  market_scope: [],
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
      'Incident INC_037 runs on platform version 2024.2.0 [1]. No other market is named in the sources.'
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
