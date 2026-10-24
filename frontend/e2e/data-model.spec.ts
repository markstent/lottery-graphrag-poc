import { expect, test, type Page, type Request } from '@playwright/test'
import { mkdirSync } from 'node:fs'

import {
  expectNoUnmockedRequests,
  mockApi,
  type DataModelState,
} from './mock-api'
import { GRAPH_SCHEMA, ROW_COUNTS, rowsOf } from './mock-data-model'

/* Data Model in a browser, against the mock API. SHOTS=<dir> also saves pictures. */

test.use({ viewport: { width: 1920, height: 1080 } })

// A call the mock does not answer is refused; it must not go unnoticed.
test.afterEach(({ page }) => expectNoUnmockedRequests(page))

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

const rowsRequests = (page: Page, table: string) => {
  const seen: URL[] = []
  page.on('request', (request: Request) => {
    const url = new URL(request.url())
    if (url.pathname.endsWith(`/tables/${table}/rows`)) seen.push(url)
  })
  return seen
}

/** The smallest type in the map's SVG as it shows on screen, in px. */
const smallestType = (page: Page) =>
  page.evaluate(() => {
    const svg = document.querySelector('svg[role=img]')!
    const k = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width
    return Math.min(
      ...[...svg.querySelectorAll('text')].map(
        (t) => Number(t.getAttribute('font-size')) * k,
      ),
    )
  })

const total = (n: number) => n.toLocaleString('en-GB')
const typeCount = (list: string[]) => new Set(list).size
const allTypes = new Set(GRAPH_SCHEMA.relationship_types.map((r) => r.type))

/* Devices repeat their first-seen timestamps widely, so a copied one has pages. */
test('filter by a copied timestamp and page', async ({ page }) => {
  const requests = rowsRequests(page, 'devices')
  await open(page, '#/data-model?tab=warehouse&table=devices')
  await expect(
    page.getByText(`Rows 1 to 50 of ${total(ROW_COUNTS.devices)}`),
  ).toBeVisible()

  // Copy the first_seen_at value of the first row, exactly as the grid shows it.
  const headers = await page.getByRole('columnheader').allInnerTexts()
  const stamp = await page
    .getByRole('row')
    .nth(1)
    .getByRole('cell')
    .nth(headers.indexOf('first_seen_at'))
    .innerText()
  expect(stamp).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/)
  const matching = (
    rowsOf(
      'devices',
      new URLSearchParams({ column: 'first_seen_at', value: stamp }),
    ).body as { total: number }
  ).total
  expect(matching).toBeGreaterThan(50)

  await page.getByLabel('Column').selectOption('first_seen_at')
  await page.getByLabel('Value').fill(stamp)
  await page.getByRole('button', { name: 'Filter', exact: true }).click()
  await expect(
    page.getByText(`Rows 1 to 50 of ${total(matching)}`),
  ).toBeVisible()
  await expect(page.getByRole('row')).toHaveCount(51)
  await shot(page, 'rows-filtered')

  await page.getByRole('button', { name: 'Next page' }).click()
  await expect(
    page.getByText(
      `Rows 51 to ${Math.min(100, matching)} of ${total(matching)}`,
    ),
  ).toBeVisible()
  await expect(page.getByRole('row')).toHaveCount(
    Math.min(100, matching) - 50 + 1,
  )
  await expect(
    page
      .getByRole('row')
      .nth(2)
      .getByRole('cell')
      .nth(headers.indexOf('first_seen_at')),
  ).toHaveText(stamp)

  // On to the last page: its bounds are exact and there is no way further.
  const next = page.getByRole('button', { name: 'Next page' })
  for (let start = 101; start <= matching; start += 50) {
    await next.click()
    await expect(
      page.getByText(
        `Rows ${total(start)} to ${total(Math.min(start + 49, matching))} of ${total(matching)}`,
      ),
    ).toBeVisible()
  }
  const first = Math.floor((matching - 1) / 50) * 50 + 1
  await expect(
    page.getByText(
      `Rows ${total(first)} to ${total(matching)} of ${total(matching)}`,
    ),
  ).toBeVisible()
  await expect(page.getByRole('row')).toHaveCount(matching - first + 2)
  await expect(next).toBeDisabled()
  await shot(page, 'rows-last-page')

  const typed = requests.filter((url) => url.searchParams.has('column'))
  const offsets = typed.map((url) => Number(url.searchParams.get('offset')))
  expect(offsets).toEqual(
    Array.from({ length: Math.ceil(matching / 50) }, (_, i) => i * 50),
  )
  for (const url of typed) {
    expect(url.searchParams.get('column')).toBe('first_seen_at')
    expect(url.searchParams.get('value')).toBe(stamp)
    expect(Number(url.searchParams.get('limit'))).toBeLessThanOrEqual(50)
  }
})

test('a value that does not fit the column shows the server message', async ({
  page,
}) => {
  await open(page, '#/data-model?tab=warehouse&table=tickets')
  await page.getByLabel('Column').selectOption('purchase_timestamp')
  await page.getByLabel('Value').fill('last week')
  await page.getByRole('button', { name: 'Filter', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText(
    "'last week' is not a TIMESTAMP value for purchase_timestamp",
  )
  await shot(page, 'rows-error')
  // Devices are captured in full, so a filter on them has the world's own total.
  await page.goto('/#/data-model?tab=warehouse&table=devices')
  await page.getByLabel('Column').selectOption('first_seen_at')
  await page.getByLabel('Value').fill('2031-01-01T00:00:00')
  await page.getByRole('button', { name: 'Filter', exact: true }).click()
  await expect(
    page.getByText('No row has first_seen_at equal to 2031-01-01T00:00:00.'),
  ).toBeVisible()
  await shot(page, 'rows-empty')
})

test('the warehouse map is grouped by source system, and a row follows into the graph', async ({
  page,
}) => {
  await open(page, '#/data-model')
  await expect(
    page.getByRole('region', { name: 'Incident management', exact: true }),
  ).toBeVisible()
  const games = page.getByRole('button', {
    name: `games, ${total(ROW_COUNTS.games)} rows`,
  })
  await expect(games).toBeVisible()
  await shot(page, 'warehouse-map')

  await games.click()
  await expect(page).toHaveURL(/#\/data-model\?tab=warehouse&table=games$/)
  await page.getByRole('button', { name: 'Open GAME_UK_01' }).click()
  const drawer = page.getByRole('dialog', { name: 'Evidence' })
  await expect(drawer.getByText('ticket price')).toBeVisible()
  await shot(page, 'record-drawer')

  await drawer.getByRole('link', { name: 'Follow into the graph' }).click()
  await expect(page).toHaveURL(/#\/data-model\?tab=graph&node=GAME_UK_01$/)
  await expect(
    page.getByRole('button', { name: 'Albion Millions, game' }),
  ).toHaveAttribute('aria-pressed', 'true')
  // The neighbours come from the rows: the game's own market first.
  await expect(
    page.getByRole('button', { name: 'United Kingdom, market' }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: /^INC_\d+, incident$/ }).first(),
  ).toBeVisible()
  await shot(page, 'graph-focused-node')

  await page.goBack()
  await expect(page).toHaveURL(/table=games$/)
  await expect(
    page.getByText(`Rows 1 to ${ROW_COUNTS.games} of ${ROW_COUNTS.games}`),
  ).toBeVisible()
})

test('a row with no node in the graph says so', async ({ page }) => {
  await open(page, '#/data-model?tab=warehouse&table=tickets')
  await page
    .getByRole('button', { name: /^Open TKT_\d+$/ })
    .first()
    .click()
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
  const labels = GRAPH_SCHEMA.labels.length
  expect(labels).toBe(29)
  await open(page, '#/data-model?tab=graph')
  await expect(
    page.getByRole('button', { name: `game, ${ROW_COUNTS.games} nodes` }),
  ).toBeVisible()
  await shot(page, 'graph-full')
  // The whole map, as drawn: no type below 12 px on screen.
  expect(await smallestType(page)).toBeGreaterThanOrEqual(12)
  await page.getByRole('radio', { name: 'B · Graph' }).click()
  await expect(
    page.getByText(
      `B · Graph follows ${typeCount(GRAPH_SCHEMA.allow_list.B)} of the ${allTypes.size} relationship types.`,
    ),
  ).toBeVisible()
  await shot(page, 'graph-b')
  await page.getByRole('radio', { name: 'C · Graph + Ontology' }).click()
  await expect(
    page.getByText(
      `C · Graph + Ontology follows ${typeCount(GRAPH_SCHEMA.allow_list.C)} of the ${allTypes.size} relationship types.`,
    ),
  ).toBeVisible()
  await shot(page, 'graph-c')

  await page.getByRole('button', { name: /^game, / }).click()
  const details = page.getByRole('region', { name: 'Details' })
  await expect(details.getByText(/^Built from games\./)).toBeVisible()
  await expect(details.getByText('market id')).toBeVisible()
  await shot(page, 'graph-label-sample')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  // Focus goes back to the kind that was chosen.
  await expect(page.getByRole('button', { name: /^game, / })).toBeFocused()
  // Its relationships are tagged now, and the tags are as legible.
  await expect(page.locator('g[data-edge-id] text').first()).toBeVisible()
  expect(await smallestType(page)).toBeGreaterThanOrEqual(12)
  await shot(page, 'graph-label-tagged')
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
    page.getByRole('button', {
      name: `games, ${total(ROW_COUNTS.games)} rows`,
    }),
  ).toBeVisible()
  await shot(page, 'warehouse-presentation')
  await page.getByRole('link', { name: 'Graph' }).click()
  await expect(page.getByRole('button', { name: /^game, / })).toBeVisible()
  await shot(page, 'graph-presentation')
})

const NATIONAL_DRAW = '#/data-model?tab=ontology&concept=CONCEPT_NATIONAL_DRAW'

test('the ontology shows one concept under four names, and filters its terms by market', async ({
  page,
}) => {
  await open(page, NATIONAL_DRAW)
  const card = page.getByRole('region', { name: 'Concept', exact: true })
  await expect(card.getByText('Αριθμολαχείο')).toBeVisible()
  await expect(card.getByText('Zahlenziehung')).toBeVisible()
  await expect(card.getByText('National Draw').first()).toBeVisible()
  const terms = page.getByRole('region', { name: 'Local terms bound to it' })
  await expect(terms.getByRole('group')).toHaveCount(4)
  await shot(page, 'ontology-national-draw')

  await page.getByRole('button', { name: 'Greece' }).click()
  await expect(page).toHaveURL(/concept=CONCEPT_NATIONAL_DRAW&market=MKT_GR$/)
  await expect(terms.getByRole('group')).toHaveCount(1)
  await expect(terms.getByText('Αριθμολαχείο')).toBeVisible()
  await expect(terms.getByText('Zahlenziehung')).toHaveCount(0)
  await shot(page, 'ontology-filtered-by-market')
})

test('the concept tree is a keyboard tree', async ({ page }) => {
  await open(page, NATIONAL_DRAW)
  const tree = page.getByRole('tree', { name: 'Concepts' })
  await expect(tree.getByRole('treeitem', { selected: true })).toHaveText(
    'National Draw',
  )
  // The tree is one tab stop, and it lands on the selected concept.
  await page.getByRole('link', { name: 'Scenarios' }).focus()
  await page.keyboard.press('Tab')
  await expect(
    tree.getByRole('treeitem', { name: 'National Draw' }),
  ).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(tree.getByRole('treeitem', { name: 'Draw game' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/concept=CONCEPT_DRAW_GAME$/)
  await expect(
    page
      .getByRole('region', { name: 'Concept', exact: true })
      .getByText('Ziehungsspiel', { exact: true }),
  ).toBeVisible()
  await shot(page, 'ontology-keyboard')
})

test('the scenarios are cards that link to Help, with no answers on them', async ({
  page,
}) => {
  await open(page, '#/data-model?tab=scenarios')
  await expect(page.getByRole('article')).toHaveCount(8)
  const card = page.getByRole('article').first()
  await expect(card.getByText('Strength')).toBeVisible()
  await expect(
    card.getByRole('link', { name: 'Read the story' }),
  ).toHaveAttribute('href', /^#\/help\?section=stories&story=SCN-001$/)
  await expect(
    card.getByRole('link', { name: 'See its questions' }),
  ).toHaveAttribute('href', /^#\/help\?section=questions&story=SCN-001$/)
  await shot(page, 'scenarios')
})

for (const state of ['pending', 'empty', 'error'] as const)
  test(`the ontology and scenarios show their ${state} state`, async ({
    page,
  }) => {
    await open(page, NATIONAL_DRAW, state)
    const concepts = page.getByRole('region', { name: 'Concepts' })
    if (state === 'pending')
      await expect(page.getByRole('status')).toContainText('Loading Concepts')
    if (state === 'empty')
      await expect(
        concepts.getByText('The ontology has no concepts yet.'),
      ).toBeVisible()
    if (state === 'error')
      await expect(page.getByRole('alert')).toContainText(
        'The data is unavailable.',
      )
    await shot(page, `ontology-${state}`)

    await page.getByRole('link', { name: 'Scenarios' }).click()
    const scenarios = page.getByRole('region', { name: 'Scenarios' })
    if (state === 'pending')
      await expect(page.getByRole('status')).toContainText('Loading Scenarios')
    if (state === 'empty')
      await expect(
        scenarios.getByText('No scenarios are defined.'),
      ).toBeVisible()
    if (state === 'error')
      await expect(page.getByRole('alert')).toContainText(
        'The data is unavailable.',
      )
    await shot(page, `scenarios-${state}`)
  })

test('presentation mode draws the graph map larger', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await mockApi(page)
  const map = async (url: string) => {
    await page.goto(url)
    const picture = page.getByRole('img', {
      name: 'Kinds of record',
    })
    await expect(picture).toBeVisible()
    return (await picture.boundingBox())!
  }
  const normal = await map('/#/data-model?tab=graph')
  const presenting = await map('/?present=1#/data-model?tab=graph')
  expect(presenting.height).toBeGreaterThan(normal.height)
})

test('presentation mode keeps the ontology and scenarios legible', async ({
  page,
}) => {
  await mockApi(page)
  await page.goto(
    '/?present=1#/data-model?tab=ontology&concept=CONCEPT_NATIONAL_DRAW',
  )
  await expect(
    page.getByRole('region', { name: 'Concept', exact: true }),
  ).toBeVisible()
  await shot(page, 'ontology-presentation')
  await page.getByRole('link', { name: 'Scenarios' }).click()
  await expect(page.getByRole('article')).toHaveCount(8)
  await shot(page, 'scenarios-presentation')
})
