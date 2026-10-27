import { expect, test } from '@playwright/test'

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
