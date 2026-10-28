import { expect, test, type Locator } from '@playwright/test'

import { expectNoUnmockedRequests, mockApi } from './mock-api'

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
  await picker.selectOption('20261019T164733Z-smoke')
  await expect(page).toHaveURL(/#\/results\?run=20261019T164733Z-smoke$/)
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
  const evidence = charts.getByRole('button', { name: 'Evidence score' })
  const answer = charts.getByRole('button', { name: 'Answer score' })
  await expect(evidence).toHaveAttribute('aria-pressed', 'true')
  await expect(
    charts.getByText('Evidence score by kind of question'),
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

test('a run of method v0.3 names its method and shows recall, C against A, split agreement and groundedness', async ({
  page,
}) => {
  await mockApi(page, 'v03')
  await page.goto('/#/results?run=fixture-v03')
  const verdict = page.getByRole('region', { name: 'Verdict' })
  await expect(verdict.getByText('Method v0.3', { exact: true })).toBeVisible()
  await expect(verdict.getByText(/^Method v0.3 was made after/)).toBeVisible()
  const charts = page.getByRole('region', {
    name: 'Scores by kind of question',
  })
  await expect(
    charts.getByRole('button', { name: 'Evidence recall' }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(charts.getByText(/C against A/).first()).toBeAttached()
  const judge = page.getByRole('region', { name: 'Judge' })
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

test('a run of method v0.2 says it is of the old method, and has no groundedness', async ({
  page,
}) => {
  await mockApi(page, 'v03')
  await page.goto('/#/results?run=fixture-official')
  await expect(
    page
      .getByRole('region', { name: 'Verdict' })
      .getByText('Method v0.2 (old method)'),
  ).toBeVisible()
  await expect(page.getByRole('region', { name: 'Judge' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Groundedness' })).toHaveCount(
    0,
  )
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

  test('a tooltip on the first row of a chart opens below it, inside the visible part of its scrolling box, and follows the box as it scrolls', async ({
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
      // Scrolled to either end, the tooltip moves with what is in view.
      for (const left of [0, 10_000]) {
        await mark.evaluate((el, left) => {
          el.closest('.overflow-x-auto')!.scrollLeft = left
        }, left)
        await expect(tip).toBeVisible()
        await expect
          .poll(() => shownWhole(tip), `${title}, scrolled to ${left}`)
          .toBe(true)
      }
      await mark.blur()
    }
  })
})
