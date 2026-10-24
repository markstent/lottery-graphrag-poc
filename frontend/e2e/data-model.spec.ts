import { expect, test, type Page, type Request } from '@playwright/test'
import { mkdirSync } from 'node:fs'

import { mockApi, type DataModelState } from './mock-api'

/* Data Model in a browser, against the mock API. SHOTS=<dir> also saves pictures. */

test.use({ viewport: { width: 1920, height: 1080 } })

async function shot(page: Page, name: string) {
  const dir = process.env.SHOTS
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${dir}/${name}.png` })
}

async function open(page: Page, hash: string, state?: DataModelState) {
  await mockApi(page, 'published', 'official', state)
  await page.goto(`/${hash}`)
}

const rowsRequests = (page: Page) => {
  const seen: URL[] = []
  page.on('request', (request: Request) => {
    const url = new URL(request.url())
    if (url.pathname.endsWith('/tables/tickets/rows')) seen.push(url)
  })
  return seen
}

test('filter by a copied timestamp and page', async ({ page }) => {
  const requests = rowsRequests(page)
  await open(page, '#/data-model?tab=warehouse&table=tickets')
  await expect(page.getByText('Rows 1 to 50 of 4,200')).toBeVisible()

  // Copy the sold_at value of the first row, exactly as the grid shows it.
  const stamp = await page
    .getByRole('row')
    .nth(1)
    .getByRole('cell')
    .nth(4)
    .innerText()
  expect(stamp).toMatch(/^2026-03-0\d{1}T10:15:00$/)

  await page.getByLabel('Column').selectOption('sold_at')
  await page.getByLabel('Value').fill(stamp)
  await page.getByRole('button', { name: 'Filter', exact: true }).click()
  await expect(page.getByText('Rows 1 to 50 of 1,400')).toBeVisible()
  await expect(page.getByRole('row')).toHaveCount(51)
  await shot(page, 'rows-filtered')

  await page.getByRole('button', { name: 'Next page' }).click()
  await expect(page.getByText('Rows 51 to 100 of 1,400')).toBeVisible()
  await expect(page.getByRole('row')).toHaveCount(51)
  await expect(
    page.getByRole('row').nth(2).getByRole('cell').nth(4),
  ).toHaveText(stamp)

  const typed = requests.filter((url) => url.searchParams.has('column'))
  expect(typed.map((url) => url.searchParams.get('offset'))).toEqual([
    '0',
    '50',
  ])
  for (const url of typed) {
    expect(url.searchParams.get('column')).toBe('sold_at')
    expect(url.searchParams.get('value')).toBe(stamp)
    expect(Number(url.searchParams.get('limit'))).toBeLessThanOrEqual(50)
  }
})

test('a value that does not fit the column shows the server message', async ({
  page,
}) => {
  await open(page, '#/data-model?tab=warehouse&table=tickets')
  await page.getByLabel('Column').selectOption('sold_at')
  await page.getByLabel('Value').fill('last week')
  await page.getByRole('button', { name: 'Filter', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText(
    "'last week' is not a TIMESTAMP value for sold_at",
  )
  await shot(page, 'rows-error')
  await page.getByLabel('Value').fill('2031-01-01T00:00:00')
  await page.getByRole('button', { name: 'Filter', exact: true }).click()
  await expect(
    page.getByText('No row has sold_at equal to 2031-01-01T00:00:00.'),
  ).toBeVisible()
  await shot(page, 'rows-empty')
})

test('the warehouse map is grouped by source system, and a row follows into the graph', async ({
  page,
}) => {
  await open(page, '#/data-model')
  await expect(
    page.getByRole('region', { name: 'Incident management' }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'games, 120 rows' }),
  ).toBeVisible()
  await shot(page, 'warehouse-map')

  await page.getByRole('button', { name: 'games, 120 rows' }).click()
  await expect(page).toHaveURL(/#\/data-model\?tab=warehouse&table=games$/)
  await page.getByRole('button', { name: 'Open GAME_003' }).click()
  const drawer = page.getByRole('dialog', { name: 'Evidence' })
  await expect(drawer.getByText('ticket price')).toBeVisible()
  await shot(page, 'record-drawer')

  await drawer.getByRole('link', { name: 'Follow into the graph' }).click()
  await expect(page).toHaveURL(/#\/data-model\?tab=graph&node=GAME_003$/)
  await expect(
    page.getByRole('button', { name: /^Vltava Draw 3, game$/ }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(
    page.getByRole('button', { name: 'INCIDENT_007, incident' }),
  ).toBeVisible()
  await shot(page, 'graph-focused-node')

  await page.goBack()
  await expect(page).toHaveURL(/table=games$/)
  await expect(page.getByText('Rows 1 to 50 of 120')).toBeVisible()
})

test('a row with no node in the graph says so', async ({ page }) => {
  await open(page, '#/data-model?tab=warehouse&table=tickets')
  await page.getByRole('button', { name: 'Open TICKET_001' }).click()
  const drawer = page.getByRole('dialog', { name: 'Evidence' })
  await expect(
    drawer.getByText('This row has no node in the graph.'),
  ).toBeVisible()
  await expect(
    drawer.getByRole('link', { name: 'Follow into the graph' }),
  ).toHaveCount(0)
  await shot(page, 'record-drawer-no-node')
})

test('the Graph tab narrows to what each approach follows and shows a sample node', async ({
  page,
}) => {
  await open(page, '#/data-model?tab=graph')
  await expect(
    page.getByRole('button', { name: 'game, 120 nodes' }),
  ).toBeVisible()
  await shot(page, 'graph-full')
  await page.getByRole('radio', { name: 'B · Graph' }).click()
  await expect(
    page.getByText('B · Graph follows 8 of the 10 relationship types.'),
  ).toBeVisible()
  await shot(page, 'graph-b')
  await page.getByRole('radio', { name: 'C · Graph + Ontology' }).click()
  await expect(
    page.getByText(
      'C · Graph + Ontology follows 10 of the 10 relationship types.',
    ),
  ).toBeVisible()
  await shot(page, 'graph-c')

  await page.getByRole('button', { name: 'game, 120 nodes' }).click()
  const details = page.getByRole('region', { name: 'Details' })
  await expect(details.getByText('Aegean Gold 1')).toBeVisible()
  await shot(page, 'graph-label-sample')
})

for (const state of ['pending', 'empty', 'error'] as const)
  test(`both tabs show their ${state} state`, async ({ page }) => {
    await open(page, '#/data-model', state)
    await expect(page.getByRole('region', { name: 'Tables' })).toBeVisible()
    if (state === 'pending')
      await expect(page.getByRole('status')).toContainText('Loading Tables')
    if (state === 'empty')
      await expect(
        page.getByText('No data has been generated yet.'),
      ).toBeVisible()
    if (state === 'error')
      await expect(page.getByRole('alert')).toContainText(
        'The data is unavailable.',
      )
    await shot(page, `warehouse-${state}`)

    await page.getByRole('link', { name: 'Graph' }).click()
    await expect(
      page.getByRole('region', { name: 'Kinds of record' }),
    ).toBeVisible()
    await shot(page, `graph-${state}`)
  })

test('presentation mode raises the type on the map', async ({ page }) => {
  await mockApi(page)
  await page.goto('/?present=1#/data-model')
  await expect(
    page.getByRole('button', { name: 'games, 120 rows' }),
  ).toBeVisible()
  await shot(page, 'warehouse-presentation')
  await page.getByRole('link', { name: 'Graph' }).click()
  await expect(
    page.getByRole('button', { name: 'game, 120 nodes' }),
  ).toBeVisible()
  await shot(page, 'graph-presentation')
})
