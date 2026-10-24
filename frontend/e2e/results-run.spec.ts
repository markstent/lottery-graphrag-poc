import { expect, test } from '@playwright/test'

import {
  COMPLETED_JOB,
  expectNoUnmockedRequests,
  mockApi,
  mockJobs,
  RUNNING_JOB,
} from './mock-api'

/* Starting and following a benchmark run from Results, against the mock API. */

test.use({ viewport: { width: 1920, height: 1080 } })

test.afterEach(({ page }) => expectNoUnmockedRequests(page))

const PROGRESS = 'World 2027 (2 of 3): 12 of 40 questions'

test('starts a quick check, follows it and opens the run it made', async ({
  page,
}) => {
  await mockApi(page)
  const jobs = await mockJobs(page, {
    script: [RUNNING_JOB, RUNNING_JOB, COMPLETED_JOB],
  })
  await page.goto('/#/results')
  await page.getByRole('button', { name: 'Start a run' }).click()
  await page.getByRole('radio', { name: 'Quick check' }).click()
  await page.getByRole('checkbox', { name: '2027' }).click()
  await page.getByRole('radio', { name: 'Chosen kinds' }).click()
  await page.getByRole('checkbox', { name: 'Multi-hop questions' }).click()
  await page.getByRole('button', { name: 'Start', exact: true }).click()

  await expect(page.getByText(PROGRESS)).toBeVisible()
  await expect(
    page.getByRole('progressbar', { name: 'Run progress' }),
  ).toHaveAttribute('aria-valuenow', '43')
  expect(jobs.started).toEqual([
    {
      kind: 'smoke',
      seeds: [2026, 2028],
      repeats: 1,
      strata: ['H1'],
      limit: null,
    },
  ])

  await expect(page).toHaveURL(/#\/results\?run=pilot-2026-nothink$/, {
    timeout: 10_000,
  })
  await expect(page.getByRole('combobox', { name: 'Run' })).toHaveValue(
    'pilot-2026-nothink',
  )
  await expect(page.getByRole('button', { name: 'Start a run' })).toBeVisible()
})

test('follows a job that was already running when the page loaded', async ({
  page,
}) => {
  await mockApi(page)
  await mockJobs(page, { script: [RUNNING_JOB], attached: true })
  await page.goto('/#/results')
  await expect(page.getByText(PROGRESS)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start a run' })).toHaveCount(0)
})

test('cancelling shows the line about the current question and calls the server', async ({
  page,
}) => {
  await mockApi(page)
  const jobs = await mockJobs(page, {
    script: [RUNNING_JOB, { ...RUNNING_JOB, status: 'cancelled' }],
    attached: true,
  })
  await page.goto('/#/results')
  await expect(
    page.getByText('Cancelling stops after the current question.'),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(
    page.getByText('Cancelled. No results were written.'),
  ).toBeVisible({ timeout: 10_000 })
  expect(jobs.cancels).toBe(1)
})

test('says so when a link names a question outside the loaded world', async ({
  page,
}) => {
  await mockApi(page)
  await page.goto('/#/live-lab?question=NO-SUCH-2026-QUESTION')
  await expect(
    page.getByText('This question is not in the loaded world.'),
  ).toBeVisible()
})
