import { expect, test, type Locator, type Page } from '@playwright/test'

import {
  adhoc,
  cancelled,
  h1,
  listRecordedQuestions,
  live,
  RECORDED_RUNS,
  runTyped,
  serveLiveRun,
  serveRunInProgress,
} from './live-lab-fixtures'
import {
  expectNoUnmockedRequests,
  mockApi,
  mockJobs,
  RUNNING_JOB,
  type DataModelState,
  type LatestRun,
  type RunsMode,
} from './mock-api'
import { graphNode } from './mock-data-model'

/**
 * Visual regression baselines for the foundation. Run locally only:
 *   pnpm e2e:visual --update-snapshots
 * Fonts differ across platforms, so this project is excluded from CI.
 *
 * Three kinds of baseline. The shell is baselined around each destination with
 * the view's own content hidden, because the views are rebuilt in Phase 6.
 * Every primitive in every state is baselined from the development gallery
 * (src/dev/gallery.tsx), one image per state. Every screen is baselined in each
 * of its states below, as a 1920 by 1080 viewport (a drawer as its own box).
 *
 * Data sources. The shell, Overview (but for the official run), Results, the
 * recorded runs, the cancelled run, the ad hoc run, the Data Model and Help are
 * captures of the real API (scripts/capture-*.mjs). The one invented thing is
 * the mock API's "official run": no full official run exists yet, so its tiles
 * and headlines are test values, not results, and the Help scores shown beside
 * it are a pilot run's shown as if official. Every baseline that shows them has
 * `fixture-official` in its name.
 */

test.use({
  viewport: { width: 1920, height: 1080 },
  reducedMotion: 'reduce',
})

test.beforeEach(async ({ page }) => {
  await mockApi(page)
})

// A call the mock does not answer is refused; it must not go unnoticed.
test.afterEach(({ page }) => expectNoUnmockedRequests(page))

/** Fonts loaded, then the frames in which the last change reaches the page. */
async function settle(page: Page) {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        document.fonts.ready.then(() =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
      ),
  )
}

/** Below this many pixels a block is small enough that a text change must show. */
const SMALL_BLOCK_PX = 200_000
const SMALL_BLOCK_DIFF_PIXELS = 50

/**
 * The baseline check. A block under 200,000 px allows 50 differing pixels, so
 * a changed word cannot hide in the ratio; a whole page keeps the ratio set in
 * the config.
 */
async function expectBaseline(target: Page | Locator, name: string) {
  const box = 'boundingBox' in target ? await target.boundingBox() : null
  if (box && box.width * box.height < SMALL_BLOCK_PX)
    await expect(target).toHaveScreenshot(name, {
      maxDiffPixels: SMALL_BLOCK_DIFF_PIXELS,
      maxDiffPixelRatio: undefined,
    })
  else await expect(target).toHaveScreenshot(name)
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
  await expectBaseline(page, name)
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
    await expect(page.locator('[data-layout-ready="true"]')).toBeVisible()
    // The first node the framed drawing wholly shows (the fit can leave others
    // outside it) that the mocked graph API holds a record for.
    const inFrame = await page.evaluate(() => {
      const frame = document
        .querySelector('.react-flow')!
        .getBoundingClientRect()
      return [...document.querySelectorAll('[data-node-id]')]
        .filter((node) => {
          const box = node.getBoundingClientRect()
          return (
            box.left >= frame.left &&
            box.top >= frame.top &&
            box.right <= frame.right &&
            box.bottom <= frame.bottom
          )
        })
        .map((node) => node.getAttribute('data-node-id') ?? '')
    })
    const id = inFrame.find((candidate) => graphNode(candidate) !== null) ?? ''
    expect(id).not.toBe('')
    await page.locator(`[data-node-id="${id}"]`).click()
    const drawer = page.getByRole('dialog', { name: 'Evidence' })
    await expect(drawer).toBeVisible()
    await expect(drawer.getByText(id).first()).toBeVisible()
    await settle(page)
    await expectScreen(
      page.getByRole('dialog', { name: 'Evidence' }),
      'shell-evidence-drawer.png',
    )
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
      if (section === 'graph') {
        // Every canvas has placed its layout and applied its fit.
        const canvases = page.locator('[data-layout-ready]')
        await expect(canvases).toHaveCount(8)
        await expect(page.locator('[data-layout-ready="true"]')).toHaveCount(8)
      }
      await settle(page)
      const ids = await blocks.evaluateAll((els) =>
        els.map((el) => el.getAttribute('data-gallery')!),
      )
      expect(ids.length).toBeGreaterThan(0)
      for (const id of ids) {
        const block = page.locator(`[data-gallery="${id}"]`)
        await block.scrollIntoViewIfNeeded()
        await PREPARE[id]?.(block)
        await expectBaseline(block, `gallery-${id}.png`)
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
      await expectScreen(
        id.startsWith('evidence') ? page.getByRole('dialog') : page,
        `gallery-drawer-${id}.png`,
      )
    })
  }
})

/* ------------------------------------------------------------------ */
/* Screens                                                             */
/* ------------------------------------------------------------------ */

/** A screen in one state: the mock API as given, then the page, once its content has drawn. */
async function openScreen(
  page: Page,
  hash: string,
  options: {
    runs?: RunsMode
    latest?: LatestRun
    dataModel?: DataModelState
  } = {},
) {
  await mockApi(page, options.runs, options.latest, options.dataModel)
  await page.goto(`/${hash}`)
}

/**
 * A screen is 2 million pixels, so the ratio in the config would let a changed
 * line of text pass. A screen allows this many differing pixels, about a word.
 */
const SCREEN_DIFF_PIXELS = 300

/**
 * The page as the viewer first sees it: at the top, unless the address scrolls
 * it to a section (`scroll: 'keep'`). Opening a control can scroll the page, so
 * the position is set rather than assumed.
 */
async function expectScreen(target: Page | Locator, name: string) {
  await expect(target).toHaveScreenshot(name, {
    maxDiffPixels: SCREEN_DIFF_PIXELS,
    maxDiffPixelRatio: undefined,
  })
}

async function screenShot(
  page: Page,
  name: string,
  scroll: 'top' | 'keep' = 'top',
) {
  await page.mouse.move(0, 0)
  if (scroll === 'top') await page.evaluate(() => window.scrollTo(0, 0))
  await settle(page)
  await expectScreen(page, `${name}.png`)
}

test.describe('Overview', () => {
  const STATES = [
    [
      'overview-fixture-official',
      'official',
      'Evidence score, questions with claims',
    ],
    ['overview-no-official-run', 'none', 'No official run yet'],
    ['overview-fixture-v03', 'v03', 'Evidence recall, questions with claims'],
    ['overview-smoke-only', 'smoke', 'Latest run: scorer smoke test'],
    ['overview-error', 'unavailable', 'The latest run is unavailable.'],
  ] as const
  for (const [name, latest, text] of STATES)
    test(name, async ({ page }) => {
      await openScreen(page, '#/overview', { latest })
      await expect(page.getByText(text).first()).toBeVisible()
      await screenShot(page, name)
    })

  test('overview-loading', async ({ page }) => {
    await openScreen(page, '#/overview', { latest: 'pending' })
    await expect(page.getByText('Loading Latest official run')).toBeAttached()
    await screenShot(page, 'overview-loading')
  })
})

test.describe('Results', () => {
  const STATES = [
    [
      'results-official',
      'official',
      'Descriptive: not part of the tested family.',
    ],
    ['results-empty', 'none', 'No benchmark runs yet.'],
    ['results-error', 'unavailable', 'The run list is unavailable.'],
  ] as const
  for (const [name, runs, text] of STATES)
    test(name, async ({ page }) => {
      await openScreen(page, '#/results', { runs })
      await expect(page.getByText(text).first()).toBeVisible()
      await screenShot(page, name)
    })

  test('results-subset', async ({ page }) => {
    await openScreen(page, '#/results?run=pilot-2026-nothink')
    await expect(page.getByText('This run predates the split.')).toBeVisible()
    await screenShot(page, 'results-subset')
  })

  test('results-v03', async ({ page }) => {
    await openScreen(page, '#/results?run=fixture-v03', { runs: 'v03' })
    await expect(page.getByText('Method v0.3', { exact: true })).toBeVisible()
    await screenShot(page, 'results-v03')
  })

  test('results-v03-agreement-and-groundedness', async ({ page }) => {
    await openScreen(page, '#/results?run=fixture-v03', { runs: 'v03' })
    const grounded = page.getByRole('region', { name: 'Groundedness' })
    await expect(grounded.getByText(/Descriptive, not tested/)).toBeVisible()
    await grounded.evaluate((el) => el.scrollIntoView({ block: 'end' }))
    await screenShot(page, 'results-v03-agreement-and-groundedness', 'keep')
  })

  test('results-quick-check', async ({ page }) => {
    await openScreen(page, '#/results?run=20261019T164733Z-smoke')
    await expect(
      page.getByText('A quick check tests the scoring code'),
    ).toBeVisible()
    await screenShot(page, 'results-quick-check')
  })

  test('results-table-expanded', async ({ page }) => {
    await openScreen(page, '#/results?run=fixture-official', {
      runs: 'official',
    })
    const table = page.getByRole('region', { name: 'Questions' })
    await table
      .getByRole('button', { name: /^Details for / })
      .first()
      .click()
    await expect(table.getByRole('rowheader', { name: 'Recall' })).toBeVisible()
    await table.evaluate((el) => el.scrollIntoView({ block: 'start' }))
    await screenShot(page, 'results-table-expanded', 'keep')
  })

  test('results-failure-filter', async ({ page }) => {
    await openScreen(page, '#/results?run=fixture-official', {
      runs: 'official',
    })
    await page
      .getByRole('region', { name: 'Failures' })
      .getByRole('button', {
        name: /^B, the needed evidence was not retrieved/,
      })
      .first()
      .click()
    const table = page.getByRole('region', { name: 'Questions' })
    await expect(
      table.getByText('B: the needed evidence was not retrieved'),
    ).toBeVisible()
    await table.evaluate((el) => el.scrollIntoView({ block: 'start' }))
    await screenShot(page, 'results-failure-filter', 'keep')
  })

  test('results-start-form', async ({ page }) => {
    await page.goto('/#/results')
    await page.getByRole('button', { name: 'Start a run' }).click()
    await expect(page.getByText('Generation model')).toBeVisible()
    await expect(page.getByText('fake-judge-v1')).toBeVisible()
    await screenShot(page, 'results-start-form')
  })

  test('results-job-running', async ({ page }) => {
    await mockJobs(page, { script: [RUNNING_JOB], attached: true })
    await page.goto('/#/results')
    await expect(
      page.getByText('World 2027 (2 of 3): 12 of 40 questions'),
    ).toBeVisible()
    await screenShot(page, 'results-job-running')
  })

  test('results-loading', async ({ page }) => {
    await openScreen(page, '#/results', { runs: 'pending' })
    await expect(page.getByText('Loading Benchmark runs')).toBeAttached()
    await screenShot(page, 'results-loading')
  })
})

test.describe('Help', () => {
  const SECTIONS = [
    ['help-top', '#/help', 'official'],
    ['help-stories', '#/help?section=stories', 'official'],
    ['help-questions-no-official-run', '#/help?section=questions', 'none'],
    [
      'help-questions-fixture-official-filtered-by-story',
      '#/help?section=questions&story=SCN-009',
      'official',
    ],
    ['help-glossary', '#/help?section=glossary', 'official'],
  ] as const
  for (const [name, hash, latest] of SECTIONS)
    test(name, async ({ page }) => {
      await openScreen(page, hash, { latest })
      await expect(
        page.getByRole('table', { name: 'Benchmark questions' }),
      ).toBeVisible()
      await screenShot(page, name, 'keep')
    })
})

test.describe('Help, bank not loaded', () => {
  for (const state of ['loading', 'error'] as const)
    test(`help-${state}`, async ({ page }) => {
      await openScreen(page, '#/help')
      // Registered after the mock, so it answers first.
      await page.route('**/api/v1/benchmarks/questions*', (route) =>
        state === 'loading'
          ? new Promise<void>(() => undefined)
          : route.fulfill({
              status: 503,
              contentType: 'application/json',
              body: JSON.stringify({
                error: {
                  error_code: 'RUN_ERROR',
                  message: 'The question bank is unavailable.',
                  retryable: true,
                },
              }),
            }),
      )
      await page.reload()
      if (state === 'loading')
        await expect(page.getByRole('status')).toHaveCount(2)
      else
        await expect(page.getByRole('alert').first()).toContainText(
          'The question bank is unavailable.',
        )
      await page
        .locator('#stories')
        .evaluate((el) => el.scrollIntoView({ block: 'start' }))
      await screenShot(page, `help-${state}`, 'keep')
    })
})

test.describe('Data Model', () => {
  const DEVICES = '#/data-model?tab=warehouse&table=devices'
  const GRAPH = '#/data-model?tab=graph'
  const NATIONAL_DRAW =
    '#/data-model?tab=ontology&concept=CONCEPT_NATIONAL_DRAW'

  test('data-model-warehouse-map', async ({ page }) => {
    await openScreen(page, '#/data-model')
    await expect(
      page.getByRole('region', { name: 'Incident management' }),
    ).toBeVisible()
    await screenShot(page, 'data-model-warehouse-map')
  })

  test('data-model-rows-filtered', async ({ page }) => {
    await openScreen(page, DEVICES)
    await page.getByLabel('Column').selectOption('first_seen_at')
    const stamp = await page
      .getByRole('row')
      .nth(1)
      .getByRole('cell')
      .nth(
        (await page.getByRole('columnheader').allInnerTexts()).indexOf(
          'first_seen_at',
        ),
      )
      .innerText()
    await page.getByLabel('Value').fill(stamp)
    await page.getByRole('button', { name: 'Filter', exact: true }).click()
    await expect(page.getByText(/^Rows 1 to 50 of /)).toBeVisible()
    await screenShot(page, 'data-model-rows-filtered')
  })

  test('data-model-record-drawer', async ({ page }) => {
    await openScreen(page, '#/data-model?tab=warehouse&table=games')
    await page.getByRole('button', { name: 'Open GAME_UK_01' }).click()
    const drawer = page.getByRole('dialog', { name: 'Evidence' })
    await expect(drawer.getByText('ticket price')).toBeVisible()
    await settle(page)
    await expectScreen(drawer, 'data-model-record-drawer.png')
  })

  test('data-model-graph-full', async ({ page }) => {
    await openScreen(page, GRAPH)
    await expect(page.getByRole('button', { name: /^game, / })).toBeVisible()
    await screenShot(page, 'data-model-graph-full')
  })

  test('data-model-graph-label-tagged', async ({ page }) => {
    await openScreen(page, GRAPH)
    await page.getByRole('button', { name: /^game, / }).click()
    await expect(page.getByRole('region', { name: 'Details' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.locator('g[data-edge-id] text').first()).toBeVisible()
    await screenShot(page, 'data-model-graph-label-tagged')
  })

  test('data-model-graph-focused-node', async ({ page }) => {
    await openScreen(page, '#/data-model?tab=graph&node=GAME_UK_01')
    await expect(
      page.getByRole('button', { name: 'Albion Millions, game' }),
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(
      page.getByRole('button', { name: 'United Kingdom, market' }),
    ).toBeVisible()
    await screenShot(page, 'data-model-graph-focused-node')
  })

  test('data-model-ontology-national-draw', async ({ page }) => {
    await openScreen(page, NATIONAL_DRAW)
    await expect(
      page
        .getByRole('region', { name: 'Local terms bound to it' })
        .getByRole('group'),
    ).toHaveCount(4)
    await screenShot(page, 'data-model-ontology-national-draw')
  })

  test('data-model-ontology-filtered-by-market', async ({ page }) => {
    await openScreen(page, `${NATIONAL_DRAW}&market=MKT_GR`)
    await expect(
      page
        .getByRole('region', { name: 'Local terms bound to it' })
        .getByRole('group'),
    ).toHaveCount(1)
    await screenShot(page, 'data-model-ontology-filtered-by-market')
  })

  test('data-model-scenarios', async ({ page }) => {
    await openScreen(page, '#/data-model?tab=scenarios')
    await expect(page.getByRole('article')).toHaveCount(8)
    await screenShot(page, 'data-model-scenarios')
  })

  test('data-model-loading', async ({ page }) => {
    await openScreen(page, '#/data-model', { dataModel: 'pending' })
    await expect(page.getByRole('status')).toContainText('Loading Tables')
    await screenShot(page, 'data-model-loading')
  })

  test('data-model-error', async ({ page }) => {
    await openScreen(page, '#/data-model', { dataModel: 'error' })
    await expect(page.getByRole('alert')).toContainText(
      'The data is unavailable.',
    )
    await screenShot(page, 'data-model-error')
  })

  test('data-model-empty', async ({ page }) => {
    await openScreen(page, '#/data-model', { dataModel: 'empty' })
    await expect(
      page.getByText('No data has been generated yet.'),
    ).toBeVisible()
    await screenShot(page, 'data-model-empty')
  })

  // The Graph and Ontology tabs have their own loading, empty and error states.
  const TABS = [
    [
      'graph',
      '#/data-model?tab=graph',
      'Kinds of record',
      'The graph has no kinds of record yet.',
    ],
    [
      'ontology',
      '#/data-model?tab=ontology',
      'Concepts',
      'The ontology has no concepts yet.',
    ],
  ] as const
  for (const [tab, hash, title, none] of TABS)
    for (const state of ['pending', 'empty', 'error'] as const)
      test(`data-model-${tab}-${state === 'pending' ? 'loading' : state}`, async ({
        page,
      }) => {
        await openScreen(page, hash, { dataModel: state })
        if (state === 'pending')
          await expect(page.getByRole('status')).toContainText(
            `Loading ${title}`,
          )
        if (state === 'empty') await expect(page.getByText(none)).toBeVisible()
        if (state === 'error')
          await expect(page.getByRole('alert')).toContainText(
            'The data is unavailable.',
          )
        await screenShot(
          page,
          `data-model-${tab}-${state === 'pending' ? 'loading' : state}`,
        )
      })
})

test.describe('Live Lab', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page)
    await listRecordedQuestions(page)
  })

  const slider = (page: Page) => page.getByRole('slider', { name: 'Position' })

  /** The recording's canvas has placed its layout and applied its fit. */
  const canvasReady = (page: Page) =>
    expect(
      page.getByRole('group', { name: 'Graph for B · Graph' }),
    ).toHaveAttribute('data-layout-ready', 'true')

  /** Moves the position to a millisecond, or to the end. Under reduced motion a recording starts at its end. */
  async function seek(page: Page, ms: number | 'end') {
    const target =
      ms === 'end' ? (await slider(page).getAttribute('max'))! : String(ms)
    await slider(page).fill(target)
    // No focus ring is left on the slider in the picture.
    await slider(page).blur()
  }

  async function finishedRecording(page: Page, run = h1, prefix = '') {
    await page.goto(`/${prefix}#/live-lab?question=${run.instance_id}`)
    await expect(slider(page)).toBeEnabled()
    await seek(page, 'end')
    await expect(page.getByRole('region', { name: 'Scorecard' })).toBeVisible()
    await canvasReady(page)
  }

  /** Runs the fixture's own typed question live. */
  async function liveRun(page: Page, question: string, waitFor: string) {
    await runTyped(page, question)
    await expect(page.getByText(waitFor).first()).toBeVisible()
  }

  test('live-lab-idle', async ({ page }) => {
    await page.goto('/#/live-lab')
    await expect(
      page.getByText('Choose a question and press Run.'),
    ).toBeVisible()
    // Nothing is chosen, so nothing looks chosen and Run is disabled.
    await expect(
      page.getByRole('button', { name: h1.question }),
    ).toHaveAttribute('aria-pressed', 'false')
    await expect(
      page.getByRole('button', { name: 'Run', exact: true }),
    ).toBeDisabled()
    await screenShot(page, 'live-lab-idle')
  })

  test('live-lab-live-running', async ({ page }) => {
    // A live run part of the way through: the first 55 percent of a captured run's events.
    await serveRunInProgress(
      page,
      live.events,
      Math.floor(live.events.length * 0.55),
    )
    await liveRun(page, live.question, 'The run is in progress.')
    await expect(page.getByRole('button', { name: 'Cancel run' })).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Run', exact: true }),
    ).toBeDisabled()
    await canvasReady(page)
    await screenShot(page, 'live-lab-live-running')
  })

  test('live-lab-h1-mid-replay-paused', async ({ page }) => {
    await page.goto(`/#/live-lab?question=${h1.instance_id}`)
    await expect(slider(page)).toBeEnabled()
    const duration = Math.round(h1.events.at(-1)!.t_ms - h1.events[0].t_ms)
    // A fixed cursor, through the replay's own seek: no timing is involved.
    await seek(page, Math.round(duration * 0.55))
    await expect(page.getByText(/^Paused at /)).toBeVisible()
    await expect(
      page
        .getByRole('region', { name: 'B · Graph', exact: true })
        .getByRole('listitem')
        .first(),
    ).toBeVisible()
    await canvasReady(page)
    await screenShot(page, 'live-lab-h1-mid-replay-paused')
  })

  test('live-lab-h1-end-b', async ({ page }) => {
    await finishedRecording(page)
    await screenShot(page, 'live-lab-h1-end-b')
  })

  test('live-lab-h1-end-b-lower', async ({ page }) => {
    await finishedRecording(page)
    await page
      .getByRole('table', { name: 'Market coverage' })
      .scrollIntoViewIfNeeded()
    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight),
    )
    await screenShot(page, 'live-lab-h1-end-b-lower', 'keep')
  })

  test('live-lab-h1-end-c', async ({ page }) => {
    await finishedRecording(page)
    await page.getByRole('tab', { name: 'C · Graph + Ontology' }).click()
    await expect(
      page
        .getByRole('list', { name: 'Key to the graph' })
        .getByText('Added by the ontology'),
    ).toBeVisible()
    await expect(
      page.getByRole('group', { name: 'Graph for C · Graph + Ontology' }),
    ).toHaveAttribute('data-layout-ready', 'true')
    await screenShot(page, 'live-lab-h1-end-c')
  })

  test('live-lab-h3-end-c-overlay', async ({ page }) => {
    await finishedRecording(
      page,
      RECORDED_RUNS.find((run) => run.stratum === 'H3')!,
    )
    await page.getByRole('tab', { name: 'C · Graph + Ontology' }).click()
    await page.getByRole('button', { name: "Show B's path" }).click()
    await expect(
      page.getByRole('group', { name: 'Graph for C · Graph + Ontology' }),
    ).toHaveAttribute('data-layout-ready', 'true')
    await screenShot(page, 'live-lab-h3-end-c-overlay')
  })

  test('live-lab-cancelled', async ({ page }) => {
    await serveLiveRun(
      page,
      cancelled.events as unknown as typeof live.events,
      cancelled.results,
    )
    await liveRun(page, cancelled.question, 'The run was cancelled.')
    // C never started, and the toggle says so.
    await expect(page.getByText('C did not run.')).toBeVisible()
    await expect(
      page.getByRole('region', { name: 'B · Graph answer' }),
    ).toContainText('No answer was recorded.')
    await screenShot(page, 'live-lab-cancelled')
  })

  test('live-lab-ad-hoc-end', async ({ page }) => {
    // A real run of a typed question: no answer key, no score.
    await serveLiveRun(
      page,
      adhoc.events as unknown as typeof live.events,
      adhoc.results,
    )
    await page.goto('/#/live-lab')
    await page
      .getByRole('textbox', { name: 'Or ask your own question' })
      .fill(adhoc.question)
    await page.getByRole('button', { name: 'Run', exact: true }).click()
    await expect(
      page.getByText('No answer key exists for this question.'),
    ).toBeVisible()
    await expect(page.getByText(adhoc.question).first()).toBeVisible()
    await canvasReady(page)
    await screenShot(page, 'live-lab-ad-hoc-end')
  })

  test('live-lab-error-409', async ({ page }) => {
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
    await liveRun(page, live.question, 'Another run is using the graph.')
    await expect(
      page.getByRole('alert').getByRole('button', { name: 'Retry' }),
    ).toBeVisible()
    await expect(page.getByText('The run did not start.')).toBeVisible()
    await screenShot(page, 'live-lab-error-409')
  })

  test('live-lab-evidence-drawer', async ({ page }) => {
    await finishedRecording(page)
    await page
      .getByRole('region', { name: 'B · Graph', exact: true })
      .getByRole('list', { name: 'Evidence' })
      .getByRole('button')
      .first()
      .click()
    const drawer = page.getByRole('dialog', { name: 'Evidence' })
    await expect(drawer).toBeVisible()
    await settle(page)
    await expectScreen(drawer, 'live-lab-evidence-drawer.png')
  })

  test('live-lab-presentation-end', async ({ page }) => {
    await finishedRecording(page, h1, '?present=1')
    await screenShot(page, 'live-lab-presentation-end')
  })
})

test.describe('presentation mode', () => {
  const OTHERS = [
    [
      'overview-fixture-official',
      '#/overview',
      'Evidence score, questions with claims',
    ],
    ['results', '#/results', 'This run predates the split.'],
    ['data-model', '#/data-model', 'Incident management'],
    ['help-fixture-official', '#/help', 'What we are testing'],
  ] as const
  for (const [name, hash, text] of OTHERS)
    test(`${name} in presentation mode`, async ({ page }) => {
      await openScreen(page, `?present=1${hash}`)
      await expect(page.getByText(text).first()).toBeVisible()
      // Help draws its question table once the bank has loaded.
      if (hash === '#/help')
        await expect(
          page.getByRole('table', { name: 'Benchmark questions' }),
        ).toBeVisible()
      await expect(
        page.getByRole('navigation', { name: 'Primary' }),
      ).toHaveCount(0)
      await screenShot(page, `presentation-${name}`)
    })
})
