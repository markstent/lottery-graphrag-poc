import { expect, test, type Locator, type Page } from '@playwright/test'
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

/** A viewport picture at the scroll position of `from` (the top by default); never the whole page. */
async function shot(page: Page, name: string, from?: Locator) {
  const dir = process.env.SHOTS
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  if (from) await from.evaluate((el) => el.scrollIntoView({ block: 'start' }))
  else await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${dir}/${name}.png` })
}

/** Stored results whose answers carry plain text, so pictures show no fixture tokens. */
function plainAnswers<T extends { results?: Record<string, unknown> }>(
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
const sse = (events: { sequence: number; event_type: string }[]) =>
  events
    .map(
      (event) =>
        `id: ${event.sequence}\nevent: ${event.event_type}\ndata: ${JSON.stringify(event)}\n\n`,
    )
    .join('')

async function serveLiveRun(
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
      .getByRole('region', { name: 'B · Graph', exact: true })
      .getByRole('listitem')
      .first(),
  ).toBeVisible()
  await shot(page, 'recorded-mid')
  await page.getByRole('slider', { name: 'Position' }).fill(String(duration))
  await expect(
    page.getByRole('region', { name: 'C · Graph + Ontology', exact: true }),
  ).toContainText('Done')
  await shot(page, 'recorded-end')
})

test('a finished recording does not stretch the page past its content', async ({
  page,
}) => {
  await page.goto(`/#/live-lab?question=${h1.instance_id}`)
  await page.getByRole('button', { name: 'Pause' }).click()
  const duration = Math.round(h1.events.at(-1)!.t_ms - h1.events[0].t_ms)
  await page.getByRole('slider', { name: 'Position' }).fill(String(duration))
  await expect(page.getByText('The run is complete.')).toBeVisible()
  const { page: height, content } = await page.evaluate(() => ({
    page: document.documentElement.scrollHeight,
    content:
      document
        .querySelector('table[aria-label="Market coverage"]')!
        .getBoundingClientRect().bottom + window.scrollY,
  }))
  // The evidence lists scroll inside their own boxes; nothing hidden may add height.
  expect(height).toBeLessThanOrEqual(Math.ceil(content) + 64)
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
  await serveLiveRun(
    page,
    cancelled.events as unknown as typeof live.events,
    plainAnswers(cancelled.results),
  )
  await page.goto('/#/live-lab')
  await page.getByRole('button', { name: h1.question }).click()
  await page.getByRole('button', { name: 'Live', exact: true }).click()
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByText('The run was cancelled.')).toBeVisible()
  await expect(
    page.getByRole('region', { name: 'B · Graph', exact: true }),
  ).toContainText('Cancelled before it finished.')
  await expect(
    page.getByRole('region', { name: 'C · Graph + Ontology', exact: true }),
  ).toContainText('Not started: the run ended first.')
  await expect(page.getByRole('region', { name: /score/i })).toHaveCount(0)
  await expect(
    page.getByRole('region', { name: 'A · Text search answer' }),
  ).toBeVisible()
  await expect(
    page.getByRole('region', { name: 'B · Graph answer' }),
  ).toContainText('No answer was recorded.')
  await shot(page, 'cancelled')
  await shot(
    page,
    'cancelled-canvas',
    page.getByRole('region', { name: 'Graph canvas' }),
  )
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

test('keeps the three panels at their size before a run, every header in full', async ({
  page,
}) => {
  await page.goto('/#/live-lab')
  await expect(page.getByText('Choose a question and press Run.')).toBeVisible()
  for (const name of ['A · Text search', 'B · Graph', 'C · Graph + Ontology']) {
    const panel = page.getByRole('region', { name, exact: true })
    const { header, box } = await panel.evaluate((el) => ({
      header: el.querySelector('header')!.getBoundingClientRect().toJSON(),
      box: el.getBoundingClientRect().toJSON(),
    }))
    expect(header.top).toBeGreaterThanOrEqual(box.top)
    expect(header.bottom).toBeLessThanOrEqual(box.bottom)
    expect(header.bottom).toBeLessThanOrEqual(1080)
    // Room below the header for the steps, as in a run.
    expect(box.height).toBeGreaterThan(3 * header.height)
  }
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

/** Plays a recording to its end with the page at 1920 by 1080. */
async function finishRecording(
  page: Page,
  run: (typeof RECORDED_RUNS)[number],
) {
  await page.goto(`/#/live-lab?question=${run.instance_id}`)
  await page.getByRole('button', { name: 'Pause' }).click()
  await page
    .getByRole('slider', { name: 'Position' })
    .fill(
      (await page
        .getByRole('slider', { name: 'Position' })
        .getAttribute('max'))!,
    )
  await expect(page.getByRole('region', { name: 'Scorecard' })).toBeVisible()
  await expect(
    page.getByRole('group', { name: 'Graph for B · Graph' }),
  ).toHaveAttribute('data-layout-ready', 'true')
}

/** Every evidence-path node of the canvas is inside it, or counted in its out-of-view note. */
async function expectPathNodesInViewOrCounted(page: Page, name: string) {
  const canvas = page.getByRole('group', { name })
  await expect(canvas).toHaveAttribute('data-layout-ready', 'true')
  const { outside, onPath, startVisible, counted } = await canvas.evaluate(
    (el) => {
      const frame = el.querySelector('.react-flow')!.getBoundingClientRect()
      const nodes = [
        ...el.querySelectorAll<HTMLElement>(
          '[data-on-path="true"][data-node-id]',
        ),
      ].map((n) => ({
        id: n.dataset.nodeId!,
        seed: n.dataset.state === 'seed',
        box: n.getBoundingClientRect(),
      }))
      const inside = (b: DOMRect) =>
        b.left >= frame.left &&
        b.top >= frame.top &&
        b.right <= frame.right &&
        b.bottom <= frame.bottom
      const note = el.querySelector('[aria-live]')?.textContent ?? ''
      return {
        onPath: nodes.length,
        outside: nodes.filter((n) => !inside(n.box)).length,
        // The framing starts from the seed the path leaves.
        startVisible: nodes.some((n) => n.seed && inside(n.box)),
        counted: Number(/^(\d+) evidence/.exec(note)?.[1] ?? 0),
      }
    },
  )
  expect(onPath).toBeGreaterThan(0)
  expect(outside).toBe(counted)
  expect(startVisible).toBe(true)
}

/** Moves the position slider to its far end. */
async function toEnd(page: Page) {
  const slider = page.getByRole('slider', { name: 'Position' })
  await slider.fill((await slider.getAttribute('max'))!)
}

const TAB_NAMES = {
  B: 'B · Graph',
  C: 'C · Graph + Ontology',
} as const

/**
 * The canvas fits the evidence path at the floor scale (14 px type, 0.875
 * zoom, 32 px margins) and starts from the seed. A path that fits is wholly
 * inside; a larger one is framed from the seed, says how many path nodes are
 * out of view, and "Bring into view" steps to the next. Path boxes seen at
 * 1920 by 1080 (layout px; the frame at the floor is 1043 by 522):
 * H1 B 772 by 364 and H1 C 819 by 462 fit; H2 B 1370 by 910, H2 C 1500 by
 * 1164, H3 B 1440 by 766, H3 C 1542 by 916, H5 B 1407 by 462 and H5 C 1572 by
 * 496 do not.
 */
const FLOOR_ZOOM = 14 / 16
const FIT_MARGIN = 32

for (const run of RECORDED_RUNS.slice().sort((a, b) =>
  a.stratum.localeCompare(b.stratum),
))
  for (const tab of ['B', 'C'] as const)
    test(`frames the evidence path at the end of ${run.stratum} on ${tab}`, async ({
      page,
    }) => {
      await finishRecording(page, run)
      if (tab === 'C')
        await page.getByRole('tab', { name: TAB_NAMES.C }).click()
      const canvas = page.getByRole('group', {
        name: `Graph for ${TAB_NAMES[tab]}`,
      })
      await expect(canvas).toHaveAttribute('data-layout-ready', 'true')
      await shot(
        page,
        `${run.stratum.toLowerCase()}-end-${tab.toLowerCase()}-canvas`,
        page.getByRole('region', { name: 'Graph canvas' }),
      )
      /** The path nodes, which of them are not fully inside, and the numbers around it. */
      const measure = () =>
        canvas.evaluate((el) => {
          const box = el.querySelector('.react-flow')!.getBoundingClientRect()
          const zoom = Number(
            /scale\(([\d.]+)\)/.exec(
              (el.querySelector('.react-flow__viewport') as HTMLElement).style
                .transform,
            )![1],
          )
          const nodes = [
            ...el.querySelectorAll<HTMLElement>(
              '[data-on-path="true"][data-node-id]',
            ),
          ].map((n) => ({
            id: n.dataset.nodeId!,
            seed: n.dataset.state === 'seed',
            rect: n.getBoundingClientRect(),
          }))
          const inside = (r: DOMRect) =>
            r.left >= box.left &&
            r.top >= box.top &&
            r.right <= box.right &&
            r.bottom <= box.bottom
          const left = Math.min(...nodes.map((n) => n.rect.left))
          const right = Math.max(...nodes.map((n) => n.rect.right))
          const top = Math.min(...nodes.map((n) => n.rect.top))
          const bottom = Math.max(...nodes.map((n) => n.rect.bottom))
          return {
            frame: { width: box.width, height: box.height },
            zoom,
            pathSize: {
              width: (right - left) / zoom,
              height: (bottom - top) / zoom,
            },
            outside: nodes.filter((n) => !inside(n.rect)).map((n) => n.id),
            seedInside: nodes.some((n) => n.seed && inside(n.rect)),
            note: Number(
              /^(\d+) evidence/.exec(
                el.querySelector('[aria-live]')?.textContent ?? '',
              )?.[1] ?? 0,
            ),
            focused: (document.activeElement as HTMLElement | null)?.dataset
              ?.nodeId,
          }
        })
      const before = await measure()
      expect(before.frame.height).toBeGreaterThanOrEqual(520)
      const fits =
        before.pathSize.width * FLOOR_ZOOM + 2 * FIT_MARGIN <=
          before.frame.width &&
        before.pathSize.height * FLOOR_ZOOM + 2 * FIT_MARGIN <=
          before.frame.height
      if (fits) {
        expect(before.outside).toEqual([])
        expect(before.note).toBe(0)
        return
      }
      expect(before.seedInside).toBe(true)
      expect(before.zoom).toBeCloseTo(FLOOR_ZOOM, 3)
      expect(before.note).toBe(before.outside.length)
      expect(before.outside.length).toBeGreaterThan(0)
      await page.getByRole('button', { name: 'Bring into view' }).click()
      // The view moves to the focused node; poll until it is wholly inside.
      await expect
        .poll(async () => {
          const after = await measure()
          return {
            wasOutside: before.outside.includes(after.focused ?? ''),
            inside: !after.outside.includes(after.focused ?? ''),
          }
        })
        .toEqual({ wasOutside: true, inside: true })
    })

test('frames the evidence path while the recording plays (H1, mid-replay)', async ({
  page,
}) => {
  await page.goto(`/#/live-lab?question=${h1.instance_id}`)
  await page.getByRole('button', { name: 'Pause' }).click()
  const slider = page.getByRole('slider', { name: 'Position' })
  await slider.fill(
    String(Math.round(Number(await slider.getAttribute('max')) * 0.9)),
  )
  await expect(
    page.getByRole('group', { name: 'Graph for B · Graph' }),
  ).toHaveAttribute('data-layout-ready', 'true')
  await shot(page, 'h1-running-mid')
})

test('shows the verdict, the graph, the answers, the paths and the coverage at the end of H1', async ({
  page,
}) => {
  await finishRecording(page, h1)
  const corner = page.getByText('scored against the answer key')
  await expect(corner).toBeVisible()
  // The label sits on one line: its text makes a single line box.
  expect(
    await corner.evaluate((el) => {
      const range = document.createRange()
      range.selectNodeContents(el)
      return new Set([...range.getClientRects()].map((r) => Math.round(r.top)))
        .size
    }),
  ).toBe(1)
  await expect(
    page.getByRole('table', { name: 'Market coverage' }),
  ).toBeVisible()
  await expectPathNodesInViewOrCounted(page, 'Graph for B · Graph')
  const canvas = page.getByRole('region', { name: 'Graph canvas' })
  await shot(page, 'h1-end-b')
  await shot(page, 'h1-end-b-canvas', canvas)
  await page.getByRole('tab', { name: 'C · Graph + Ontology' }).click()
  await expect(
    page
      .getByRole('list', { name: 'Key to the graph' })
      .getByText('Added by the ontology'),
  ).toBeVisible()
  await expectPathNodesInViewOrCounted(page, 'Graph for C · Graph + Ontology')
  await shot(page, 'h1-end-c')
})

test('draws no ontology highlight on C when the recording has no ontology expansion (H3)', async ({
  page,
}) => {
  const h3 = RECORDED_RUNS.find((run) => run.stratum === 'H3')!
  await finishRecording(page, h3)
  await page.getByRole('tab', { name: 'C · Graph + Ontology' }).click()
  await expectPathNodesInViewOrCounted(page, 'Graph for C · Graph + Ontology')
  await expect(page.getByText('+ ontology', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: "Show B's path" }).click()
  await expectPathNodesInViewOrCounted(page, 'Graph for C · Graph + Ontology')
  await shot(
    page,
    'h3-end-c-overlay',
    page.getByRole('region', { name: 'Graph canvas' }),
  )
})

test('opens the evidence drawer from a panel row and from a citation, and closes it by keyboard', async ({
  page,
}) => {
  await finishRecording(page, h1)
  await page
    .getByRole('region', { name: 'B · Graph answer' })
    .getByRole('button')
    .first()
    .click()
  await expect(page.getByRole('dialog', { name: 'Evidence' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page
    .getByRole('region', { name: 'B · Graph', exact: true })
    .getByRole('list', { name: 'Evidence' })
    .getByRole('button')
    .first()
    .click()
  const drawer = page.getByRole('dialog', { name: 'Evidence' })
  await expect(drawer).toBeVisible()
  // The drawer has slid in once nothing in it is still animating.
  await expect
    .poll(() =>
      drawer.evaluate(
        (el) =>
          el
            .getAnimations({ subtree: true })
            .filter((a) => a.playState === 'running').length,
      ),
    )
    .toBe(0)
  await shot(page, 'h1-drawer')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('shows only what can be measured for a question with no answer key', async ({
  page,
}) => {
  const adHoc = {
    ...plainAnswers(live.results),
    benchmark_instance_id: null,
    answer_key: 'none',
    score_status: 'not_applicable',
    score: null,
  }
  await serveLiveRun(page, live.events, adHoc)
  await page.goto('/#/live-lab')
  await page.getByRole('button', { name: h1.question }).click()
  await page.getByRole('button', { name: 'Live', exact: true }).click()
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(
    page.getByText('No answer key exists for this question.'),
  ).toBeVisible()
  await expect(page.getByText('scored against the answer key')).toHaveCount(0)
  await expectPathNodesInViewOrCounted(page, 'Graph for B · Graph')
  await shot(page, 'adhoc')
  await shot(
    page,
    'adhoc-canvas',
    page.getByRole('region', { name: 'Graph canvas' }),
  )
})

test('presentation mode keeps the finished screen readable', async ({
  page,
}) => {
  await page.goto(`/?present=1#/live-lab?question=${h1.instance_id}`)
  await page.getByRole('button', { name: 'Pause' }).click()
  await toEnd(page)
  await expect(page.getByRole('region', { name: 'Scorecard' })).toBeVisible()
  await expectPathNodesInViewOrCounted(page, 'Graph for B · Graph')
  await shot(page, 'presentation-end')
  await shot(
    page,
    'presentation-end-canvas',
    page.getByRole('region', { name: 'Graph canvas' }),
  )
})
