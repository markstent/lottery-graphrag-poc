import { expect, test, type Locator } from '@playwright/test'

import { expectNoUnmockedRequests, mockApi, mockSecondJudge } from './mock-api'

/*
 * Reading a run on Results, against the mock API. Starting, following and
 * cancelling a run is in results-run.spec.ts.
 */

test.use({ viewport: { width: 1920, height: 1080 } })

test.afterEach(({ page }) => expectNoUnmockedRequests(page))

test('the run picker is reachable by keyboard and a chosen run goes to the address', async ({
  page,
}) => {
  await mockApi(page, 'official')
  await page.goto('/#/results')
  const picker = page.getByRole('combobox', { name: 'Run' })
  await expect(picker).toHaveValue('fixture-official')
  await page.getByRole('button', { name: 'Start a run' }).focus()
  await page.keyboard.press('Tab')
  await expect(picker).toBeFocused()
  // A native select's popup is the browser's own; choosing sets the value and fires change.
  await picker.selectOption('fixture-smoke')
  await expect(page).toHaveURL(/#\/results\?run=fixture-smoke$/)
  await expect(
    page.getByText('A quick check tests the scoring code'),
  ).toBeVisible()
  await expect(
    page.getByRole('region', { name: 'Scores by kind of question' }),
  ).toHaveCount(0)
})

test('a newer development run is never opened first, and opened it says it is not a result on every panel', async ({
  page,
}) => {
  await mockApi(page, 'dev')
  await page.goto('/#/results')
  const picker = page.getByRole('combobox', { name: 'Run' })
  await expect(picker).toHaveValue('fixture-v03')
  await picker.selectOption('fixture-dev')
  await expect(page).toHaveURL(/#\/results\?run=fixture-dev$/)
  const notResult = 'Development run, not a result'
  await expect(
    page.getByRole('region', { name: 'Verdict' }).getByText(notResult),
  ).toBeVisible()
  for (const name of [
    'Scores by kind of question',
    'Questions',
    'Efficiency',
    'Failures',
    'Judge',
    'Groundedness',
  ])
    await expect(
      page.getByRole('region', { name }).getByText(notResult).first(),
    ).toBeVisible()
})

test('the metric switch redraws the charts for the other score', async ({
  page,
}) => {
  await mockApi(page, 'official')
  await page.goto('/#/results?run=fixture-official')
  const charts = page.getByRole('region', {
    name: 'Scores by kind of question',
  })
  const evidence = charts.getByRole('button', { name: 'Evidence recall' })
  const answer = charts.getByRole('button', { name: 'Answer score' })
  await expect(evidence).toHaveAttribute('aria-pressed', 'true')
  await expect(
    charts.getByText('Evidence recall by kind of question'),
  ).toBeVisible()
  await answer.focus()
  await page.keyboard.press('Enter')
  await expect(answer).toHaveAttribute('aria-pressed', 'true')
  await expect(
    charts.getByText('Answer score by kind of question'),
  ).toBeVisible()
})

test('a failure count filters the question table, and a row opens by keyboard', async ({
  page,
}) => {
  await mockApi(page, 'official')
  await page.goto('/#/results?run=fixture-official')
  const failures = page.getByRole('region', { name: 'Failures' })
  await failures
    .getByRole('button', { name: /^B, the needed evidence was not retrieved/ })
    .first()
    .click()
  await expect(page).toHaveURL(/failure=B%3Aretrieval_failure/)
  const table = page.getByRole('region', { name: 'Questions' })
  await expect(
    table.getByText('B: the needed evidence was not retrieved'),
  ).toBeVisible()
  const toggle = table.getByRole('button', { name: /^Details for / }).first()
  await toggle.focus()
  await page.keyboard.press('Enter')
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(
    table.getByRole('rowheader', { name: 'Recall' }).first(),
  ).toBeVisible()
  await expect(
    table.getByText('The needed evidence was not retrieved: 3').first(),
  ).toBeVisible()
  await page.keyboard.press('Space')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
})

test('a run names no method and shows recall, C against A, split agreement and groundedness', async ({
  page,
}) => {
  await mockApi(page, 'v03')
  await page.goto('/#/results?run=fixture-v03')
  const verdict = page.getByRole('region', { name: 'Verdict' })
  await expect(
    verdict.getByText('Evidence recall: A · Text search'),
  ).toBeVisible()
  await expect(page.getByText(/Method v0/)).toHaveCount(0)
  const charts = page.getByRole('region', {
    name: 'Scores by kind of question',
  })
  await expect(
    charts.getByRole('button', { name: 'Evidence recall' }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(charts.getByText(/C against A/).first()).toBeAttached()
  const judge = page.getByRole('region', { name: 'Judge', exact: true })
  await expect(
    judge.getByRole('rowheader', { name: 'All questions, abstained' }),
  ).toBeVisible()
  await expect(judge.getByText('Too few to say').first()).toBeVisible()
  await expect(
    page
      .getByRole('region', { name: 'Groundedness' })
      .getByText(/Descriptive, not tested/),
  ).toBeVisible()
})

test('a run with a second judge shows it after the judge, labelled descriptive', async ({
  page,
}) => {
  await mockApi(page, 'v03')
  await mockSecondJudge(page, 'ready')
  await page.goto('/#/results?run=fixture-v03')
  const panel = page.getByRole('region', { name: 'Second judge' })
  await expect(
    panel.getByText(/Descriptive, not tested. Added after the result/),
  ).toBeVisible()
  await expect(
    panel.getByText('ollama/muse-glimmer:latest, reply limit 2,048 tokens', {
      exact: true,
    }),
  ).toBeVisible()
  await expect(
    panel.getByRole('rowheader', { name: 'Second judge, answered' }),
  ).toBeVisible()
  await expect(
    panel.getByRole('table', {
      name: 'With the hand labels, on a sample of answers',
    }),
  ).toBeVisible()
  // It follows the judge's own panel and the judges' verdict, among the
  // screen's panels (a panel's own labelled parts are left out).
  const order = await page
    .getByRole('region')
    .evaluateAll((regions) =>
      regions
        .filter((r) => !r.parentElement?.closest('section'))
        .map((r) => r.getAttribute('aria-label')),
    )
  expect(order.indexOf("Judges' verdict")).toBe(order.indexOf('Judge') + 1)
  expect(order.indexOf('Second judge')).toBe(order.indexOf('Judge') + 2)
})

test("a run with a second judge shows the judges' verdict, tested as its own group, with the answers the judges disagree on", async ({
  page,
}) => {
  await mockApi(page, 'v03')
  await mockSecondJudge(page, 'ready')
  await page.goto('/#/results?run=fixture-v03')
  const panel = page.getByRole('region', { name: "Judges' verdict" })
  await expect(
    panel.getByText('Tested apart from the evidence and answer score tests.'),
  ).toBeVisible()
  await expect(panel.getByText("Judges' mark: A · Text search")).toBeVisible()
  await expect(
    panel.getByRole('img', { name: "Paired differences in judges' mark" }),
  ).toBeVisible()
  await expect(
    panel.getByText(/^Same verdict on \d+ of \d+ answers/),
  ).toBeVisible()
  const table = panel.getByRole('table', { name: 'Judges disagree' })
  await expect(
    table.getByRole('columnheader', { name: 'Second judge' }),
  ).toBeVisible()
  await expect(table.getByRole('row').nth(1)).toContainText(
    /correct|partly|wrong/,
  )
})

test('a run without a second judge shows no second judge panel', async ({
  page,
}) => {
  await mockApi(page, 'v03')
  await page.goto('/#/results?run=fixture-v03')
  await expect(
    page.getByRole('region', { name: 'Judge', exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('region', { name: 'Groundedness' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Second judge' })).toHaveCount(
    0,
  )
  await expect(
    page.getByRole('region', { name: "Judges' verdict" }),
  ).toHaveCount(0)
})

test('the second judge panel shows its loading and error states', async ({
  page,
}) => {
  await mockApi(page, 'v03')
  await mockSecondJudge(page, 'pending')
  await page.goto('/#/results?run=fixture-v03')
  const panel = page.getByRole('region', { name: 'Second judge' })
  await expect(panel.getByText('Loading Second judge')).toBeAttached()
  await mockSecondJudge(page, 'error')
  await page.reload()
  await expect(
    panel.getByRole('alert').getByText('The second judge is unavailable.'),
  ).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Retry' })).toBeVisible()
})

/** No box around the tooltip clips it: every ancestor that clips holds it whole. */
const shownWhole = (tip: Locator) =>
  tip.evaluate((el) => {
    const tipBox = el.getBoundingClientRect()
    for (let box = el.parentElement; box; box = box.parentElement) {
      const style = getComputedStyle(box)
      if (style.overflowX === 'visible' && style.overflowY === 'visible')
        continue
      const r = box.getBoundingClientRect()
      if (
        tipBox.top < r.top ||
        tipBox.bottom > r.bottom ||
        tipBox.left < r.left ||
        tipBox.right > r.right
      )
        return false
    }
    return true
  })

test('a tooltip over the first row of an interval plot is shown whole, and no chart box scrolls on a desktop', async ({
  page,
}) => {
  await mockApi(page, 'v03')
  await page.goto('/#/results?run=fixture-v03')
  const plot = page
    .getByRole('figure')
    .filter({ hasText: 'Paired differences in evidence recall' })
  await plot.locator('[data-mark="hit"]').first().hover()
  const tip = plot.getByRole('tooltip')
  await expect(tip).toBeVisible()
  expect(await shownWhole(tip)).toBe(true)
  const scrolling = await page
    .locator('figure .overflow-x-auto')
    .evaluateAll(
      (boxes) =>
        boxes.filter(
          (b) =>
            b.scrollHeight > b.clientHeight || b.scrollWidth > b.clientWidth,
        ).length,
    )
  expect(scrolling).toBe(0)
})

// The app is built for 16:9 screens; on a phone Results must still read
// without sideways page scroll: charts and wide tables scroll in their own box.
test.describe('at phone width', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('a run fits the page, and its charts scroll inside their own box', async ({
    page,
  }) => {
    await mockApi(page, 'v03')
    await page.goto('/#/results?run=fixture-v03')
    const charts = page.getByRole('region', {
      name: 'Scores by kind of question',
    })
    await expect(charts.getByRole('img').first()).toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
    // Each plot keeps a readable width and its box scrolls sideways.
    const boxes = await charts.getByRole('img').evaluateAll((plots) =>
      plots.map((plot) => {
        const box = plot.closest('.overflow-x-auto')!
        return box.scrollWidth > box.clientWidth
      }),
    )
    expect(boxes.length).toBeGreaterThan(1)
    expect(boxes.every(Boolean)).toBe(true)
    // The reproducibility record puts each value under its name.
    const repro = page.getByRole('region', { name: 'Reproducibility' })
    const name = repro.getByText('git_sha', { exact: true }).first()
    const value = repro.getByText('abc123', { exact: true }).first()
    const [n, v] = [await name.boundingBox(), await value.boundingBox()]
    expect(v!.y).toBeGreaterThan(n!.y + n!.height - 1)
    expect(
      await page
        .getByRole('navigation', { name: 'Primary' })
        .evaluate((nav) => nav.getBoundingClientRect().width),
    ).toBeLessThan(100)
  })

  test('a tooltip on the first row of a chart opens below it, inside the visible part of its scrolling box, follows the box as it scrolls, and hides while its mark is out of view', async ({
    page,
  }) => {
    await mockApi(page, 'v03')
    await page.goto('/#/results?run=fixture-v03')
    for (const title of [
      'Paired differences in evidence recall',
      'Evidence recall by kind of question',
    ]) {
      const plot = page.getByRole('figure').filter({ hasText: title })
      const mark = plot.locator('[data-mark="hit"]').first()
      await mark.focus()
      const tip = plot.getByRole('tooltip')
      await expect(tip).toBeVisible()
      expect(await shownWhole(tip), title).toBe(true)
      // Scrolled to the far end, the tooltip follows the mark while any of
      // it is in view and is hidden once none is; scrolled back, it returns.
      const scrollTo = (left: number) =>
        mark.evaluate((el, left) => {
          el.closest('.overflow-x-auto')!.scrollLeft = left
        }, left)
      await scrollTo(10_000)
      const inView = await mark.evaluate((el) => {
        const m = el.getBoundingClientRect()
        const box = el.closest('.overflow-x-auto')!.getBoundingClientRect()
        return m.right > box.left && m.left < box.right
      })
      if (inView)
        await expect
          .poll(() => shownWhole(tip), `${title}, scrolled to the end`)
          .toBe(true)
      else await expect(tip, `${title}, scrolled past`).toBeHidden()
      expect(inView, title).toBe(title.startsWith('Paired'))
      await scrollTo(0)
      await expect(tip).toBeVisible()
      await expect
        .poll(() => shownWhole(tip), `${title}, scrolled back`)
        .toBe(true)
      await mark.blur()
    }
  })
})
